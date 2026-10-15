/* eslint-disable @remotion/non-pure-animation -- transition 是 Manifest 时间轴数据，不是 CSS 动画。 */
import {promises as fs} from "node:fs";
import path from "node:path";
import {z} from "zod";
import {atomicWriteJson, jobDir, readJson, readJob} from "./jobs";
import {repairEnglishSegmentCaptions} from "./tts";
import type {PlatformProfile} from "./profile";
import {coverSchema, presenterFramingSchema, presenterModeSchema, presenterPlacementSchema, presenterPoseIdSchema, renderManifestSchema, rollTypeSchema, transitionSchema, visualPlanContentSchema, visualStyleSchema, type RenderManifest, type VideoScene} from "@/remotion/schema";
import {defaultCover} from "@/remotion/cover";
import {isTemplateAvailableForProfile, templateById} from "@/remotion/templates/registry";
import {normalizeVisualPlanVisibleText, spokenTextForTimeRange} from "./visual-plan-text";
import {buildVisualImageSchedule} from "@/remotion/templates/visual-image";
import {readVisualResources, type VisualResources} from "./visual-resources";
import {visualResourceForScene} from "./visual-resource-selection";
import {relationGraphDataSchema} from "@/remotion/templates/relation-graph-schema";
import {relationGraphNodeCue, relationGraphNodeDisplayName} from "@/remotion/templates/relation-graph";

const presenterPlanSchema = z.object({rollType: rollTypeSchema, mode: presenterModeSchema, poseId: presenterPoseIdSchema, placement: presenterPlacementSchema, framing: presenterFramingSchema.optional()}).strict();

// visual-plan.json 保存独立视觉时间轴、可编辑规划、关系图节点和封面配置。
export const visualPlanSceneSchema = z.object({
  id: z.string().min(1),
  segmentId: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  transition: transitionSchema,
  content: visualPlanContentSchema,
  templateId: z.string().min(1),
  visualData: relationGraphDataSchema.optional(),
  presenter: presenterPlanSchema,
}).strict();
export const visualPlanSchema = z.object({schemaVersion: z.literal("1.0"), revision: z.number().int().positive().default(1), planVersion: z.number().int().positive(), createdAt: z.string().datetime(), feedback: z.string().trim().min(1).optional(), visualStyle: visualStyleSchema.optional(), cover: coverSchema.optional(), scenes: z.array(visualPlanSceneSchema).min(1)}).strict();
export const visualPlanSaveInputSchema = visualPlanSchema.omit({planVersion: true, createdAt: true}).strict();

// 模型边界使用 strict；任何模板、画面类型或运行时字段都会被明确拒绝。
export const visualPlanModelSceneSchema = z.object({
  segmentId: z.string().trim().min(1),
  content: visualPlanContentSchema,
}).strict();
export const visualPlanModelOutputSchema = z.object({scenes: z.array(visualPlanModelSceneSchema).min(1)}).strict();
export type VisualPlan = z.infer<typeof visualPlanSchema>;
export type VisualPlanScene = z.infer<typeof visualPlanSceneSchema>;
export type VisualPlanSaveInput = z.infer<typeof visualPlanSaveInputSchema>;
type Narration = {text: string; durationMs: number; spokenDurationMs?: number; model: string; voice: string; captions: RenderManifest["captions"]; segments: Array<Pick<VideoScene, "id" | "startMs" | "endMs" | "speechStartMs" | "speechEndMs" | "pauseAfterMs" | "transition">>};
type Draft = {language?: {outputLanguage?: string}; title: string; shortTitle?: string; summary?: string; captionStyle?: RenderManifest["captionStyle"]; narrationSegments: Array<{id: string; spokenText: string}>};

const currentPlanPath = (jobId: string) => path.join(jobDir(jobId), "visual-plan.json");
const readNarration = async (jobId: string) => {
  const narration = await readJson<Narration>(path.join(jobDir(jobId), "audio", "narration.json"));
  const job = await readJob(jobId);
  // 保存和最终确认也统一修复英文字幕，不依赖先打开快照接口。
  if (job.derivationKind !== "translation" || job.contentProfile.outputLanguage !== "en-US") return narration;
  const draft = await readDraft(jobId);
  const captions = repairEnglishSegmentCaptions(narration.captions, draft.narrationSegments, narration.segments.map((segment) => ({id: segment.id, speechStartMs: segment.speechStartMs ?? segment.startMs, speechEndMs: segment.speechEndMs ?? segment.endMs})));
  return {...narration, captions};
};
const readDraft = (jobId: string) => readJson<Draft>(path.join(jobDir(jobId), "draft.json"));
const timelineError = (field: string, message: string): never => { throw new Error(`narration.${field}: ${message}`); };

