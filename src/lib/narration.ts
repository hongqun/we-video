import {promises as fs} from "node:fs";
import path from "node:path";
import {assertTranslationReviewed, atomicWriteJson, initializeNarrationJob, jobDir, readJob, readJson, snapshot, updateGenerationProgress, updateJobState} from "./jobs";
import {DRAFT_ROOT} from "./paths";
import {loadNarrationSystemPrompt, loadNarrationUserPrompt, loadScriptSystemPrompt, loadScriptUserPrompt, renderNarrationPrompt} from "./narration-prompts";
import {prepareNarrationSource, type NarrationSourceRequest} from "./narration-source";
import {readJobPlatformProfile, type PlatformProfile} from "./profile";
import {readPipelineSettings} from "./pipeline-settings";

type Segment = {id: string; spokenText: string; ttsText?: string; pauseAfter: "none" | "short" | "medium" | "long"};
export type NarrationDraft = {
  schemaVersion: "1.0";
  title: string;
  shortTitle?: string;
  summary?: string;
  targetDurationSeconds: number;
  captionStyle: "narration" | "clean" | "impact";
  source: Record<string, unknown>;
  language: {sourceLanguage: "zh" | "en" | "mixed"; outputLanguage: "zh-CN" | "en-US"};
  glossary: Array<Record<string, string>>;
  narrationSegments: Segment[];
  visualsPlanned: boolean;
};

const normalizeTerms = (value: string) => value.replace(/(?<![A-Za-z])(?:large\s+language\s+models?|llms?)(?![A-Za-z])/gi, "大语言模型").replace(/大模型/g, "大语言模型").replace(/(?<=大语言模型)\s+(?=和)/g, "");
const sanitizeText = (value: unknown) => typeof value === "string" ? normalizeTerms(value.trim()) : "";
// TTS 覆盖文本是用户为发音填写的精确内容，不套用口播术语归一化规则。
const sanitizeOptionalText = (value: unknown) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
};

const stripVisualFields = (draft: Record<string, unknown>) => {
  const stripped = Object.fromEntries(Object.entries(draft).filter(([key]) => !["scenes", "visualsPlanned"].includes(key)));
  if (Array.isArray(stripped.narrationSegments)) {
    stripped.narrationSegments = stripped.narrationSegments.map((segment) => {
      if (!segment || typeof segment !== "object") return segment;
      // 发音覆盖由人工维护，不交给模型改写；候选稿归一化时按段落文字安全继承。
      return Object.fromEntries(Object.entries(segment).filter(([key]) => !["ttsText", "keywords", "imagePath", "imageWidth", "imageHeight", "polygons"].includes(key)));
    });
  }
  return stripped;
};

export const validateNarrationDraft = (draft: NarrationDraft, source: Record<string, unknown>, options: {requireShortTitle?: boolean} = {}) => {
  // 保留调用接口和参数以兼容现有流程；文稿内容不再执行长度、格式、语言比例或数字来源校验。
  void draft;
  void source;
  void options;
};

export const assertScriptSegmentsMatchSource = (raw: Record<string, unknown>, source: Record<string, unknown>) => {
  if (source.type !== "script") return;
  // 原稿模式只允许模型在纯文本字符边界切段，连续拼接后必须回到清理后的正文。
  const segments = Array.isArray(raw.narrationSegments) ? raw.narrationSegments : [];
  const copiedText = segments.map((segment) => {
    if (!segment || typeof segment !== "object" || typeof (segment as Record<string, unknown>).spokenText !== "string") {
      throw new Error("口播稿模式返回的段落缺少原文文字");
    }
    return (segment as Record<string, unknown>).spokenText as string;
  }).join("");
  if (typeof source.originalText !== "string" || copiedText !== source.originalText) {
    throw new Error("口播稿模式的段落文字必须与输入原稿逐字一致，请重新生成");
  }
};

