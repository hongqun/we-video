import {promises as fs} from "node:fs";
import path from "node:path";
import type {ArtifactManifest} from "@/remotion/schema";
import {artifactManifestSchema} from "@/remotion/schema";
import {JOBS_ROOT} from "./paths";
import {createRenderArtifactToken} from "./render-access";
import type {ContentProfileContext} from "./profile";
import {manifestNeedsMediaResolution, resolveManifestMedia} from "./manifest-media";
import type {TranslationReview} from "./translation-review";
import {repairFragmentedEnglishCaptions, repairEnglishSegmentCaptions} from "./tts";

// job ID 统一使用 UTC 时间戳。
const JOB_ID_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/;

export const assertJobId = (jobId: string) => {
  if (!JOB_ID_RE.test(jobId)) throw new Error("job id 格式无效");
};

export const jobDir = (jobId: string) => {
  assertJobId(jobId);
  return path.join(JOBS_ROOT, jobId);
};

// 过渡期仅为共享调用提供任务根目录，不再创建或读取 r001 子目录。
export const revisionDir = (jobId: string, revision?: number) => { void revision; return jobDir(jobId); };

export const readJson = async <T>(file: string): Promise<T> =>
  JSON.parse(await fs.readFile(file, "utf8")) as T;

// 同一进程内对同一文件的写串行化:tmp 只按 pid 命名时,同进程并发的两次写会共用 tmp 路径,
// 交错后把撕裂内容 rename 进正式文件(实测把 job.json 写成"完整 JSON + 残尾",轮询全部 404)。
const writeQueues = new Map<string, Promise<unknown>>();
let writeSequence = 0;

export const atomicWriteJson = async (file: string, value: unknown) => {
  const previous = writeQueues.get(file) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(async () => {
    await fs.mkdir(path.dirname(file), {recursive: true});
    // tmp 名按写入实例唯一(进程内单调序号),彻底杜绝并发写共用临时文件
    const temporary = `${file}.${process.pid}.${(writeSequence += 1)}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(temporary, file);
  });
  writeQueues.set(file, task);
  try {
    await task;
  } finally {
    if (writeQueues.get(file) === task) writeQueues.delete(file);
  }
};

export const normalizeArtifactManifest = (value: unknown): unknown => {
  // 数学 manifest 同时支持 1080×1260 和 1080×1920，不能再把前者归一化为后者。
  return value;
};

export type JobRecord = {
  jobId: string;
  /** @deprecated 单数据任务恒为 1，仅供尚未迁移的客户端比较请求新旧。 */
  currentRevision: number;
  state: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  renderProgress?: number;
  contentProfile: ContentProfileContext;
  contentMode?: "narration" | "math";
  generation?: {textModel?: string; voiceId?: string; rate?: number};
  generationProgress?: {text: string; updatedAt: string};
  // 派生任务保存母稿关系；任务目录内的内容从此完全独立。
  parentJobId?: string;
  derivationKind?: "translation";
  draftFeedback?: {
    kind: "user_feedback";
    message: string;
    createdAt: string;
  };
  approvals?: Partial<Record<"script" | "audio" | "visual", {confirmedAt: string}>>;
};

export const readJob = async (jobId: string) => {
  const raw = await readJson<Omit<JobRecord, "currentRevision"> & {currentRevision?: number}>(path.join(jobDir(jobId), "job.json"));
  const job = {...raw} as JobRecord;
  // 仅为尚未清理完的客户端比较逻辑提供恒定值；不会被对象展开写回 job.json。
  Object.defineProperty(job, "currentRevision", {value: 1, enumerable: false});
  const content = job.contentProfile;
  if (!content?.accountId || !content.seriesId || !content.accountVersion || !content.seriesVersion) {
    throw new Error("任务缺少账号/专题上下文");
  }
  return job;
};

export const initializeNarrationJob = async (jobId: string, contentProfile: ContentProfileContext, generation: JobRecord["generation"] = {}) => {
  const directory = jobDir(jobId);
  await fs.mkdir(directory, {recursive: true});
  const existing = await optionalJson<Record<string, unknown>>(path.join(directory, "job.json"));
  if (existing) throw new Error(`任务已存在：${jobId}`);
  const now = new Date().toISOString();
  await atomicWriteJson(path.join(directory, "job.json"), {jobId, state: "drafting", error: null, createdAt: now, updatedAt: now, generation, contentProfile});
};

export const jobStateAllowsOutput = (job: Pick<JobRecord, "state">) => job.state === "completed";

export const outputArtifactIsReady = async (job: JobRecord) => {
  if (!jobStateAllowsOutput(job)) return false;
  try {
    const output = await fs.stat(path.join(jobDir(job.jobId), "output.mp4"));
    return output.isFile() && output.size > 0;
  } catch {
    return false;
  }
};

const optionalJson = async <T>(file: string): Promise<T | null> => {
  try {
    return await readJson<T>(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

export const assertTranslationReviewed = async (jobId: string) => {
  // 只有新流程有 translation.json；旧派生任务沿用原流程，不强制重新审核。
  const review = await optionalJson<TranslationReview>(path.join(jobDir(jobId), "translation.json"));
  if (review && !review.confirmedAt) throw new Error("请先在翻译对照页确认全文并完成分段");
};

export const resolveManifestAssets = (
  manifest: ArtifactManifest,
  origin: string,
  renderToken?: string,
): ArtifactManifest => {
  const prefix = `artifact://`;
  if (manifest.contentMode === "math") return manifest;
  const audioSrc = manifest.narration.audioSrc.startsWith(prefix)
    ? `${origin}/api/jobs/${encodeURIComponent(manifest.jobId)}/artifacts/${manifest.narration.audioSrc.slice(prefix.length)}${renderToken ? `?renderToken=${encodeURIComponent(renderToken)}` : ""}`
    : manifest.narration.audioSrc;
  const rewrite = (value: unknown): unknown => {
    if (typeof value === "string" && value.startsWith(prefix)) {
      return `${origin}/api/jobs/${encodeURIComponent(manifest.jobId)}/artifacts/${value.slice(prefix.length)}${renderToken ? `?renderToken=${encodeURIComponent(renderToken)}` : ""}`;
    }
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)]));
    return value;
  };
  return rewrite({...manifest, narration: {...manifest.narration, audioSrc}}) as ArtifactManifest;
};