const normalizeCover = (plan: z.infer<typeof visualPlanSchema>, title: string) => {
  if (plan.cover) return plan;
  return {...plan, cover: defaultCover(title, plan.scenes[0]!)};
};

// narration.json 是唯一时间轴来源，视觉规划不能自行生成或修补时间。
export const validateNarrationTimeline = (draft: Draft, narration: Narration) => {
  // TTS 写入 narration.json 前会逐段 trim 并用换行连接，校验必须使用同一文本序列化规则。
  const expectedText = draft.narrationSegments.map((segment) => segment.spokenText.trim()).join("\n");
  if (narration.text !== expectedText) timelineError("text", "与当前确认口播全文不一致");
  if (!Number.isInteger(narration.durationMs) || narration.durationMs <= 0) timelineError("durationMs", "总时长无效");
  const ids = draft.narrationSegments.map((segment) => segment.id);
  if (narration.segments.length !== ids.length) timelineError("segments", "段落数量与确认稿不一致");
  narration.segments.forEach((segment, index) => {
    const prefix = `segments.${index}`;
    if (segment.id !== ids[index]) timelineError(`${prefix}.id`, "段落 ID 或顺序与确认稿不一致");
    if (!Number.isInteger(segment.startMs) || !Number.isInteger(segment.endMs) || segment.endMs <= segment.startMs) timelineError(prefix, "段落边界无效");
    if (index === 0 && segment.startMs !== 0) timelineError(`${prefix}.startMs`, "首段必须从 0ms 开始");
    if (index > 0 && segment.startMs !== narration.segments[index - 1]!.endMs) timelineError(`${prefix}.startMs`, "段落边界必须连续");
    if (segment.speechStartMs === undefined || segment.speechEndMs === undefined || segment.pauseAfterMs === undefined || !segment.transition) timelineError(prefix, "口播与停顿字段不完整");
    const speechStartMs = segment.speechStartMs!;
    const speechEndMs = segment.speechEndMs!;
    if (!(segment.startMs <= speechStartMs && speechStartMs < speechEndMs && speechEndMs <= segment.endMs)) timelineError(prefix, "口播区间无效");
    const boundaryEnd = narration.segments[index + 1]?.speechStartMs ?? narration.durationMs;
    if (segment.pauseAfterMs !== boundaryEnd - speechEndMs) timelineError(`${prefix}.pauseAfterMs`, "与下一段口播边界不一致");
  });
  narration.captions.forEach((caption, index) => {
    if (caption.startMs < 0 || caption.endMs <= caption.startMs || caption.endMs > narration.durationMs) timelineError(`captions.${index}`, "字幕时间超出音频边界");
  });
};

// 生成完成后允许用户继续修订；保存会让任务回到待确认，避免旧 Manifest 被当成最新规划。
export const assertVisualPlanEditableState = (state: string) => {
  if (!["awaiting_visual_review", "planning_visuals", "ready", "completed", "failed"].includes(state)) throw new Error("当前任务状态不允许修改镜头规划");
};
export const assertVisualPlanBaseVersion = (plan: Pick<VisualPlan, "planVersion">, basePlanVersion?: number) => {
  if (basePlanVersion !== plan.planVersion) throw new Error("镜头规划版本已变化，请刷新后再确认");
};

export const readVisualPlan = async (jobId: string, revision?: number) => {
  void revision;
  const [stored, draft] = await Promise.all([readJson<unknown>(currentPlanPath(jobId)), readDraft(jobId)]);
  // 不兼容旧结构；旧字段由 strict schema 直接报错。
  const parsed = visualPlanSchema.parse(stored);
  const normalized = normalizeCover(normalizeVisualPlanVisibleText(parsed, draft.narrationSegments), draft.title);
  if (!parsed.cover) {
    // 读取时补全封面，避免预览继续隐式回退。
    await atomicWriteJson(currentPlanPath(jobId), normalized);
  }
  return normalized;
};

const templateDataForManifest = (scene: VisualPlanScene, resources: VisualResources, allowIncompleteImage = false): Record<string, unknown> | undefined => {
  if (scene.templateId === "rve/relation-graph") return scene.visualData ? relationGraphDataSchema.parse(scene.visualData) : undefined;
  if (scene.templateId !== "rve/visual-image") return undefined;
  const resource = visualResourceForScene(resources, scene.id, scene.segmentId);
  if (!resource?.imagePath || !resource.imageWidth || !resource.imageHeight) {
    // 镜头规划允许先保存模板选择，真正确认和生成 manifest 时仍必须补齐图片。
    if (allowIncompleteImage) return undefined;
    throw new Error(`镜头 ${scene.segmentId} 缺少完整图片资源`);
  }
  return {imagePath: `artifact://${resource.imagePath}`, imageWidth: resource.imageWidth, imageHeight: resource.imageHeight, polygons: resource.polygons};
};