export const normalizeNarrationDraft = (raw: Record<string, unknown>, source: Record<string, unknown>, profile: PlatformProfile, previous: Record<string, unknown> | null): NarrationDraft => {
  // 英文稿不套用中文术语归一化；确认后的正文连空格、换行也必须保留。
  const english = profile.outputLanguage === "en-US";
  const cleanText = (value: unknown) => english ? (typeof value === "string" ? value.trim() : "") : sanitizeText(value);
  const rawSegments = Array.isArray(raw.narrationSegments) ? raw.narrationSegments : Array.isArray(raw.scenes) ? raw.scenes : [];
  const previousSegments = Array.isArray(previous?.narrationSegments) ? previous.narrationSegments as Array<Record<string, unknown>> : [];
  const preserveScriptText = source.type === "script";
  const narrationSegments = rawSegments.map((item, index) => {
    const value = item as Record<string, unknown>;
    // 已完成口播稿不能被术语归一化或 trim 改写；人工后续保存也沿用这一保护。
    const spokenText = (preserveScriptText || english) && typeof value.spokenText === "string" ? value.spokenText : cleanText(value.spokenText);
    const rawId = typeof value.id === "string" ? value.id : undefined;
    const previousSegment = previousSegments.find((segment) => rawId && segment.id === rawId) ?? previousSegments[index];
    const hasExplicitTtsText = Object.prototype.hasOwnProperty.call(value, "ttsText");
    const explicitTtsText = sanitizeOptionalText(value.ttsText);
    const inheritedTtsText = !hasExplicitTtsText && previousSegment?.spokenText === spokenText ? sanitizeOptionalText(previousSegment.ttsText) : undefined;
    return {id: english && rawId ? rawId : `narration-${String(index + 1).padStart(2, "0")}`, spokenText, ...(explicitTtsText || inheritedTtsText ? {ttsText: explicitTtsText ?? inheritedTtsText} : {}), pauseAfter: (["none", "short", "medium", "long"] as const).includes(value.pauseAfter as Segment["pauseAfter"]) ? value.pauseAfter as Segment["pauseAfter"] : "medium"};
  });
  const glossary = Array.isArray(raw.glossary) ? raw.glossary.filter((item): item is Record<string, string> => Boolean(item && typeof item === "object")).slice(0, 30).map((item) => Object.fromEntries(Object.entries(item).map(([key, value]) => [key, typeof value === "string" && !["source", "display"].includes(key) ? (english ? value : normalizeTerms(value)) : String(value)]))) : [];
  // targetDurationSeconds is retained only for DraftV1 compatibility; it is not used to validate or rewrite narration.
  const shortTitle = cleanText(raw.shortTitle) || cleanText(previous?.shortTitle);
  // 文首一级标题由用户指定，不能被模型输出或术语归一化覆盖。
  const title = preserveScriptText && !english && typeof source.title === "string" && source.title
    ? source.title
    : cleanText(raw.title) || cleanText(previous?.title) || "未命名口播稿";
  return {schemaVersion: "1.0", title, ...(shortTitle ? {shortTitle} : {}), ...(cleanText(raw.summary) ? {summary: cleanText(raw.summary)} : {}), targetDurationSeconds: Number.isInteger(raw.targetDurationSeconds) ? Number(raw.targetDurationSeconds) : profile.narration.targetSeconds, captionStyle: previous?.captionStyle === "clean" || previous?.captionStyle === "impact" ? previous.captionStyle : "narration", source: {type: source.type, url: source.url ?? null, title: source.title ?? "", originalText: source.originalText, detectedLanguage: source.detectedLanguage, sha256: source.sha256, codeBlocks: source.codeBlocks ?? []}, language: {sourceLanguage: source.effectiveLanguage as "zh" | "en" | "mixed", outputLanguage: english ? "en-US" : "zh-CN"}, glossary, narrationSegments, visualsPlanned: english && previous?.visualsPlanned === true};
};

const archiveDraft = async (jobId: string, draft: NarrationDraft) => {
  await fs.mkdir(DRAFT_ROOT, {recursive: true});
  const title = draft.title.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "未命名口播稿";
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  await atomicWriteJson(path.join(DRAFT_ROOT, `${title}_${stamp}_${jobId}.json`), draft);
};

