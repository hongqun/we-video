import {promises as fs} from "node:fs";
import path from "node:path";
import {atomicWriteJson, jobDir, readJson} from "../jobs";
import type {ExplainerData, ExplainerDesign} from "../../remotion/templates/handdraw-explainer-schema";

export type ExplainerSession = {status: "idle" | "running" | "ready" | "failed" | "cancelled" | "interrupted" | "stale"; progress: string; requestId?: string; fingerprint?: string; pid?: number; startedAt?: number; timeoutMs?: number; error?: string; messages: Array<{id: string; role: "user" | "assistant" | "tool"; text: string}>};
export type ExplainerCandidate = {requestId: string; fingerprint: string; design: ExplainerDesign; data: ExplainerData; review?: {cacheKey: string; pass: boolean; evidence: string; issues: string[]}};
export type ExplainerArtwork = {id: string; version: string; contextFingerprint: string; linePath: string; colorPath: string; lineHash: string; colorHash: string; evidence: string; parts: Array<{id: string; name: string; box: [number, number, number, number]}>};
export const explainerDirectory = (jobId: string, sceneId: string) => {
  if (!/^[a-zA-Z0-9-]+$/u.test(sceneId)) throw new Error("镜头 ID 无效");
  return path.join(jobDir(jobId), "handdraw-explainers", sceneId);
};
const optional = async <T>(file: string, fallback: T): Promise<T> => {
  try {return await readJson<T>(file);} catch (error) {if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback; throw error;}
};
export const readExplainerSession = (jobId: string, sceneId: string) => optional<ExplainerSession>(path.join(explainerDirectory(jobId, sceneId), "session.json"), {status: "idle", progress: "描述希望画面解释的内容", messages: []});
export const writeExplainerSession = (jobId: string, sceneId: string, value: ExplainerSession) => atomicWriteJson(path.join(explainerDirectory(jobId, sceneId), "session.json"), value);
export const readExplainerCandidate = (jobId: string, sceneId: string) => optional<ExplainerCandidate | null>(path.join(explainerDirectory(jobId, sceneId), "candidate.json"), null);
export const writeExplainerCandidate = (jobId: string, sceneId: string, value: ExplainerCandidate) => atomicWriteJson(path.join(explainerDirectory(jobId, sceneId), "candidate.json"), value);
export const readExplainerArtworks = (jobId: string, sceneId: string) => optional<ExplainerArtwork[]>(path.join(explainerDirectory(jobId, sceneId), "artworks.json"), []);
export const writeExplainerArtworks = (jobId: string, sceneId: string, value: ExplainerArtwork[]) => atomicWriteJson(path.join(explainerDirectory(jobId, sceneId), "artworks.json"), value);

// 请求、取消及 worker 回写共用跨进程锁；不能只靠当前 Node 进程的 Promise 队列。
export const withExplainerLock = async <T>(jobId: string, sceneId: string, action: () => Promise<T>) => {
  const directory = explainerDirectory(jobId, sceneId); await fs.mkdir(directory, {recursive: true});
  const lock = path.join(directory, ".request.lock");
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {handle = await fs.open(lock, "wx"); await handle.writeFile(String(process.pid)); break;}
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const stat = await fs.stat(lock).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 30000) {
        const pid = Number(await fs.readFile(lock, "utf8").catch(() => "0"));
        let dead = !pid;
        try {if (pid) process.kill(pid, 0);} catch (cause) {dead = (cause as NodeJS.ErrnoException).code === "ESRCH";}
        if (dead) await fs.unlink(lock).catch(() => undefined);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (!handle) throw new Error("镜头请求正在更新，请稍后重试");
  try {return await action();} finally {await handle.close(); await fs.unlink(lock);}
};
export const assertExplainerRequest = async (jobId: string, sceneId: string, requestId: string) => {
  const session = await readExplainerSession(jobId, sceneId);
  if (session.requestId !== requestId || session.status !== "running") throw new Error("手绘请求已取消或过期");
  return session;
};