export const snapshot = async (jobId: string, origin?: string) => {
  const job = await readJob(jobId);
  const directory = jobDir(jobId);
  const translation = await optionalJson<TranslationReview>(path.join(directory, "translation.json"));
  const [source, storedDraft, rawManifest, rawVisualPlan, narration, visualResources] = await Promise.all([
    optionalJson<Record<string, unknown>>(path.join(directory, "source.json")),
    optionalJson<Record<string, unknown>>(path.join(directory, "draft.json")),
    optionalJson<unknown>(path.join(directory, "manifest.json")),
    optionalJson<Record<string, unknown>>(path.join(directory, "visual-plan.json")),
    optionalJson<Record<string, unknown>>(path.join(directory, "audio", "narration.json")),
    optionalJson<Record<string, unknown>>(path.join(directory, "visual-resources.json")),
  ]);
  // 分段结果可能正在逐个落盘；确认标记出现前不向页面暴露半份正式稿或镜头规划。
  const awaitingTranslation = Boolean(translation && !translation.confirmedAt);
  const draft = awaitingTranslation ? null : storedDraft;
  const visualPlan = rawVisualPlan && !awaitingTranslation
    ? await (await import("./visual-plan")).readVisualPlan(jobId)
    : null;
  const pendingDraft = await optionalJson<Record<string, unknown>>(path.join(jobDir(jobId), "pending-draft.json"));
  const sourceManifest = rawManifest;
  const normalizedManifest = sourceManifest ? normalizeArtifactManifest(sourceManifest) : null;
  let parsed = normalizedManifest ? artifactManifestSchema.parse(normalizedManifest) : null;
  // The first review read freezes Logo assets so the reviewer sees their real
  // status before pressing render. Rendering only reuses this frozen manifest.
  if (parsed?.contentMode === "narration" && manifestNeedsMediaResolution(parsed)) {
    parsed = await resolveManifestMedia(parsed, directory);
    await atomicWriteJson(path.join(directory, "manifest.json"), parsed);
  }
  // Player 预览运行在隔离上下文，任务附件需带短期令牌才能读取。
  const previewArtifactToken = origin ? createRenderArtifactToken(jobId) : undefined;
  const manifest = parsed && origin && previewArtifactToken
    ? resolveManifestAssets(parsed, origin, previewArtifactToken)
    : parsed;
  const outputReady = await outputArtifactIsReady(job);
  // 兼容已生成的英文任务：旧版在回退时间轴时将字母逐个保存，读取时按确认稿修复并回写。
  let repairedCaptions = narration && typeof narration.text === "string" && Array.isArray(narration.captions)
    ? repairFragmentedEnglishCaptions(narration.captions as never[], narration.text, Number(narration.durationMs))
    : undefined;
  // 旧派生任务读取时按确认稿修复跨段字幕；中文任务不进入这条迁移路径。
  if (job.derivationKind === "translation" && job.contentProfile.outputLanguage === "en-US" && repairedCaptions && Array.isArray(draft?.narrationSegments) && Array.isArray(narration?.segments)) {
    repairedCaptions = repairEnglishSegmentCaptions(repairedCaptions, draft.narrationSegments, narration.segments);
  }
  const repairedNarration = narration && repairedCaptions && repairedCaptions !== narration.captions
    ? {...narration, captions: repairedCaptions}
    : narration;
  if (narration && repairedNarration !== narration) await atomicWriteJson(path.join(directory, "audio", "narration.json"), repairedNarration);
  // 原生 audio 可能运行在独立预览上下文，使用与画面资源相同的短期令牌，不能只依赖页面 Cookie。
  const audioPreview = repairedNarration
    ? {src: `/api/jobs/${encodeURIComponent(jobId)}/artifacts/audio/narration.wav${previewArtifactToken ? `?renderToken=${encodeURIComponent(previewArtifactToken)}` : ""}`, narration: repairedNarration}
    : null;
  return {job, source, draft, pendingDraft, translation, manifest, visualPlan, visualResources, ...(previewArtifactToken ? {previewArtifactToken} : {}), audioPreview, outputReady};
};