const coverForManifest = (cover: NonNullable<VisualPlan["cover"]>) => cover.imagePath
  ? {...cover, imagePath: `artifact://${cover.imagePath}`}
  : cover;

export const deriveScenes = (plan: Pick<VisualPlan, "scenes">, draft: Draft, narration: Narration, resources: VisualResources = {schemaVersion: "1.0", revision: 1, resources: []}, options: {allowIncompleteImage?: boolean} = {}): VideoScene[] => {
  const spokenById = new Map(draft.narrationSegments.map((segment) => [segment.id, segment.spokenText]));
  const timingById = new Map(narration.segments.map((segment) => [segment.id, segment]));
  return plan.scenes.map((scene, index) => {
    const segment = timingById.get(scene.segmentId);
    if (!segment) throw new Error(`镜头 ${index + 1} 引用了不存在的 segment`);
    const templateData = templateDataForManifest(scene, resources, options.allowIncompleteImage === true);
    const speechStartMs = Math.max(scene.startMs, segment.speechStartMs ?? segment.startMs);
    const speechEndMs = Math.min(scene.endMs, segment.speechEndMs ?? segment.endMs);
    const hasSpeech = speechEndMs > speechStartMs;
    const isLastVisualSceneForSegment = plan.scenes[index + 1]?.segmentId !== scene.segmentId;
    const isSplitSegment = plan.scenes.filter((item) => item.segmentId === scene.segmentId).length > 1;
    return {
      id: `scene-${String(index + 1).padStart(2, "0")}`,
      segmentId: scene.segmentId,
      // 未拆分镜头的口播以确认稿为准，不能被供应商在段落边界粘连的字幕截短。
      // 只有同段被手动拆成多个镜头时，才按各自的时间范围裁剪文字。
      spokenText: isSplitSegment || draft.language?.outputLanguage !== "en-US"
        ? spokenTextForTimeRange(narration.captions, scene.startMs, scene.endMs) || (spokenById.get(scene.segmentId) ?? "")
        : (spokenById.get(scene.segmentId) ?? ""),
      startMs: scene.startMs,
      endMs: scene.endMs,
      ...(hasSpeech ? {speechStartMs, speechEndMs} : {}),
      pauseAfterMs: isLastVisualSceneForSegment ? segment.pauseAfterMs : 0,
      transition: scene.transition,
      content: scene.content,
      templateId: scene.templateId,
      ...(templateData ? {templateData} : {}),
      rollType: scene.presenter.rollType,
      presenterMode: scene.presenter.mode,
      presenterPoseId: scene.presenter.poseId,
      presenterPlacement: scene.presenter.placement,
      presenterFraming: scene.presenter.framing ?? (scene.presenter.rollType === "a-roll" ? "full" : templateById.get(scene.templateId)?.companionFraming ?? "waist"),
    };
  });
};

