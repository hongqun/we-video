import {promises as fs} from "node:fs";
import path from "node:path";
import {atomicWriteJson, jobDir, readJson} from "../jobs";
import type {DiagramData} from "../../remotion/templates/auto-diagram-schema";

export type DiagramStatus = "idle" | "running" | "ready" | "failed" | "cancelled" | "interrupted" | "stale";
export type DiagramSession = {
  threadId: string; fingerprint?: string; requestId?: string; status: DiagramStatus;
  pid?: number; startedAt?: number; timeoutMs?: number; traceId?: string; progress: string; error?: string;
  messages: Array<{id: string; role: "user" | "assistant" | "tool"; text: string}>;
};
export type DiagramCandidate = {data: DiagramData; fingerprint: string; requestId: string; valid: boolean; errors: string[]; geometry?: string[]; cycleEvidence?: string};
export const diagramDirectory = (jobId: string, sceneId: string) => {
  if (!/^[a-zA-Z0-9-]+$/u.test(sceneId)) throw new Error("镜头 ID 无效");
  return path.join(jobDir(jobId), "diagrams", sceneId);
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
