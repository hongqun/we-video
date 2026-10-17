import path from "node:path";
import sharp from "sharp";
import {jobDir, readJob, readJson, updateGenerationProgress, updateJobState} from "./jobs";
import {readJobPlatformProfile} from "./profile";
import {readPipelineSettings} from "./pipeline-settings";
import {loadVisualSystemPrompt} from "./narration-prompts";
import {readVisualPlan, saveVisualPlan, visualPlanModelOutputSchema, type VisualPlan, type VisualPlanScene} from "./visual-plan";
import {attachPresenterPlan} from "./presenter-planning";
import {readVisualResources} from "./visual-resources";
import {selectSceneTransition} from "./scene-transitions";

type FetchLike = typeof fetch;
type ModelMessage = {content?: string | Array<{type?: string; text?: string}>; reasoning_content?: string};
type ModelResponse = {choices?: Array<{finish_reason?: string; message?: ModelMessage}>};
type ModelCall = (input: unknown, options?: {maxTokens?: number}) => Promise<{raw: string; contentLength: number; finishReason?: string}>;
export type SegmentInfo = {id: string; spokenText: string; startMs: number; endMs: number; durationMs: number; imagePath?: string; imageWidth?: number; imageHeight?: number};

export class VisualPlanHttpError extends Error {
  constructor(message: string, readonly retriable: boolean) { super(message); }
}
export class ContractPlanningError extends Error {}

// 只有首次生成主动选择默认风格；旧计划与重新提取必须保留“缺失即旧漫画”的兼容语义。
export const visualStyleForPlanning = (currentPlan?: VisualPlan | null, feedback?: string) => currentPlan
  ? currentPlan.visualStyle
  : feedback ? undefined : "kinetic-lime";

const modelContent = (message?: ModelMessage) => typeof message?.content === "string" ? message.content : Array.isArray(message?.content) ? message.content.map((part) => part.text ?? "").join("") : "";
const errorText = (error: unknown) => error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
const jsonObject = (raw: string) => JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as unknown;

export const visualPlanWorkerArgument = (argv: string[], name: string) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

export const callVisualPlanModel = async ({endpoint, apiKey, model, system, input, maxTokens = 7000, timeoutMs = 180_000, fetchImpl = fetch}: {endpoint: string; apiKey: string; model: string; system: string; input: unknown; maxTokens?: number; timeoutMs?: number; fetchImpl?: FetchLike}) => {
  // 模型只提取通用文字，不接收模板目录、人物配置或资源数据。
  const response = await fetchImpl(endpoint, {method: "POST", headers: {"Content-Type": "application/json", Authorization: `Bearer ${apiKey}`}, signal: AbortSignal.timeout(timeoutMs), body: JSON.stringify({model, messages: [{role: "system", content: `${system}\n\n只输出合法 JSON 对象，不要添加 Markdown 代码围栏或解释。`}, {role: "user", content: JSON.stringify(input)}], response_format: {type: "json_object"}, thinking: {type: "disabled"}, max_tokens: maxTokens})});
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new VisualPlanHttpError(`DeepSeek 镜头规划失败：HTTP ${response.status}${detail ? `：${detail.slice(0, 300)}` : ""}`, response.status === 429 || response.status >= 500);
  }
  const body = await response.json() as ModelResponse;
  const choice = body.choices?.[0];
  const content = modelContent(choice?.message).trim();
  if (!content) throw new Error(`DeepSeek 未返回镜头文字${choice?.finish_reason ? `（finish_reason=${choice.finish_reason}）` : ""}`);
  return {raw: content, contentLength: content.length, finishReason: choice?.finish_reason};
};