export const validateVisualPlan = (plan: VisualPlan, draft: Draft, narration: Narration, profile: PlatformProfile, resources: VisualResources = {schemaVersion: "1.0", revision: 1, resources: []}, options: {allowIncompleteImage?: boolean} = {}) => {
  validateNarrationTimeline(draft, narration);
  const timingById = new Map(narration.segments.map((segment) => [segment.id, segment]));
  const expectedIds = draft.narrationSegments.map((segment) => segment.id);
  const seenSegments = new Set<string>();
  let previousSegmentIndex = -1;
  plan.scenes.forEach((scene, index) => {
    const segmentIndex = expectedIds.indexOf(scene.segmentId);
    const timing = timingById.get(scene.segmentId);
    if (segmentIndex < 0 || !timing) throw new Error(`镜头 ${index + 1} 引用了不存在的口播段落`);
    if (segmentIndex < previousSegmentIndex) throw new Error("视觉镜头必须按口播段落顺序排列");
    if (scene.endMs <= scene.startMs) throw new Error(`镜头 ${index + 1} 的时间范围无效`);
    if (scene.startMs < timing.startMs || scene.endMs > timing.endMs) throw new Error(`镜头 ${index + 1} 超出所属口播段落时间范围`);
    const previous = plan.scenes[index - 1];
    if (previous?.segmentId === scene.segmentId && previous.endMs !== scene.startMs) throw new Error(`口播段落 ${scene.segmentId} 的视觉镜头之间存在空洞或重叠`);
    if (previous?.segmentId !== scene.segmentId && scene.startMs !== timing.startMs) throw new Error(`口播段落 ${scene.segmentId} 的首个视觉镜头边界无效`);
    const next = plan.scenes[index + 1];
    if (next?.segmentId !== scene.segmentId && scene.endMs !== timing.endMs) throw new Error(`口播段落 ${scene.segmentId} 的末个视觉镜头边界无效`);
    seenSegments.add(scene.segmentId);
    previousSegmentIndex = segmentIndex;
  });
  if (seenSegments.size !== expectedIds.length) throw new Error("每个口播段落都必须有视觉镜头");
  const allowIncompleteImage = options.allowIncompleteImage === true;
  const runtimeScenes = deriveScenes(plan, draft, narration, resources, {allowIncompleteImage});
  plan.scenes.forEach((scene, index) => {
    const first = index === 0;
    const last = index === plan.scenes.length - 1 && !first;
    const definition = templateById.get(scene.templateId);
    if (!definition || !definition.adapted || !isTemplateAvailableForProfile(definition, profile)) throw new Error(`镜头 ${scene.segmentId} 使用了不可用模板`);
    if (last && scene.templateId !== "ip/closing-stage") throw new Error(`镜头 ${scene.segmentId} 必须使用总结 IP 模板`);
    if (first && scene.templateId === "ip/closing-stage") throw new Error(`镜头 ${scene.segmentId} 不能使用总结 IP 模板`);
    if (last && (scene.presenter.rollType !== "a-roll" || scene.presenter.mode !== "hero" || scene.presenter.placement !== "hero")) throw new Error(`镜头 ${scene.segmentId} 必须使用首尾 IP 主讲舞台`);
    if (definition.rollRole === "a-roll" && (scene.presenter.rollType !== "a-roll" || scene.presenter.mode !== "hero" || scene.presenter.placement !== "hero")) throw new Error(`镜头 ${scene.segmentId} 的人物设置与主讲模板不兼容`);
    if (definition.rollRole === "b-roll" && (scene.presenter.rollType !== "b-roll" || scene.presenter.mode === "hero" || scene.presenter.placement === "hero")) throw new Error(`镜头 ${scene.segmentId} 必须使用 B-roll 模式`);
    if (definition.rollRole === "b-roll" && scene.presenter.mode === "companion" && !definition.companionPlacements.includes(scene.presenter.placement as Exclude<typeof scene.presenter.placement, "hero">)) throw new Error(`镜头 ${scene.segmentId} 的人物位置不在模板安全区`);
    if (definition.rollRole === "b-roll" && scene.presenter.mode === "companion" && scene.presenter.framing && scene.presenter.framing !== definition.companionFraming) throw new Error(`镜头 ${scene.segmentId} 的人物构图与模板不兼容`);
    // 退役姿态仅为旧任务保留；新任务可选目录仍只有正式 poses。
    if (scene.presenter.mode !== "hidden" && ![...profile.presenter.poses, ...(profile.presenter.compatibilityPoses ?? [])].some((pose) => pose.id === scene.presenter.poseId)) throw new Error(`镜头 ${scene.segmentId} 使用了未登记的人物姿态`);
    if (runtimeScenes[index]!.endMs - runtimeScenes[index]!.startMs < definition.minDurationMs) throw new Error(`镜头 ${scene.segmentId} 时长不足 ${(definition.minDurationMs / 1000).toFixed(1)} 秒`);
    if (scene.templateId === "rve/visual-image" && runtimeScenes[index]!.templateData) buildVisualImageSchedule({scene: runtimeScenes[index]!, captions: narration.captions, data: runtimeScenes[index]!.templateData});
    if (scene.templateId === "rve/relation-graph") {
      const graph = relationGraphDataSchema.parse(scene.visualData);
      graph.nodes.forEach((node) => {
        if (node.data.cueText && !relationGraphNodeCue(runtimeScenes[index]!, narration.captions, node)) throw new Error(`视觉场景 ${runtimeScenes[index]!.id}（口播段落 ${scene.segmentId}）的关系图节点“${relationGraphNodeDisplayName(node)}”（口播绑定“${node.data.cueText}”）未匹配到当前口播，请修改或清空该节点的口播绑定`);
      });
    }
  });
};

