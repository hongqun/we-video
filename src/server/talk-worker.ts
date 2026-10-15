import {promises as fs} from "node:fs";
import path from "node:path";
import {clearDraftFeedback, jobDir, readJob, readJson, updateJobState} from "@/lib/jobs";
import {readJobPlatformProfile} from "@/lib/profile";
import {readPipelineSettings} from "@/lib/pipeline-settings";
import {combineSceneAudio, narrationSegmentsForDraft} from "@/lib/tts";

const jobId = (() => {
  const index = process.argv.indexOf("--job-id");
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error("缺少 --job-id");
  return value;
})();
const requestedVoiceId = (() => {
  const index = process.argv.indexOf("--voice-id");
  return index >= 0 ? process.argv[index + 1] : undefined;
})();
const requestedRate = (() => {
  const index = process.argv.indexOf("--rate");
  const value = index >= 0 ? Number(process.argv[index + 1]) : undefined;
  return value !== undefined && Number.isFinite(value) ? value : undefined;
})();

let artifactDirectory: string | null = null;

const cleanupNarrationArtifacts = async (directory: string) => {
  // 合成失败时删除不完整产物，避免旧音频被误认为本轮生成成功。
  await Promise.all([
    fs.rm(path.join(directory, "manifest.json"), {force: true}),
    fs.rm(path.join(directory, "audio", "narration.wav"), {force: true}),
    fs.rm(path.join(directory, "audio", "narration.ssml"), {force: true}),
    fs.rm(path.join(directory, "audio", "narration.json"), {force: true}),
  ]);
};

const main = async () => {
  const job = await readJob(jobId);
  if (job.contentMode === "math") throw new Error("数学任务不使用 Talk TTS Worker");
  const directory = jobDir(jobId);
  artifactDirectory = directory;
  const profile = await readJobPlatformProfile(job.contentProfile);
  const settings = await readPipelineSettings(profile);
  const voice = requestedVoiceId ?? job.generation?.voiceId;
  if (!voice || !settings.voices.some((item) => item.id === voice)) throw new Error("任务使用的百炼音色当前不可用");
  const draft = await readJson<Record<string, unknown>>(path.join(directory, "draft.json"));
  // 所有口播段落在这里汇总，后续由 tts.ts 生成一份完整 SSML 并一次性合成。
  const segments = narrationSegmentsForDraft(draft);
  const rate = requestedRate ?? job.generation?.rate ?? settings.tts.rate;
  if (rate < 0.5 || rate > 1.5) throw new Error("语速必须在 0.5–1.5 倍之间");
  const result = await combineSceneAudio(segments, {...settings.tts, rate}, voice, path.join(directory, "audio"));
  await fs.access(result.audioPath);
  if (job.derivationKind === "translation") {
    // 英文任务复制中文镜头后，用英文音频边界重标定而不丢失模板和资源。
    const {retimeCopiedVisualPlan} = await import("@/lib/visual-plan");
    await retimeCopiedVisualPlan(jobId).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  await clearDraftFeedback(jobId);
  await updateJobState(jobId, {state: "awaiting_audio_review", error: null});
};

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (artifactDirectory) {
    try { await cleanupNarrationArtifacts(artifactDirectory); } catch { /* preserve the original worker error */ }
  }
  try { await updateJobState(jobId, {state: "failed", error: message}); } catch { /* preserve the original worker error */ }
  console.error(message);
  process.exitCode = 1;
});
