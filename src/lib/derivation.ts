import {promises as fs} from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {z} from "zod";
import {atomicWriteJson, initializeNarrationJob, jobDir, readJob, readJson, updateGenerationProgress, updateJobState} from "./jobs";
import {profileContext, readJobPlatformProfile, readPlatformProfile, type PlatformProfile} from "./profile";
import {loadTranslationSystemPrompt, loadTranslationUserPrompt, loadTranslationStagePrompt, renderTranslationPrompt} from "./narration-prompts";
import {readPipelineSettings} from "./pipeline-settings";
import {startTranslationWorker} from "./processes";
import {DRAFT_ROOT} from "./paths";
import type {VisualResources} from "./visual-resources";
import {assertTranslationText, splitApprovedTranslation, translationTextSchema, translationTokens, type TranslationReview, type TranslationText} from "./translation-review";

type Draft = {title: string; shortTitle?: string; summary?: string; narrationSegments: Array<{id: string; spokenText: string; pauseAfter: string}>; [key: string]: unknown};
type Plan = {scenes: Array<{id: string; content: Record<string, unknown>; visualData?: Record<string, unknown>; [key: string]: unknown}>; [key: string]: unknown};
type ParentSnapshot = {draft: Draft; visualPlan: Plan; visualResources?: VisualResources};

export const preserveVisualPlanStructure = (source: Plan, translated: Plan): Plan => {
  if (source.scenes.length !== translated.scenes.length) throw new Error("英文派生翻译不能改变母稿镜头数量");
  const scenes = source.scenes.map((scene, index) => {
    const translatedScene = translated.scenes[index];
    if (!translatedScene || translatedScene.segmentId !== scene.segmentId) throw new Error("英文派生翻译不能改变母稿镜头顺序");
    // 普通文案和关系图文字均由路径回填；模板、时间轴及图形结构不交给模型重写。
    return {...scene, content: translatedScene.content, ...(scene.visualData ? {visualData: translatedScene.visualData ?? scene.visualData} : {})};
  });
  return {...source, scenes};
};

const requestTranslationModel = async (profile: PlatformProfile, model: string | undefined, system: string, prompt: string): Promise<unknown> => {
  const settings = await readPipelineSettings(profile);
  if (!settings.deepseek.apiKey) throw new Error("环境变量 DEEPSEEK_API_KEY 未设置");
  const response = await fetch(`${settings.deepseek.baseUrl}/chat/completions`, {
    method: "POST", signal: AbortSignal.timeout(600_000),
    headers: {"Content-Type": "application/json", Authorization: `Bearer ${settings.deepseek.apiKey}`},
    body: JSON.stringify({model: model ?? profile.defaultTextModel ?? "deepseek-v4-flash", messages: [{role: "system", content: system}, {role: "user", content: prompt}], response_format: {type: "json_object"}}),
  });
  if (!response.ok) throw new Error(`英文派生处理失败：HTTP ${response.status}`);
  const body = await response.json() as {choices?: Array<{message?: {content?: string}}>};
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("英文派生处理未返回内容");
  return JSON.parse(content);
};

export const readTranslationReview = (jobId: string) => readJson<TranslationReview>(path.join(jobDir(jobId), "translation.json"));

// 文件锁只覆盖状态领取及保存，跨请求/进程阻止重复启动；模型调用由后台状态锁定编辑。
const withTranslationLock = async <T>(jobId: string, action: () => Promise<T>): Promise<T> => {
  const lockPath = path.join(jobDir(jobId), ".translation.lock");
  const lock = await fs.open(lockPath, "wx").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new Error("译稿正在保存或提交，请稍后再试");
    throw error;
  });
  try { return await action(); }
  finally { await lock.close(); await fs.unlink(lockPath); }
};

export const submitTranslation = async (jobId: string, action: "save" | "generate" | "confirm", translated?: TranslationText) => withTranslationLock(jobId, async () => {
  const job = await readJob(jobId);
  const review = await readTranslationReview(jobId);
  if (job.derivationKind !== "translation" || job.state !== "awaiting_translation_review" || review.confirmedAt) throw new Error("当前状态不能编辑或提交全文译稿");
  if (action !== "generate") {
    const input = translationTextSchema.parse(translated);
    if (action === "confirm") assertTranslationText(input);
    await atomicWriteJson(path.join(jobDir(jobId), "translation.json"), {...review, translated: input, failedStage: input.text === review.translated.text ? review.failedStage : undefined, updatedAt: new Date().toISOString()});
  }
  if (action === "save") return;
  await updateJobState(jobId, {state: action === "generate" ? "translating" : "segmenting_translation", error: null});
  try { await startTranslationWorker(jobId, action); }
  catch (error) {
    await updateJobState(jobId, {state: "awaiting_translation_review", error: error instanceof Error ? error.message : String(error)});
    throw error;
  }
});

