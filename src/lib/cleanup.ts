import {promises as fs} from "node:fs";
import path from "node:path";
import {JOBS_ROOT} from "./paths";
import {readJob} from "./jobs";

// 生成中的任务其媒体文件不参与清理（避免与正在写入的合成/渲染子进程冲突）。
// 注意：drafting 阶段不产出媒体，故不在此列。
const ACTIVE_STATES = new Set(["synthesizing", "rendering"]);
const DAY_MS = 24 * 60 * 60 * 1000;

const positiveNumber = (value: number) => Number.isFinite(value) && value > 0;

const retentionDays = () => {
  const raw = Number(process.env.TALK_VIDEO_MEDIA_RETENTION_DAYS);
  return positiveNumber(raw) ? raw : 15;
};

const intervalMs = () => {
  const raw = Number(process.env.TALK_VIDEO_MEDIA_CLEANUP_INTERVAL_MS);
  return positiveNumber(raw) ? raw : 6 * 60 * 60 * 1000;
};

const isRevisionDir = (name: string) => /^r\d+$/.test(name);

// 删除单个过期媒体文件；失败只记日志、计入 errors，绝不抛出。
const deleteIfStale = async (file: string, cutoffMs: number): Promise<"deleted" | "kept" | "error"> => {
  let mtimeMs: number;
  try {
    mtimeMs = (await fs.stat(file)).mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[cleanup] stat 失败 ${file}:`, error);
    }
    return "error";
  }
  if (mtimeMs > cutoffMs) return "kept"; // 仍新鲜，跳过
  try {
    await fs.unlink(file);
    return "deleted";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[cleanup] 删除失败 ${file}:`, error);
    }
    return "error";
  }
};

const listWav = async (audioDir: string): Promise<string[]> => {
  try {
    const names = await fs.readdir(audioDir);
    return names.filter((name) => name.endsWith(".wav")).map((name) => path.join(audioDir, name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[cleanup] 读取音频目录失败 ${audioDir}:`, error);
    }
    return [];
  }
};

/**
 * 扫描 JOBS_ROOT，删除 mtime 超过保留期的 .wav 与 output.mp4。
 * 只删媒体文件，绝不删除任务目录、job.json、草稿、来源、manifest 或日志。
 * 正在合成/渲染的任务整体跳过。任何错误都被吞掉并计数，不影响业务。
 */
export const cleanupMedia = async (now = Date.now()): Promise<{deleted: number; kept: number; errors: number}> => {
  const cutoffMs = now - retentionDays() * DAY_MS;
  const result = {deleted: 0, kept: 0, errors: 0};

  let jobIds: string[];
  try {
    jobIds = await fs.readdir(JOBS_ROOT);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[cleanup] 读取 JOBS_ROOT 失败:", error);
    }
    return result;
  }

  for (const jobId of jobIds) {
    let active = false;
    try {
      active = ACTIVE_STATES.has((await readJob(jobId)).state);
    } catch {
      // 无 job.json 或读取失败：仍按 mtime 清理其过期媒体
    }

    const jobPath = path.join(JOBS_ROOT, jobId);
    let entries: string[];
    try {
      entries = await fs.readdir(jobPath);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!isRevisionDir(entry)) continue;
      const revPath = path.join(jobPath, entry);
      if (active) continue; // 活跃任务：保留其全部媒体
      const targets = [path.join(revPath, "output.mp4"), ...(await listWav(path.join(revPath, "audio")))];
      for (const target of targets) {
        const outcome = await deleteIfStale(target, cutoffMs);
        if (outcome === "deleted") result.deleted++;
        else if (outcome === "kept") result.kept++;
        else result.errors++;
      }
    }
  }

  return result;
};

let running = false;

/**
 * 启动即执行一次清理，并按固定间隔定期执行。
 * 进程内 `running` 锁防止两次执行重叠（单 Node 进程已足够）。
 */
export const scheduleMediaCleanup = (): void => {
  const run = async () => {
    if (running) return;
    running = true;
    const started = Date.now();
    try {
      const {deleted, kept, errors} = await cleanupMedia();
      console.log(
        `[cleanup] 完成：删除 ${deleted} 个、保留 ${kept} 个、错误 ${errors} 个，耗时 ${Date.now() - started}ms`,
      );
    } catch (error) {
      console.error("[cleanup] 运行异常:", error);
    } finally {
      running = false;
    }
  };

  void run();
  setInterval(() => void run(), intervalMs()).unref();
};
