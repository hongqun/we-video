import {promises as fs} from "node:fs";
import path from "node:path";
import {atomicWriteJson, jobDir, readJson} from "../jobs";
import type {DiagramData} from "../../remotion/templates/auto-diagram-schema";
import type {DiagramValidationReport} from "./validation";

export type DiagramStatus = "idle" | "running" | "ready" | "failed" | "cancelled" | "interrupted" | "stale";
export type DiagramSession = {
  threadId: string; fingerprint?: string; requestId?: string; status: DiagramStatus;
  pid?: number; startedAt?: number; timeoutMs?: number; traceId?: string; progress: string; error?: string;
  // 诊断只保留业务类别与计数，不持久化 SDK 异常、请求头或凭据。
  diagnostics?: {requestId: string; category: string; candidateHash?: string; saves: number; calls: number; modelRetries: number};
  messages: Array<{id: string; role: "user" | "assistant" | "tool"; text: string}>;
};
// loop 使用当前命名保存回边证据，不读取或迁移旧候选的 cycleEvidence。
export type DiagramCandidate = {data: DiagramData; fingerprint: string; requestId: string; valid: boolean; errors: string[]; geometry?: string[]; loopEvidence?: string; hash?: string; validation?: DiagramValidationReport};
export const diagramDirectory = (jobId: string, sceneId: string) => {
  if (!/^[a-zA-Z0-9-]+$/u.test(sceneId)) throw new Error("镜头 ID 无效");
  return path.join(jobDir(jobId), "diagrams", sceneId);
};

// 请求占位、启动及取消共用跨进程锁，避免多个标签页同时启动同一镜头的 worker。
export const withDiagramRequestLock = async <T>(jobId: string, sceneId: string, action: () => Promise<T>): Promise<T> => {
  const directory = diagramDirectory(jobId, sceneId);
  await fs.mkdir(directory, {recursive: true});
  const lock = path.join(directory, ".request.lock");
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {handle = await fs.open(lock, "wx"); break;}
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // 为刚创建但尚未写入 PID 的锁留出时间，只回收已退出进程遗留的锁。
      const stat = await fs.stat(lock).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 30000) {
        const pid = Number(await fs.readFile(lock, "utf8").catch(() => "0"));
        if (!pid) await fs.unlink(lock).catch(() => undefined);
        else {
          try {process.kill(pid, 0);}
          catch (cause) {if ((cause as NodeJS.ErrnoException).code === "ESRCH") await fs.unlink(lock).catch(() => undefined);}
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  if (!handle) throw new Error("图表请求正在更新，请稍后重试");
  try {await handle.writeFile(String(process.pid)); return await action();}
  finally {try {await handle.close();} finally {await fs.unlink(lock);}}
};
export const readDiagramSession = async (jobId: string, sceneId: string): Promise<DiagramSession> => {
  try {return await readJson<DiagramSession>(path.join(diagramDirectory(jobId, sceneId), "session.json"));}
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {threadId: `${jobId}:${sceneId}`, status: "idle", progress: "发送指令开始制图", messages: []};
  }
};
export const writeDiagramSession = async (jobId: string, sceneId: string, session: DiagramSession) => {
  await fs.mkdir(diagramDirectory(jobId, sceneId), {recursive: true});
  await atomicWriteJson(path.join(diagramDirectory(jobId, sceneId), "session.json"), session);
};
export const readDiagramCandidate = async (jobId: string, sceneId: string): Promise<DiagramCandidate | null> => {
  try {return await readJson<DiagramCandidate>(path.join(diagramDirectory(jobId, sceneId), "current.json"));}
  catch (error) {if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error;}
};
export const writeDiagramCandidate = async (jobId: string, sceneId: string, candidate: DiagramCandidate) => {
  const directory = diagramDirectory(jobId, sceneId);
  await fs.mkdir(directory, {recursive: true});
  // current.json 是原子事实源，SVG 与绑定文件方便人工排错，失败时仍保留当前候选。
  await fs.writeFile(path.join(directory, "current.svg"), candidate.data.svg);
  await atomicWriteJson(path.join(directory, "bindings.json"), candidate.data.bindings);
  await atomicWriteJson(path.join(directory, "current.json"), candidate);
};
export const assertDiagramRequest = async (jobId: string, sceneId: string, requestId: string) => {
  const session = await readDiagramSession(jobId, sceneId);
  if (session.requestId !== requestId || session.status !== "running") throw new Error("请求已取消、中断或失效");
  return session;
};