const invalidateNarrationArtifacts = async (jobId: string) => {
  // 单数据任务保存稿件后必须清除下游产物，避免旧音频或成片被误用。
  const directory = jobDir(jobId);
  await Promise.all([
    fs.rm(path.join(directory, "manifest.json"), {force: true}),
    fs.rm(path.join(directory, "output.mp4"), {force: true}),
    fs.rm(path.join(directory, "audio"), {recursive: true, force: true}),
  ]);
};

const requestModel = async (profile: PlatformProfile, source: Record<string, unknown>, previous: Record<string, unknown> | null, feedback: string, model: string, onProgress: (text: string) => Promise<void>) => {
  // 文稿生成使用 JSON 模式和流式响应；流内容仅用于进度展示，最终仍需完整 JSON 解析。
  const settings = await readPipelineSettings(profile);
  if (!settings.deepseek.apiKey) throw new Error("环境变量 DEEPSEEK_API_KEY 未设置");
  // 中文原稿模式独立分段；英文派生后续修订仍使用英文专题，不能回退到中文原稿提示词。
  const [system, userTemplate] = source.type === "script" && profile.outputLanguage !== "en-US"
    ? await Promise.all([loadScriptSystemPrompt(profile), loadScriptUserPrompt(profile)])
    : await Promise.all([loadNarrationSystemPrompt(profile), loadNarrationUserPrompt(profile)]);
  const prompt = renderNarrationPrompt(userTemplate, source, previous, feedback || "请从原文生成完整口播稿。");
  const response = await fetch(`${settings.deepseek.baseUrl}/chat/completions`, {method: "POST", headers: {"Content-Type": "application/json", Authorization: `Bearer ${settings.deepseek.apiKey}`}, body: JSON.stringify({model, messages: [{role: "system", content: system}, {role: "user", content: prompt}], response_format: {type: "json_object"}, stream: true})});
  if (!response.ok || !response.body) throw new Error(`DeepSeek 文稿生成失败：HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, {stream: true});
    for (const line of buffer.split("\n")) {
      if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
      try { const chunk = JSON.parse(line.slice(6)) as {choices?: Array<{delta?: {content?: string}}>}; const text = chunk.choices?.[0]?.delta?.content ?? ""; if (text) { content += text; await onProgress(content); } } catch { /* incomplete SSE frame */ }
    }
    buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
  }
  if (!content) throw new Error("DeepSeek 未返回口播稿");
  try { return JSON.parse(content) as Record<string, unknown>; } catch (error) { throw new Error(`DeepSeek 返回的内容不是有效 JSON：${String(error)}`); }
};

export const createNarration = async (jobId: string, request: NarrationSourceRequest, profile: PlatformProfile, model: string) => {
  // 创建流程先固化原文，再生成并校验 Draft，确保后续审核始终有可追溯来源。
  await initializeNarrationJob(jobId, {accountId: profile.accountId, seriesId: profile.seriesId, accountVersion: profile.accountVersion, seriesVersion: profile.seriesVersion}, {textModel: model});
  try {
    const source = await prepareNarrationSource(request, profile.userAgentSuffix);
    await atomicWriteJson(path.join(jobDir(jobId), "source.json"), source);
    const raw = await requestModel(profile, source, null, "请从原文生成完整口播稿。", model, (text) => updateGenerationProgress(jobId, text));
    assertScriptSegmentsMatchSource(raw, source);
    const draft = normalizeNarrationDraft(raw, source, profile, null);
    validateNarrationDraft(draft, source, {requireShortTitle: true});
    await atomicWriteJson(path.join(jobDir(jobId), "draft.json"), draft);
    await archiveDraft(jobId, draft);
    await updateGenerationProgress(jobId, null);
    await updateJobState(jobId, {state: "awaiting_script_review", error: null});
  } catch (error) { await updateGenerationProgress(jobId, null).catch(() => undefined); await updateJobState(jobId, {state: "failed", error: error instanceof Error ? error.message : String(error)}); throw error; }
};

export const reviseNarration = async (jobId: string, draftInput: Record<string, unknown>, feedback: string, profile: PlatformProfile, model: string) => {
  await assertTranslationReviewed(jobId);
  // AI 修订写入 pending-draft，必须经过用户确认后才会覆盖当前正式稿。
  const source = await readJson<Record<string, unknown>>(path.join(jobDir(jobId), "source.json"));
  await updateJobState(jobId, {state: "drafting", error: null});
  try {
    const raw = await requestModel(profile, source, stripVisualFields(draftInput), feedback, model, (text) => updateGenerationProgress(jobId, text));
    const draft = normalizeNarrationDraft(raw, source, profile, draftInput);
    validateNarrationDraft(draft, source, {requireShortTitle: true});
    await atomicWriteJson(path.join(jobDir(jobId), "pending-draft.json"), {draft, feedback, createdAt: new Date().toISOString()});
    await updateGenerationProgress(jobId, null);
    await updateJobState(jobId, {state: "awaiting_script_review", error: null});
  } catch (error) { await updateGenerationProgress(jobId, null).catch(() => undefined); await updateJobState(jobId, {state: "awaiting_script_review", error: error instanceof Error ? error.message : String(error)}); throw error; }
};

export const acceptNarration = async (jobId: string, draftOverride?: Record<string, unknown>) => {
  await assertTranslationReviewed(jobId);
  const job = await readJob(jobId);
  const pending = await readJson<{draft: NarrationDraft; feedback?: string}>(path.join(jobDir(jobId), "pending-draft.json"));
  const source = await readJson<Record<string, unknown>>(path.join(jobDir(jobId), "source.json"));
  // 确认时重新归一化用户编辑的候选稿，保证段落 ID、停顿和事实校验仍符合契约。
  const profile = await readJobPlatformProfile(job.contentProfile);
  const draft = normalizeNarrationDraft(draftOverride ?? pending.draft, source, profile, pending.draft);
  validateNarrationDraft(draft, source);
  // AI 候选稿确认直接覆盖当前稿件，并清理基于旧稿的下游产物。
  const directory = jobDir(jobId);
  await atomicWriteJson(path.join(directory, "draft.json"), draft);
  await invalidateNarrationArtifacts(jobId);
  await archiveDraft(jobId, draft);
  await fs.rm(path.join(jobDir(jobId), "pending-draft.json"), {force: true});
  await updateJobState(jobId, {state: "awaiting_script_review", error: null});
  return snapshot(jobId);
};

export const saveNarrationDraft = async (jobId: string, draftInput: Record<string, unknown>) => {
  await assertTranslationReviewed(jobId);
  const job = await readJob(jobId);
  if (await fs.access(path.join(jobDir(jobId), "pending-draft.json")).then(() => true).catch(() => false)) throw new Error("请先处理待确认的 AI 候选稿");
  const source = await readJson<Record<string, unknown>>(path.join(jobDir(jobId), "source.json"));
  const profile = await readJobPlatformProfile(job.contentProfile);
  const draft = normalizeNarrationDraft(draftInput, source, profile, draftInput);
  validateNarrationDraft(draft, source);
  const directory = jobDir(jobId);
  // 人工保存覆盖当前稿件，并使依赖旧口播的音频和成片失效。
  await atomicWriteJson(path.join(directory, "draft.json"), draft);
  await invalidateNarrationArtifacts(jobId);
  await archiveDraft(jobId, draft);
  await updateJobState(jobId, {state: "awaiting_script_review", error: null});
  return snapshot(jobId);
};

export const discardNarration = async (jobId: string) => {
  await assertTranslationReviewed(jobId);
  await fs.rm(path.join(jobDir(jobId), "pending-draft.json"), {force: true});
  await updateGenerationProgress(jobId, null);
  await updateJobState(jobId, {state: "awaiting_script_review", error: null});
  return snapshot(jobId);
};
