import {promises as fs} from "node:fs";
import path from "node:path";
import {NextResponse} from "next/server";
import {z} from "zod";
import {assertTranslationReviewed, atomicWriteJson, jobDir, readJob, readJson, recordJobApproval, updateJobGeneration, updateJobState} from "@/lib/jobs";
import {readPipelineSettings} from "@/lib/pipeline-settings";
import {startTypeScriptApprove} from "@/lib/processes";
import {narrationSegmentsForDraft} from "@/lib/tts";
import {requireAuth} from "@/lib/auth";
import {profileContext, readJobPlatformProfile} from "@/lib/profile";
import {mathDraftSchema} from "@/math/service";
import {ensureMathSummaryTags, formulaCatalog} from "@/math/formulas";
import {isAllowedMathMusicSrc, isMathMusicManifest, MATH_MUSIC_DEFAULT_SRC, MATH_MUSIC_MANIFEST_RELATIVE_PATH} from "@/math/music";
import {mathManifestSchema} from "@/remotion/math-schema";
import {renderManifestSchema} from "@/remotion/schema";
import {mathOutroVariantSchema} from "@/remotion/math-outro-variants";
import {REMOTION_PUBLIC_DIR} from "@/lib/paths";

export const runtime = "nodejs";

const requestSchema = z.object({
  // 单数据任务不再需要 revision；保留可选字段仅兼容尚未刷新页面的旧前端。
  baseRevision: z.number().int().positive().optional(),
  voiceId: z.string().min(1).optional(),
  rate: z.number().min(0.5).max(1.5).optional(),
  regenerateAudio: z.boolean().optional(),
  musicSrc: z.string().min(1).optional(),
  outroVariant: mathOutroVariantSchema.optional(),
  basePlanVersion: z.number().int().positive().optional(),
});
const MATH_MUSIC_MANIFEST_PATH = path.join(REMOTION_PUBLIC_DIR, MATH_MUSIC_MANIFEST_RELATIVE_PATH);

const readMathMusicManifest = async () => {
  const value: unknown = JSON.parse(await fs.readFile(MATH_MUSIC_MANIFEST_PATH, "utf8"));
  if (!isMathMusicManifest(value) || !value.options.length) throw new Error("数学配乐清单为空或格式无效");
  return value;
};

