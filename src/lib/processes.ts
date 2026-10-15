import {promises as fs} from "node:fs";
import {openSync, closeSync} from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import {JOBS_ROOT} from "./paths";
import {jobDir} from "./jobs";

export const startTranslationWorker = async (jobId: string, action: "generate" | "confirm") => {
  // 全文翻译和确认后分段独立运行，页面用任务状态显示进度。
  const log = openSync(path.join(jobDir(jobId), "talk.log"), "a");
  try {
    const child = spawn("npx", ["tsx", "src/server/translation-worker.ts", action, "--job-id", jobId], {
      cwd: process.cwd(), detached: true, env: {...process.env}, stdio: ["ignore", log, log],
    });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.unref();
  } finally { closeSync(log); }
};

export const startTypeScriptApprove = async (jobId: string, voiceId?: string, rate?: number) => {
  // 确认口播稿后异步启动整段百炼 TTS，避免 HTTP 请求被长时间合成阻塞。
  const directory = jobDir(jobId);
  await fs.mkdir(directory, {recursive: true});
  const log = openSync(path.join(directory, "talk.log"), "a");
  const args = ["run", "talk:approve", "--", "--job-id", jobId, ...(voiceId ? ["--voice-id", voiceId] : []), ...(rate !== undefined ? ["--rate", String(rate)] : [])];
  const child = spawn("npm", args, {
    cwd: process.cwd(),
    detached: true,
    env: {...process.env},
    stdio: ["ignore", log, log],
  });
  child.unref();
};

export const startTypeScriptNarration = async (command: "create" | "revise", jobId: string, inputFile: string, options: {textModel?: string; accountId?: string; seriesId?: string} = {}) => {
  // 生成任务后台运行，输入通过临时请求文件传递，避免把长篇原文塞进命令行参数。
  const directory = jobDir(jobId);
  await fs.mkdir(directory, {recursive: true});
  const log = openSync(path.join(directory, "talk.log"), "a");
  const args = ["tsx", "src/server/narration-worker.ts", command, "--job-id", jobId, "--input", inputFile, ...(options.textModel ? ["--text-model", options.textModel] : []), ...(options.accountId ? ["--account-id", options.accountId] : []), ...(options.seriesId ? ["--series-id", options.seriesId] : [])];
  const child = spawn("npx", args, {cwd: process.cwd(), detached: true, env: {...process.env}, stdio: ["ignore", log, log]});
  child.on("close", () => void fs.unlink(inputFile).catch(() => undefined));
  child.unref();
};

export const startTypeScriptNarrationCommand = async (command: "accept" | "discard", jobId: string) => {
  const directory = jobDir(jobId);
  await fs.mkdir(directory, {recursive: true});
  const log = openSync(path.join(directory, "talk.log"), "a");
  const child = spawn("npx", ["tsx", "src/server/narration-worker.ts", command, "--job-id", jobId], {cwd: process.cwd(), detached: true, env: {...process.env}, stdio: ["ignore", log, log]});
  child.unref();
};

export const startVisualPlanWorker = async (command: "generate" | "replan", jobId: string, feedback?: string) => {
  const directory = jobDir(jobId); await fs.mkdir(directory, {recursive: true});
  const log = openSync(path.join(directory, "talk.log"), "a");
  const args = ["tsx", "src/server/visual-plan-worker.ts", command, "--job-id", jobId, ...(feedback ? ["--feedback", feedback] : [])];
  const child = spawn("npx", args, {cwd: process.cwd(), detached: true, env: {...process.env}, stdio: ["ignore", log, log]}); child.unref();
};

export const writeRequestFile = async (name: string, value: unknown) => {
  const directory = path.join(JOBS_ROOT, ".requests");
  await fs.mkdir(directory, {recursive: true});
  const file = path.join(directory, `${name}-${Date.now()}.json`);
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return file;
};

export const startRender = async (jobId: string, manifestPath: string, origin: string) => {
  const directory = jobDir(jobId);
  const log = openSync(path.join(directory, "render.log"), "a");
  const child = spawn("npm", ["run", "render:job", "--", manifestPath, origin], {
    cwd: process.cwd(),
    detached: true,
    env: {...process.env},
    stdio: ["ignore", log, log],
  });
  child.unref();
};