export const prepareEnglishTask = async (parentJobId: string, targetSeriesId: string, childJobId: string) => {
  const parent = await readJob(parentJobId);
  if (parent.state !== "completed") throw new Error("仅已完成的中文视频可以派生英文视频");
  const parentProfile = await readJobPlatformProfile(parent.contentProfile);
  const target = await readPlatformProfile(parentProfile.accountId, targetSeriesId);
  if (target.kind !== "derived" || target.sourceSeriesId !== parentProfile.seriesId || target.outputLanguage !== "en-US") throw new Error("目标专栏不是该中文视频可用的英文派生专栏");
  const parentDir = jobDir(parentJobId);
  const [source, draft, plan, resources] = await Promise.all([
    readJson<Record<string, unknown>>(path.join(parentDir, "source.json")), readJson<Draft>(path.join(parentDir, "draft.json")),
    readJson<Plan>(path.join(parentDir, "visual-plan.json")), readJson<unknown>(path.join(parentDir, "visual-resources.json")),
  ]);
  if (!draft.narrationSegments?.length) throw new Error("母任务缺少确认口播稿");
  await initializeNarrationJob(childJobId, profileContext(target), {textModel: target.defaultTextModel});
  const childDir = jobDir(childJobId);
  try {
    // 快照和上传资源独立复制；后续翻译和分段不再读取可能被修改的母任务。
    const review: TranslationReview = {
      schemaVersion: "1.0",
      source: {title: draft.title, shortTitle: draft.shortTitle ?? "", summary: draft.summary ?? "", text: draft.narrationSegments.map((segment) => segment.spokenText).join("\n\n")},
      translated: {title: "", shortTitle: "", summary: "", text: ""}, updatedAt: new Date().toISOString(),
    };
    await Promise.all([
      atomicWriteJson(path.join(childDir, "source.json"), {...source, derivedFromJobId: parentJobId, derivedFromLanguage: "zh-CN"}),
      atomicWriteJson(path.join(childDir, "translation.json"), review),
      atomicWriteJson(path.join(childDir, "translation-source.json"), {draft, visualPlan: plan, visualResources: resources}),
      atomicWriteJson(path.join(childDir, "visual-resources.json"), resources),
      fs.cp(path.join(parentDir, "uploaded-images"), path.join(childDir, "uploaded-images"), {recursive: true, force: false}).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }),
    ]);
    const job = await readJob(childJobId);
    await atomicWriteJson(path.join(childDir, "job.json"), {...job, parentJobId, derivationKind: "translation", state: "awaiting_translation_review", error: null, updatedAt: new Date().toISOString()});
  } catch (error) {
    await updateJobState(childJobId, {state: "failed", error: error instanceof Error ? error.message : String(error)});
    throw error;
  }
  return childJobId;
};

export const deriveEnglishTask = async (parentJobId: string, targetSeriesId: string, childJobId: string) => {
  // 准备快照与启动后台任务分开，启动失败时仍保留可编辑、可重试的子任务。
  await prepareEnglishTask(parentJobId, targetSeriesId, childJobId);
  await submitTranslation(childJobId, "generate").catch(() => undefined);
  return childJobId;
};