export const saveVisualPlan = async (jobId: string, input: VisualPlanSaveInput, profile: PlatformProfile) => {
  const parsedInput = visualPlanSaveInputSchema.parse(input);
  const [current, draft, narration, resources] = await Promise.all([readVisualPlan(jobId).catch(() => null), readDraft(jobId), readNarration(jobId), readVisualResources(jobId)]);
  const plan = normalizeCover(normalizeVisualPlanVisibleText(visualPlanSchema.parse({...parsedInput, planVersion: (current?.planVersion ?? 0) + 1, createdAt: new Date().toISOString()}), draft.narrationSegments), draft.title);
  validateVisualPlan(plan, draft, narration, profile, resources, {allowIncompleteImage: true});
  await fs.rm(path.join(jobDir(jobId), "visual-plans"), {recursive: true, force: true});
  await atomicWriteJson(currentPlanPath(jobId), plan);
  // 镜头结构变化后，旧 Manifest 与成片不再代表当前任务。
  await Promise.all([
    fs.rm(path.join(jobDir(jobId), "manifest.json"), {force: true}),
    fs.rm(path.join(jobDir(jobId), "output.mp4"), {force: true}),
  ]);
  return plan;
};

export const retimeCopiedVisualPlan = async (jobId: string) => {
  // 派生英文视频保留镜头结构，但必须在英文 TTS 后以英文真实时间轴重新标定。
  const [plan, narration] = await Promise.all([readVisualPlan(jobId), readNarration(jobId)]);
  const timingById = new Map(narration.segments.map((segment) => [segment.id, segment]));
  const scenes = plan.scenes.map((scene) => {
    const siblings = plan.scenes.filter((item) => item.segmentId === scene.segmentId);
    const oldStart = siblings[0]!.startMs;
    const oldEnd = siblings.at(-1)!.endMs;
    const next = timingById.get(scene.segmentId);
    if (!next || oldEnd <= oldStart) return scene;
    const duration = next.endMs - next.startMs;
    const startRatio = (scene.startMs - oldStart) / (oldEnd - oldStart);
    const endRatio = (scene.endMs - oldStart) / (oldEnd - oldStart);
    return {...scene, startMs: Math.round(next.startMs + duration * startRatio), endMs: Math.round(next.startMs + duration * endRatio)};
  });
  const next = visualPlanSchema.parse({...plan, planVersion: plan.planVersion + 1, createdAt: new Date().toISOString(), scenes});
  await atomicWriteJson(currentPlanPath(jobId), next);
  return next;
};

export const writeVisualPreviewManifest = async (jobId: string, profile: PlatformProfile): Promise<RenderManifest> => {
  const [plan, draft, narration, resources] = await Promise.all([readVisualPlan(jobId), readDraft(jobId), readNarration(jobId), readVisualResources(jobId)]);
  validateVisualPlan(plan, draft, narration, profile, resources);
  // 仅当旧任务确实引用退役姿态时才把它加入新 Manifest，不扩张新任务的人物目录。
  const usedPoseIds = new Set([plan.cover?.presenterPoseId, ...plan.scenes.map((scene) => scene.presenter.poseId)]);
  const presenter = {poses: [...profile.presenter.poses, ...(profile.presenter.compatibilityPoses ?? []).filter((pose) => usedPoseIds.has(pose.id))]};
  const manifest = renderManifestSchema.parse({schemaVersion: "1.0", jobId, contentProfile: {accountId: profile.accountId, seriesId: profile.seriesId, accountVersion: profile.accountVersion, seriesVersion: profile.seriesVersion, outputLanguage: profile.outputLanguage}, title: draft.title, ...(draft.shortTitle ? {shortTitle: draft.shortTitle} : {}), ...(draft.summary ? {summary: draft.summary} : {}), ...(plan.visualStyle ? {visualStyle: plan.visualStyle} : {}), cover: coverForManifest(plan.cover ?? defaultCover(draft.title, plan.scenes[0]!)), captionStyle: draft.captionStyle ?? "narration", video: {width: 1080, height: 1260, fps: 30, outroDurationMs: 3000}, narration: {text: narration.text, audioSrc: "artifact://audio/narration.wav", spokenDurationMs: narration.spokenDurationMs, durationMs: narration.durationMs, model: narration.model, voice: narration.voice}, captions: narration.captions, scenes: deriveScenes(plan, draft, narration, resources), brand: {logoSrc: profile.logoSrc, title: profile.title, subtitle: profile.subtitle, ...(profile.brandOutro ? {outro: profile.brandOutro} : {}), label: profile.displayLabel, downloadPrefix: profile.downloadPrefix}, presenter});
  await atomicWriteJson(path.join(jobDir(jobId), "manifest.json"), manifest);
  return manifest;
};

export const finalizeVisualPlan = writeVisualPreviewManifest;