export const updateJobState = async (
  jobId: string,
  values: Partial<Pick<JobRecord, "state" | "error" | "renderProgress">>,
) => {
  const job = await readJob(jobId);
  await atomicWriteJson(path.join(jobDir(jobId), "job.json"), {
    ...job,
    ...values,
    updatedAt: new Date().toISOString(),
  });
};

export const updateJobGeneration = async (
  jobId: string,
  generation: JobRecord["generation"],
) => {
  const job = await readJob(jobId);
  await atomicWriteJson(path.join(jobDir(jobId), "job.json"), {
    ...job,
    generation,
    updatedAt: new Date().toISOString(),
  });
};

export const updateGenerationProgress = async (jobId: string, text: string | null) => {
  const job = await readJob(jobId);
  const next = {...job};
  if (text) next.generationProgress = {text, updatedAt: new Date().toISOString()};
  else delete next.generationProgress;
  await atomicWriteJson(path.join(jobDir(jobId), "job.json"), {...next, updatedAt: new Date().toISOString()});
};

export const recordJobApproval = async (jobId: string, kind: "script" | "audio" | "visual") => {
  const job = await readJob(jobId);
  await atomicWriteJson(path.join(jobDir(jobId), "job.json"), {
    ...job,
    approvals: {...job.approvals, [kind]: {confirmedAt: new Date().toISOString()}},
    updatedAt: new Date().toISOString(),
  });
};

export const clearDraftFeedback = async (jobId: string) => {
  const job = await readJob(jobId);
  if (!job.draftFeedback) return;
  const nextJob = {...job};
  delete nextJob.draftFeedback;
  await atomicWriteJson(path.join(jobDir(jobId), "job.json"), {
    ...nextJob,
    updatedAt: new Date().toISOString(),
  });
};

export const safeArtifactPath = (jobId: string, parts: string[]) => {
  const root = jobDir(jobId);
  const target = path.resolve(root, ...parts);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("文件路径越界");
  return target;
};