// 画面文本用路径键回填；模型无权改动对象结构、数值、代码和资源字段。
export const visualTranslationSlots = (content: Record<string, unknown>) => {
  const slots: Record<string, string> = {};
  const visit = (value: unknown, pointer: string, key: string) => {
    if (/^(?:id|source|target|.*Id|.*Ids|.*Src|src|path|.*Path|code|language|type|kind|.*Type|.*Style|.*Color|color|.*Font|fontFamily|.*Mode|.*Position|.*Direction|.*Align|.*Shape|shape)$/u.test(key)) return;
    // 原稿里已有英文的绑定词也重新匹配，避免人工译稿换词后留下失效的触发词。
    if (typeof value === "string") { if (/\p{Script=Han}/u.test(value) || ((key === "cueText" || /\/polygons\/\d+\/text$/.test(pointer)) && value.trim())) slots[pointer] = value; }
    else if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${pointer}/${index}`, key));
    else if (value && typeof value === "object") Object.entries(value).forEach(([name, item]) => visit(item, `${pointer}/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`, name));
  };
  visit(content, "", "");
  return slots;
};

type VisualTranslationIssue = {pointer: string; source: string; translated: unknown; reason: string};
const decodePointer = (pointer: string) => pointer.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
const normalizeBinding = (text: string) => text.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();

// 将缺失、空值、中文残留和绑定不匹配分开诊断，错误必须能定位到具体字段。
export const visualTranslationIssues = (slots: Record<string, string>, translated: Record<string, unknown>, narrationByScene?: Record<string, string>): VisualTranslationIssue[] => Object.entries(slots).flatMap(([pointer, source]) => {
  const value = translated[pointer];
  const reason = value === undefined ? "模型未返回该字段"
    : typeof value !== "string" ? "译文不是文本"
    : !value.trim() ? "译文为空"
    : /\p{Script=Han}/u.test(value) ? "译文仍含中文"
    : /\/polygons\/\d+\/text$/.test(pointer) && narrationByScene && !(narrationByScene[decodePointer(pointer)[0]!] ?? "").includes(value.trim()) ? "多边形绑定必须逐字摘自该段英文确认稿"
    : pointer.endsWith("/cueText") && narrationByScene && !normalizeBinding(narrationByScene[decodePointer(pointer)[0]!] ?? "").includes(normalizeBinding(value)) ? "口播绑定未出现在该镜头的英文确认稿中"
    : null;
  return reason ? [{pointer, source, translated: value ?? null, reason}] : [];
});

const visualIssueMessage = (issues: VisualTranslationIssue[]) => `画面翻译失败（${issues.length} 个字段）：\n${issues.map((issue) => {
  const [scene, ...field] = decodePointer(issue.pointer);
  return `镜头 ${scene} · ${field.join(" / ")}：${issue.reason}。原文：${issue.source}；译文：${issue.translated === null ? "（未返回）" : JSON.stringify(issue.translated)}`;
}).join("\n")}\n已保留分段和有效译文，可重试画面翻译。`;

export const applyVisualTranslations = (content: Record<string, unknown>, slots: Record<string, string>, translated: Record<string, string>) => {
  const issues = visualTranslationIssues(slots, translated);
  if (issues.length) throw new Error(visualIssueMessage(issues));
  const copy = structuredClone(content);
  for (const pointer of Object.keys(slots)) {
    // 文案中的数字准确性由翻译提示词约束；仅回填原有路径，忽略模型额外返回的字段。
    const parts = decodePointer(pointer);
    let parent: Record<string, unknown> = copy;
    for (const part of parts.slice(0, -1)) parent = parent[part] as Record<string, unknown>;
    parent[parts.at(-1)!] = translated[pointer];
  }
  return copy;
};

const translationSignature = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const optionalTranslationFile = async <T>(file: string): Promise<T | null> => {
  try { return await readJson<T>(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
};

const translateVisualFields = async (jobId: string, template: string, approvedTranslation: TranslationText, slots: Record<string, string>, narrationByScene: Record<string, string>, request: (system: string, prompt: string) => Promise<unknown>) => {
  const directory = jobDir(jobId);
  const signature = translationSignature({template, approvedTranslation, slots, narrationByScene});
  const cachePath = path.join(directory, "translation-visual-progress.json");
  const cached = await optionalTranslationFile<{signature: string; translated: Record<string, string>}>(cachePath);
  const translated: Record<string, string> = cached?.signature === signature ? {...cached.translated} : {};
  let issues = visualTranslationIssues(slots, translated, narrationByScene);
  const attempts: Array<{strings: Record<string, string>; response?: unknown; issues?: VisualTranslationIssue[]; error?: string}> = [];
  // 一次自动修复只请求失败字段；后续手动重试继续复用已通过的译文。
  for (let attempt = 0; attempt < 2 && issues.length; attempt++) {
    const pending = Object.fromEntries(issues.map((issue) => [issue.pointer, issue.source]));
    await updateGenerationProgress(jobId, attempt === 0 ? `正在翻译 ${issues.length} 个画面字段…` : `正在重试 ${issues.length} 个未完成的画面字段…`);
    try {
      const response = await request(template, JSON.stringify({approvedTranslation, narrationByScene, strings: pending, previousErrors: issues, acceptedTranslations: translated}));
      const fields = response && typeof response === "object" && !Array.isArray(response) ? response as Record<string, unknown> : {};
      const rejected = visualTranslationIssues(pending, fields, narrationByScene);
      const rejectedPaths = new Set(rejected.map((issue) => issue.pointer));
      for (const pointer of Object.keys(pending)) {
        if (!rejectedPaths.has(pointer)) translated[pointer] = fields[pointer] as string;
        else delete translated[pointer];
      }
      issues = visualTranslationIssues(slots, translated, narrationByScene).map((issue) => rejected.find((item) => item.pointer === issue.pointer) ?? issue);
      attempts.push({strings: pending, response, issues: rejected});
      await atomicWriteJson(cachePath, {signature, translated});
      await atomicWriteJson(path.join(directory, "translation-visual-debug.json"), {signature, attempts, updatedAt: new Date().toISOString()});
    } catch (error) {
      attempts.push({strings: pending, error: error instanceof Error ? error.message : String(error)});
      await atomicWriteJson(path.join(directory, "translation-visual-debug.json"), {signature, attempts, updatedAt: new Date().toISOString()});
      throw new Error(`画面翻译请求失败：${error instanceof Error ? error.message : String(error)}。已保留分段和有效译文，可重试画面翻译。`);
    }
  }
  if (issues.length) throw new Error(visualIssueMessage(issues));
  return translated;
};

export const runTranslation = async (jobId: string, action: "generate" | "confirm") => {
  const job = await readJob(jobId);
  if (job.state !== (action === "generate" ? "translating" : "segmenting_translation")) throw new Error("翻译任务状态已改变");
  const directory = jobDir(jobId);
  let failureStage: "segmentation" | "visual" = "segmentation";
  try {
    const profile = await readJobPlatformProfile(job.contentProfile);
    const review = await readTranslationReview(jobId);
    const request = (system: string, prompt: string) => requestTranslationModel(profile, job.generation?.textModel, system, prompt);
    if (action === "generate") {
      await updateGenerationProgress(jobId, "正在翻译完整口播稿…");
      const [system, template] = await Promise.all([loadTranslationSystemPrompt(profile), loadTranslationUserPrompt(profile)]);
      const translated = translationTextSchema.parse(await request(system, renderTranslationPrompt(template, review.source)));
      assertTranslationText(translated);
      if (Object.values(translated).some((value) => /\p{Script=Han}/u.test(value))) throw new Error("英文译稿仍包含未翻译的中文，请重试或粘贴译稿");
      await atomicWriteJson(path.join(directory, "translation.json"), {...review, translated, failedStage: undefined, updatedAt: new Date().toISOString()});
      await updateJobState(jobId, {state: "awaiting_translation_review", error: null});
      return;
    }
    assertTranslationText(review.translated);
    const parent = await readJson<ParentSnapshot>(path.join(directory, "translation-source.json"));
    const sourceSegments = parent.draft.narrationSegments.map(({id, spokenText}) => ({id, spokenText}));
    const signature = translationSignature({text: review.translated.text, sourceSegments});
    const segmentCachePath = path.join(directory, "translation-segmentation.json");
    const cached = await optionalTranslationFile<{signature: string; starts: number[]}>(segmentCachePath);
    let starts: number[];
    if (cached?.signature === signature) {
      starts = cached.starts;
    } else {
      await updateGenerationProgress(jobId, "正在按原镜头语义分段，保留确认稿文字…");
      const template = await loadTranslationStagePrompt(profile, "segmentation");
      const result = z.object({aligned: z.boolean(), reason: z.string().optional(), starts: z.array(z.number().int())}).parse(await request(template, JSON.stringify({
        sourceSegments, approvedText: review.translated.text, tokens: translationTokens(review.translated.text).map((token, index) => [index, token.text]),
      })));
      if (!result.aligned) throw new Error(`英文全文无法对应原镜头：${result.reason || "请检查译稿是否遗漏、增添或调整了原文顺序"}`);
      starts = result.starts;
    }
    const texts = splitApprovedTranslation(review.translated.text, starts, parent.draft.narrationSegments.length);
    // 保存切分位置，不提前发布正式稿；正文变化后签名失效，必须重新分段。
    await atomicWriteJson(segmentCachePath, {signature, starts});
    const narrationSegments = parent.draft.narrationSegments.map(({id, pauseAfter}, index) => ({id, pauseAfter, spokenText: texts[index]!}));
    failureStage = "visual";
    // 封面是 visual-plan 的独立事实，也要与镜头文案一起翻译；图片路径等结构字段不参与模型输出。
    // 多边形属于资源文件，也必须翻译为对应确认段的原句；模型只接收文字，不接收坐标。
    const resources = parent.visualResources ?? await optionalTranslationFile<VisualResources>(path.join(directory, "visual-resources.json"));
    const resourceKey = (index: number) => `__resource_${index}`;
    const sceneContents = Object.fromEntries(parent.visualPlan.scenes.map((scene) => [scene.id, {content: scene.content, ...(scene.visualData ? {visualData: scene.visualData} : {})}]));
    for (const [index, resource] of (resources?.resources ?? []).entries()) {
      Object.assign(sceneContents, {[resourceKey(index)]: {polygons: resource.polygons.map(({text}) => ({text}))}});
    }
    const translationContents = parent.visualPlan.cover
      ? {...sceneContents, __cover__: {content: parent.visualPlan.cover}}
      : sceneContents;
    const slots = visualTranslationSlots(translationContents);
    const visualTemplate = await loadTranslationStagePrompt(profile, "visual");
    const narrationByScene = Object.fromEntries(parent.visualPlan.scenes.map((scene) => [scene.id, narrationSegments.find((segment) => segment.id === scene.segmentId)?.spokenText ?? ""]));
    for (const [index, resource] of (resources?.resources ?? []).entries()) narrationByScene[resourceKey(index)] = narrationSegments.find((segment) => segment.id === resource.segmentId)?.spokenText ?? "";
    const translatedSlots = await translateVisualFields(jobId, visualTemplate, review.translated, slots, narrationByScene, request);
    const translatedContents = applyVisualTranslations(translationContents, slots, translatedSlots);
    const translatedResources = resources ? {...resources, revision: resources.revision + 1, resources: resources.resources.map((resource, index) => ({...resource,
      polygons: resource.polygons.map((polygon, polygonIndex) => ({...polygon, text: (translatedContents[resourceKey(index)] as {polygons: Array<{text: string}>}).polygons[polygonIndex]!.text})),
    }))} : undefined;
    const translatedCover = translatedContents.__cover__ as {content: Record<string, unknown>} | undefined;
    const visualPlan = {...preserveVisualPlanStructure(parent.visualPlan, {...parent.visualPlan, scenes: parent.visualPlan.scenes.map((scene) => {
      const translated = translatedContents[scene.id] as {content: Record<string, unknown>; visualData?: Record<string, unknown>};
      return {...scene, ...translated};
    })}), ...(translatedCover ? {cover: translatedCover.content} : {})};
    // 先验证完整规划，避免状态已推进第二步后才在快照读取时暴露契约错误。
    const {visualPlanSchema} = await import("./visual-plan");
    visualPlanSchema.parse(visualPlan);
    // 不携带母稿 scenes、术语表及发音覆盖；英文正式稿以确认全文和已复用的规划为准。
    const {scenes: _scenes, glossary: _glossary, ...draftBase} = parent.draft;
    void _scenes; void _glossary;
    const {text: _text, ...metadata} = review.translated;
    void _text;
    const draft = {...draftBase, ...metadata, narrationSegments, glossary: [], language: {sourceLanguage: "zh", outputLanguage: "en-US"}, visualsPlanned: true};
    await atomicWriteJson(path.join(directory, "visual-plan.json"), visualPlan);
    await atomicWriteJson(path.join(directory, "draft.json"), draft);
    if (translatedResources) await atomicWriteJson(path.join(directory, "visual-resources.json"), translatedResources);
    await atomicWriteJson(path.join(DRAFT_ROOT, `translation_${jobId}.json`), draft);
    await atomicWriteJson(path.join(directory, "translation.json"), {...review, failedStage: undefined, confirmedAt: new Date().toISOString(), updatedAt: new Date().toISOString()});
    await updateJobState(jobId, {state: "awaiting_script_review", error: null});
  } catch (error) {
    if (action === "confirm") {
      // 多文件落盘中途失败时退回全文审核，不能留下半份正式稿或错误的确认标记。
      const review = await readTranslationReview(jobId);
      const {confirmedAt: _confirmedAt, ...editable} = review;
      void _confirmedAt;
      await atomicWriteJson(path.join(directory, "translation.json"), {...editable, failedStage: failureStage});
      await Promise.all(["draft.json", "visual-plan.json"].map((file) => fs.rm(path.join(directory, file), {force: true})));
    }
    await updateJobState(jobId, {state: "awaiting_translation_review", error: error instanceof Error ? error.message : String(error)});
    throw error;
  } finally { await updateGenerationProgress(jobId, null); }
};