export async function POST(request: Request, context: {params: Promise<{id: string}>}) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const {id} = await context.params;
    // 全文审核未完成时，旧审稿接口不能绕过翻译与分段。
    await assertTranslationReviewed(id);
    const job = await readJob(id);
    const requestBody = requestSchema.parse(await request.json());
    if (job.contentMode === "math") {
      if (!new Set(["awaiting_review", "failed", "ready", "completed"]).has(job.state)) throw new Error(`当前状态 ${job.state} 不能确认公式`);
      const profile = await readJobPlatformProfile(job.contentProfile);
      const draft = mathDraftSchema.parse(await readJson<unknown>(`${jobDir(id)}/draft.json`));
      const requestedMusicSrc = requestBody.musicSrc ?? draft.musicSrc;
      const musicManifest = await readMathMusicManifest();
      const musicSrc = requestedMusicSrc === "profile-assets/tech123/math-beautiful/happybeat.ogg" ? MATH_MUSIC_DEFAULT_SRC : requestedMusicSrc;
      if (!isAllowedMathMusicSrc(musicManifest, musicSrc)) throw new Error("不支持的数学配乐");
      const videoHeight = draft.resolution === "1080x1260" ? 1260 : 1920;
      const manifest = mathManifestSchema.parse({
        ...draft, summary: ensureMathSummaryTags(draft.summary, formulaCatalog[draft.formulaId]), jobId: id, revision: 1, contentProfile: profileContext(profile),
        formula: {id: draft.formulaId, latex: draft.formulaLatex, parameters: draft.parameters, plot: draft.plot},
        outroVariant: requestBody.outroVariant ?? "orbit-trace",
        video: {width: 1080, height: videoHeight, fps: 30, outroDurationMs: 3000},
        musicSrc,
        brand: {logoSrc: profile.logoSrc, title: profile.title, subtitle: profile.subtitle, label: profile.displayLabel, downloadPrefix: profile.downloadPrefix},
      });
      await atomicWriteJson(`${jobDir(id)}/manifest.json`, manifest);
      await updateJobState(id, {state: "ready", error: null});
      return NextResponse.json({jobId: id, state: "ready"});
    }
    const directory = jobDir(id);
    const hasNarrationArtifact = await fs.access(`${directory}/audio/narration.json`).then(() => true).catch(() => false);
    // 重新生成与确认音频必须显式区分，不能把新参数静默用于确认旧产物。
    const regenerateAudio = requestBody.regenerateAudio === true;
    // 后续审核或已完成任务也可以重做配音，仍然走完整音频确认流程。
    const regenerateStates = new Set(["awaiting_script_review", "awaiting_review", "awaiting_audio_review", "awaiting_visual_resources", "awaiting_visual_review", "ready", "completed", "failed"]);
    if (regenerateAudio && !regenerateStates.has(job.state)) throw new Error("当前任务正在处理中，请完成后再重新生成配音");
    if (!regenerateAudio && (job.state === "awaiting_audio_review" || (job.state === "failed" && hasNarrationArtifact))) {
      const narration = await readJson<{voice?: string; text?: string; synthesis?: {rate?: number}}>(`${directory}/audio/narration.json`);
      const draft = await readJson<Record<string, unknown>>(`${directory}/draft.json`);
      const text = narrationSegmentsForDraft(draft).map((segment) => segment.spokenText.trim()).join("\n");
      const voiceId = requestBody.voiceId ?? job.generation?.voiceId;
      const rate = requestBody.rate ?? job.generation?.rate;
      if (narration.text !== text || (voiceId && narration.voice !== voiceId) ||
        (rate !== undefined && narration.synthesis?.rate !== rate)) {
        throw new Error("稿件或配音参数已变化，请重新生成配音后再确认");
      }
      await fs.access(`${directory}/audio/narration.wav`);
      await recordJobApproval(id, "audio");
      // 派生任务已有母稿镜头规划，音频确认后直接进入规划审核；普通任务仍从资源准备开始。
      const nextState = job.derivationKind === "translation" ? "awaiting_visual_review" : "awaiting_visual_resources";
      await updateJobState(id, {state: nextState, error: null});
      return NextResponse.json({jobId: id, state: nextState}, {status: 202});
    }
    if (!regenerateAudio && job.state === "awaiting_visual_review") {
      const {assertVisualPlanBaseVersion, readVisualPlan, writeVisualPreviewManifest} = await import("@/lib/visual-plan");
      const plan = await readVisualPlan(id);
      assertVisualPlanBaseVersion(plan, requestBody.basePlanVersion);
      // 最终确认前按最新规划、资源和音频时间轴重建唯一 manifest。
      const profile = await readJobPlatformProfile(job.contentProfile);
      await writeVisualPreviewManifest(id, profile);
      renderManifestSchema.parse(await readJson<unknown>(`${directory}/manifest.json`));
      await recordJobApproval(id, "visual");
      await updateJobState(id, {state: "ready", error: null});
      return NextResponse.json({jobId: id, state: "ready"});
    }
    if (!regenerateAudio && !new Set(["awaiting_script_review", "awaiting_review", "failed"]).has(job.state)) {
      throw new Error(`当前状态 ${job.state} 不能生成音频`);
    }
    const {voiceId, rate} = requestBody;
    const settings = await readPipelineSettings(await readJobPlatformProfile(job.contentProfile));
    // 明确拒绝不兼容音色，避免实际生成参数与用户选择不一致。
    if (voiceId && !settings.voices.some((voice) => voice.id === voiceId)) throw new Error("所选音色当前不可用，请重新选择");
    const resolvedVoiceId = voiceId ?? settings.defaultVoiceId;
    if (!settings.voices.some((voice) => voice.id === resolvedVoiceId)) throw new Error("当前专题没有可用的百炼音色");
    await Promise.all([
      fs.rm(`${directory}/manifest.json`, {force: true}),
      fs.rm(`${directory}/audio/narration.wav`, {force: true}),
      fs.rm(`${directory}/audio/narration.ssml`, {force: true}),
      fs.rm(`${directory}/audio/narration.json`, {force: true}),
    ]);
    await updateJobGeneration(id, {...job.generation, voiceId: resolvedVoiceId, rate: rate ?? settings.tts.rate});
    await recordJobApproval(id, "script");
    await updateJobState(id, {state: "synthesizing", error: null});
    // 音频合成独立于当前请求执行，完成后 Worker 会把任务推进到音频审核状态。
    await startTypeScriptApprove(id, resolvedVoiceId, rate ?? settings.tts.rate);
    return NextResponse.json({jobId: id, state: "synthesizing"}, {status: 202});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "确认草稿失败"}, {status: 400});
  }
}