const isTransientNetworkError = (error: unknown) => error instanceof VisualPlanHttpError ? error.retriable : error instanceof Error && (/terminated|fetch failed|econnreset|socket hang up|etimedout|eai_again|timeout|aborted|network/i.test(error.message) || error.cause !== undefined);
export const callWithRetry = async (args: Parameters<typeof callVisualPlanModel>[0]) => {
  try { return await callVisualPlanModel(args); }
  catch (error) {
    if (!isTransientNetworkError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return callVisualPlanModel(args);
  }
};

// 人工上传的图片必须与记录尺寸一致；缺失资源不会自动降级。
export const validateVisualRequirementAssets = async (directory: string, segments: SegmentInfo[]) => Promise.all(segments.map(async (segment) => {
  const fields = [segment.imagePath, segment.imageWidth, segment.imageHeight].filter((value) => value !== undefined).length;
  if (fields && fields !== 3) throw new Error(`段落 ${segment.id} 的图片路径和尺寸不完整`);
  if (!segment.imagePath) return segment;
  const metadata = await sharp(path.join(directory, segment.imagePath)).metadata();
  if (metadata.width !== segment.imageWidth || metadata.height !== segment.imageHeight) throw new Error(`段落 ${segment.id} 的图片尺寸与文件不一致`);
  return segment;
}));

export const runContractPlanning = async ({modelCall, segments, presenterPoses, currentPlan, feedback}: {modelCall: ModelCall; segments: SegmentInfo[]; presenterPoses: Parameters<typeof attachPresenterPlan>[2]; currentPlan?: VisualPlan | null; feedback?: string}) => {
  const response = await modelCall({narrationSegments: segments.map(({id, spokenText}) => ({id, spokenText})), ...(feedback ? {feedback} : {}), ...(currentPlan ? {currentPlan: currentPlan.scenes.map((scene) => ({segmentId: scene.segmentId, content: scene.content}))} : {})}, {maxTokens: 7000});
  const parsed = visualPlanModelOutputSchema.parse(jsonObject(response.raw));
  const byId = new Map(parsed.scenes.map((scene) => [scene.segmentId, scene]));
  const expected = segments.map((segment) => segment.id);
  if (parsed.scenes.length !== segments.length || expected.some((id) => !byId.has(id)) || parsed.scenes.some((scene) => !expected.includes(scene.segmentId))) throw new ContractPlanningError("模型返回的段落 ID 与确认口播不一致");
  const base = segments.map((segment, index): Omit<VisualPlanScene, "presenter"> => {
    const extracted = byId.get(segment.id)!;
    const previousTemplate = currentPlan?.scenes.find((scene) => scene.segmentId === segment.id)?.templateId;
    const middleDefault = previousTemplate && !previousTemplate.startsWith("ip/") ? previousTemplate : segment.imagePath ? "rve/visual-image" : "rve/generic-content";
    // 初始镜头由服务端固化时间和转场，后续人工切分不会回到模型输出层。
    const previousScene = currentPlan?.scenes.find((scene) => scene.segmentId === segment.id);
    return {id: previousScene?.id ?? `plan-${String(index + 1).padStart(2, "0")}`, segmentId: segment.id, startMs: segment.startMs, endMs: segment.endMs, transition: {kind: selectSceneTransition({templateId: middleDefault}, index, segments.length), durationMs: 315}, content: extracted.content, templateId: middleDefault, ...(middleDefault === "rve/3d-model-scene" && previousScene?.modelScene ? {modelScene: previousScene.modelScene} : {})};
  });
  return {scenes: attachPresenterPlan(base, base.map(() => "neutral"), presenterPoses, base.map(() => "hidden")), diagnostics: [{phase: "content-extraction", status: "success", contentLength: response.contentLength, finishReason: response.finishReason}]};
};

const generate = async (jobId: string, feedback?: string) => {
  await updateGenerationProgress(jobId, "正在读取口播、时间轴和视觉资源…");
  const job = await readJob(jobId);
  const profile = await readJobPlatformProfile(job.contentProfile);
  const settings = await readPipelineSettings(profile);
  const directory = jobDir(jobId);
  const [draft, narration, resources, system] = await Promise.all([readJson<{narrationSegments?: Array<{id: string; spokenText: string}>}>(path.join(directory, "draft.json")), readJson<{segments?: Array<{id: string; startMs: number; endMs: number}>}>(path.join(directory, "audio", "narration.json")), readVisualResources(jobId), loadVisualSystemPrompt(profile)]);
  if (!settings.deepseek.apiKey) throw new Error("环境变量 DEEPSEEK_API_KEY 未设置");
  const timingById = new Map((narration.segments ?? []).map((item) => [item.id, item]));
  const resourceById = new Map(resources.resources.map((item) => [item.segmentId, item]));
  const segments = await validateVisualRequirementAssets(directory, (draft.narrationSegments ?? []).map((segment) => {
    const timing = timingById.get(segment.id);
    const resource = resourceById.get(segment.id);
    const startMs = timing?.startMs ?? 0;
    const endMs = timing?.endMs ?? startMs;
    return {id: segment.id, spokenText: segment.spokenText, startMs, endMs, durationMs: endMs - startMs, imagePath: resource?.imagePath, imageWidth: resource?.imageWidth, imageHeight: resource?.imageHeight};
  }));
  const currentPlan = feedback ? await readVisualPlan(jobId).catch(() => null) : null;
  await updateGenerationProgress(jobId, `正在提取 ${segments.length} 个镜头的通用文字…`);
  const modelCall: ModelCall = (input, options) => callWithRetry({endpoint: `${settings.deepseek.baseUrl}/chat/completions`, apiKey: settings.deepseek.apiKey, model: job.generation?.textModel ?? profile.defaultTextModel ?? "deepseek-v4-flash", system, input, maxTokens: options?.maxTokens});
  const planning = await runContractPlanning({modelCall, segments, presenterPoses: profile.presenter.poses, currentPlan, feedback});
  // 新任务默认使用科技简报；兼容 ID 仍为 kinetic-lime，重新提取不改变用户已保存的全片风格。
  const visualStyle = visualStyleForPlanning(currentPlan, feedback);
  const plan = await saveVisualPlan(jobId, {schemaVersion: "1.0", revision: 1, ...(feedback ? {feedback} : {}), ...(visualStyle ? {visualStyle} : {}), ...(currentPlan?.cover ? {cover: currentPlan.cover} : {}), scenes: planning.scenes}, profile);
  await updateGenerationProgress(jobId, `镜头规划完成：${plan.scenes.length} 个镜头。`);
  return plan;
};

export const generateVisualPlan = (jobId: string, feedback?: string) => generate(jobId, feedback);
export const replanVisualPlan = (jobId: string, feedback: string) => generate(jobId, feedback);
export const visualPlanFallbackState = (hasPlan: boolean) => hasPlan ? "awaiting_visual_review" : "awaiting_visual_resources";
export const runVisualPlanWorker = async (_command: "generate" | "replan", jobId: string, feedback?: string) => {
  const job = await readJob(jobId);
  const hasPlan = await readVisualPlan(jobId, job.currentRevision).then(() => true).catch(() => false);
  try {
    await generateVisualPlan(jobId, feedback);
    await updateJobState(jobId, {state: "awaiting_visual_review", error: null});
    await updateGenerationProgress(jobId, null);
  } catch (error) {
    await updateGenerationProgress(jobId, null).catch(() => undefined);
    await updateJobState(jobId, {state: visualPlanFallbackState(hasPlan), error: errorText(error)});
    throw error;
  }
};
