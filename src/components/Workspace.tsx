"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type {ArtifactManifest, Caption, CaptionStyle, RenderManifest, VideoScene} from "@/remotion/schema";
import type {MathRenderManifest} from "@/remotion/math-schema";
import katex from "katex";
import "katex/dist/katex.min.css";
import { videoDownloadFilename } from "@/lib/filename";
import { ReviewPreview } from "./ReviewPreview";
import { AudioReview } from "./AudioReview";
import { Icon, type IconName } from "./Icon";
import {
  templateRegistry,
  SUPPORTED_TEMPLATE_IDS,
  isTemplateAvailableForProfile,
  type TemplateCategory,
} from "@/remotion/templates/registry";

const VideoPlayer = dynamic(
  () => import("./VideoPlayer").then(({VideoPlayer: Component}) => Component),
  {ssr: false},
);
import {ensureMathSummaryTags, formatFormulaForDisplay, formulaCatalog, formulaGroups, type MathFormulaId} from "@/math/formulas";
import {DEFAULT_MATH_MUSIC_OPTIONS, MATH_MUSIC_MANIFEST_URL, isMathMusicManifest, type MathMusicOption} from "@/math/music";
import {MATH_OUTRO_VARIANTS, type MathOutroVariant} from "@/remotion/math-outro-variants";
import {audioDraftSignature, narrationWorkflowStep, reviewAudioStatus, type ReviewAudioStatus} from "@/lib/review";
import {TranslationReview} from "./TranslationReview";
import type {TranslationReview as TranslationReviewData, TranslationText} from "@/lib/translation-review";
import {VisualPlanWorkspace} from "./VisualPlanWorkspace";
import type {VisualPlan, VisualPlanSaveInput} from "@/lib/visual-plan";
import {deleteNarrationSegment, mergeNarrationSegmentWithPrevious, splitNarrationSegment, type EditableNarrationSegment} from "@/lib/narration-segments";

type DraftScene = {
  id: string;
  segmentId: string;
  spokenText: string;
  content: VideoScene["content"];
  templateId: string;
  rollType: VideoScene["rollType"];
  presenterMode: VideoScene["presenterMode"];
  presenterPoseId: VideoScene["presenterPoseId"];
  presenterPlacement: VideoScene["presenterPlacement"];
  presenterFraming?: VideoScene["presenterFraming"];
};
type Draft = {
  title: string;
  shortTitle?: string;
  summary?: string;
  targetDurationSeconds?: number;
  captionStyle?: CaptionStyle;
  language: { sourceLanguage: "zh" | "en" | "mixed"; outputLanguage: "zh-CN" | "en-US" };
  narrationSegments?: Array<{id: string; spokenText: string; ttsText?: string; pauseAfter: "none" | "short" | "medium" | "long"; keywords?: string[]}>;
  visualsPlanned?: boolean;
  scenes: DraftScene[];
  [key: string]: unknown;
};

const normalizeDraftForReview = (draft: Draft | null): Draft | null => {
  if (!draft) return null;
  // 兼容只有 scenes 的旧草稿，先补出可编辑的口播段落，避免特殊发音输入绑定到空数组。
  const segments: Array<{id: string; spokenText: string; ttsText?: string; pauseAfter: "none" | "short" | "medium" | "long"; keywords?: string[]}> = draft.narrationSegments?.length
    ? draft.narrationSegments
    : draft.scenes.map((scene) => ({id: scene.segmentId, spokenText: scene.spokenText, pauseAfter: "medium" as const}));
  // 口播稿只保留文字、停顿和关键词，清除旧任务遗留的视觉字段。
  const narrationSegments = segments.map(({id, spokenText, ttsText, pauseAfter, keywords}) => ({id, spokenText, ...(ttsText ? {ttsText} : {}), pauseAfter, ...(keywords ? {keywords} : {})}));
  if (Array.isArray(draft.scenes)) return {...draft, narrationSegments};
  return {
    ...draft,
    narrationSegments,
    scenes: narrationSegments.map((segment, index) => ({
      id: `narration-${String(index + 1).padStart(2, "0")}`,
      segmentId: segment.id,
      spokenText: segment.spokenText,
      content: {title: `口播段落 ${index + 1}`, subtitle: "", text: "", keywords: [segment.spokenText.slice(0, 8)]},
      templateId: index === 0 ? "ip/opening-stage" : index === segments.length - 1 ? "ip/closing-stage" : "rve/generic-content",
      rollType: index === 0 || index === segments.length - 1 ? "a-roll" : "b-roll",
      presenterMode: index === 0 || index === segments.length - 1 ? "hero" : "hidden",
      presenterPoseId: "neutral",
      presenterPlacement: index === 0 || index === segments.length - 1 ? "hero" : "right-lower",
      presenterFraming: index === 0 || index === segments.length - 1 ? "full" : "waist",
    })),
  };
};

type DraftMetadataEditorProps = {
  draft: Draft;
  busy: boolean;
  disabled: boolean;
  draftChanged: boolean;
  saveStatus: "idle" | "saving" | "saved" | "failed";
  onChange: (patch: Pick<Draft, "title" | "shortTitle" | "summary">) => void;
  onSave: () => void;
};

const DraftMetadataEditor: React.FC<DraftMetadataEditorProps> = ({
  draft,
  busy,
  disabled,
  draftChanged,
  saveStatus,
  onChange,
  onSave,
}) => (
  <section className="panel review-metadata-editor" aria-labelledby="draft-metadata-title">
    <div className="panel-heading">
      <div>
        <h2 id="draft-metadata-title" className="icon-label"><Icon name="edit" />标题与摘要</h2>
      </div>
      <span className="metadata">{draftChanged ? "有未保存修改" : "已保存"}</span>
    </div>
    <label>
      标题
      <input
        value={draft.title}
        disabled={busy || disabled}
        onChange={(event) => onChange({title: event.target.value, shortTitle: draft.shortTitle, summary: draft.summary})}
      />
    </label>
    <label>
      16 字短标题
      <input value={draft.shortTitle ?? ""} maxLength={16} disabled={busy || disabled} onChange={(event) => onChange({title: draft.title, shortTitle: event.target.value, summary: draft.summary})} placeholder="用于短视频平台标题栏和封面文案" />
      <span className="field-hint">{Array.from(draft.shortTitle ?? "").length}/16 字</span>
    </label>
    <label>
      摘要
      <textarea
        rows={4}
        value={draft.summary ?? ""}
        disabled={busy || disabled}
        onChange={(event) => onChange({title: draft.title, shortTitle: draft.shortTitle, summary: event.target.value})}
        placeholder="面向观众的视频简介，结尾附 3~5 个 #话题标签（半角逗号分隔）。"
      />
    </label>
    <div className="actions review-metadata-actions">
      <div>
        {saveStatus === "saving" ? <span className="save-status is-saving">保存中…</span> : null}
        {saveStatus === "saved" && !draftChanged ? <span className="save-status is-saved">已保存</span> : null}
        {saveStatus === "failed" ? <span className="save-status is-failed">保存失败</span> : null}
      </div>
      <button type="button" disabled={busy || disabled || !draftChanged || !draft.title.trim()} onClick={onSave}>
        <Icon name="save" />保存标题、短标题和摘要
      </button>
    </div>
  </section>
);

type MathDraft = Draft & {
  contentMode: "math";
  resolution?: "1080x1260" | "1080x1920";
  formulaId: MathFormulaId;
  formulaLatex: string;
  parameters: Record<string, number>;
  plot: {xMin: number; xMax: number; yMin: number; yMax: number; drawDurationMs: number};
  summary: string;
};
type Settings = {
  textModels: Array<"deepseek-v4-flash" | "deepseek-v4-pro">;
  defaultTextModel: "deepseek-v4-flash" | "deepseek-v4-pro";
  voices: Array<{ id: string; name: string; description: string }>;
  defaultVoiceId: string;
  defaultRate: number;
  generation?: {voiceId?: string; rate?: number; textModel?: "deepseek-v4-flash" | "deepseek-v4-pro"};
};
type RecentJob = {
  jobId: string;
  title: string;
  state: string;
  currentRevision: number;
  updatedAt: string;
};
type LoginFailure = {
  timestamp: string;
  ip: string;
  userAgent: string;
  reason: string;
};
type Snapshot = {
  job: {
    jobId: string;
    currentRevision: number;
    state: string;
    error: string | null;
    renderProgress?: number;
    contentProfile: { accountId: string; seriesId: string; accountVersion: string; seriesVersion: string };
    generation?: { textModel?: string; voiceId?: string; rate?: number };
    generationProgress?: { text: string; updatedAt: string };
    draftFeedback?: {
      kind: "user_feedback";
      message: string;
      fromRevision: number;
      createdAt: string;
    };
    approvals?: Partial<Record<"script" | "audio" | "visual", {revision: number; confirmedAt: string}>>;
  };
  source: {
    originalText: string;
    detectedLanguage: string;
    effectiveLanguage?: string;
  } | null;
  draft: Draft | null;
  translation?: TranslationReviewData | null;
  pendingDraft?: {draft: Draft; feedback: string; fromRevision: number; createdAt: string} | null;
  manifest: ArtifactManifest | null;
  visualPlan?: VisualPlan | null;
  previewArtifactToken?: string;
  visualResources?: {revision?: number; resources: Array<{segmentId: string; sceneId?: string; imagePath?: string; imageWidth?: number; imageHeight?: number; polygons: Array<{text: string; points: Array<{x: number; y: number}>}>}>} | null;
  audioPreview?: {src: string; narration: {durationMs: number; voice?: string; captions?: Caption[]; segments?: Array<{id: string; startMs: number; endMs: number; speechStartMs?: number; speechEndMs?: number}>}} | null;
  outputReady: boolean;
};
type VisualResourcesPayload = NonNullable<Snapshot["visualResources"]>;
type RevisionView = Pick<Snapshot, "source" | "draft" | "manifest" | "outputReady"> & {
  revision: number;
};
type PlatformProfile = {accountId: string; seriesId: string; accountVersion: string; seriesVersion: string; outputLanguage?: "zh-CN" | "en-US"; title: string; subtitle: string; logoSrc: string; displayLabel: string; workspaceName: string; downloadPrefix: string; presenter: NonNullable<RenderManifest["presenter"]>};
type SourceProfile = Pick<PlatformProfile, "accountId" | "seriesId" | "displayLabel">;

const revisionViewFromSnapshot = (value: Snapshot): RevisionView => ({
  revision: value.job.currentRevision,
  source: value.source,
  draft: normalizeDraftForReview(value.draft),
  manifest: value.manifest,
  outputReady: value.outputReady,
});

const buildInfo = {
  version: process.env.NEXT_PUBLIC_APP_VERSION ?? "dev",
  commit: process.env.NEXT_PUBLIC_GIT_COMMIT ?? "",
  commitTime: process.env.NEXT_PUBLIC_GIT_COMMIT_TIME ?? "",
};

const formatCommitTime = (value: string): string => {
  if (!value) return "提交时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "提交时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(date);
};

// 音频进入试听审核后已经有完整快照，停止轮询以免服务端旧草稿覆盖用户正在编辑的内容。
const ACTIVE_STATES = new Set(["drafting", "translating", "segmenting_translation", "synthesizing", "planning_visuals", "finalizing_visuals", "rendering"]);
const EDITOR_LOCKED_STATES = new Set(["drafting", "translating", "segmenting_translation", "synthesizing", "planning_visuals", "finalizing_visuals", "rendering"]);
const DIRECT_APPROVE_STATES = new Set(["awaiting_script_review", "awaiting_review", "awaiting_audio_review", "failed"]);
// 与后端 render 路由保持一致：仅 ready/completed/failed 可启动渲染。
// 其余状态（含 rendering/synthesizing/drafting/awaiting_review）一律禁用按钮，
// 避免重复触发导致后端返回 400「当前状态 X 不能渲染」。
const RENDERABLE_STATES = new Set(["ready", "completed", "failed"]);
const isLegacyNarrationDurationError = (value?: string | null) => Boolean(
  value && /预计口播.+秒.*(?:硬上限|秒上限|不符合本专题)/.test(value),
);
const steps = ["素材输入", "口播审核", "音频试听", "镜头规划", "视频预览", "成片交付"];
const stepIcons: IconName[] = ["file", "edit", "volume", "timeline", "play", "download"];
const jobStateLabels: Record<string, string> = {
  // 派生全文审核使用独立状态，列表与导航共享这些用户可读标签。
  translating: "翻译全文中",
  awaiting_translation_review: "待确认全文译稿",
  segmenting_translation: "分段与画面翻译中",
  drafting: "生成中",
  awaiting_review: "待确认口播稿",
  awaiting_script_review: "待确认口播稿",
  synthesizing: "合成音频",
  awaiting_audio_review: "待确认音频",
  awaiting_visual_resources: "待准备视觉资源",
  planning_visuals: "规划画面",
  finalizing_visuals: "生成视频清单",
  awaiting_visual_review: "待确认镜头规划",
  ready: "视频预览已就绪",
  rendering: "渲染中",
  completed: "已完成",
  failed: "失败",
};
const templateCategoryLabels: Record<TemplateCategory, string> = {
  presenter: "IP 主讲",
  text: "文字",
  content: "内容",
  media: "媒体",
};
const CompatibleTemplatePicker: React.FC<{
  scene: DraftScene;
  profile: {accountId: string; seriesId: string};
  isFirstScene: boolean;
  isLastScene: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
}> = ({scene, profile, isFirstScene, isLastScene, disabled, onSelect}) => {
  const compatible = templateRegistry.filter((template) =>
    SUPPORTED_TEMPLATE_IDS.has(template.id) && isTemplateAvailableForProfile(template, profile) && (
      (isFirstScene && template.id !== "ip/closing-stage" && (template.id === "ip/opening-stage" || template.rollRole === "b-roll"))
      || (isLastScene && !isFirstScene && template.id === "ip/closing-stage")
      || (!isFirstScene && !isLastScene && template.rollRole === "b-roll")
    ),
  );
  return <div className="compatible-template-picker" aria-label="可用模板">
    {compatible.map((template) => <button
      className={`template-option ${scene.templateId === template.id ? "is-selected" : ""}`}
      type="button"
      key={template.id}
      disabled={disabled || !template.adapted}
      aria-pressed={scene.templateId === template.id}
      onClick={() => onSelect(template.id)}
    >
      <span><strong>{template.label}</strong><small>{template.description}</small></span>
      <em>{templateCategoryLabels[template.category]}</em>
    </button>)}
  </div>;
};
const readApiJson = async <T,>(response: Response): Promise<T> => {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    if (
      text.includes("Remotion Studio") ||
      text.trimStart().startsWith("<!DOCTYPE")
    )
      throw new Error(
        "当前页面返回的是 HTML，不是 Video API。请确认浏览器打开的是 Video 工作台地址；本地开发请从 Video 项目根目录运行 npm run dev，并访问 http://127.0.0.1:3100。也可以打开 http://127.0.0.1:3100/api/health 检查服务是否正常",
      );
    throw new Error(
      `Video API 返回了无法解析的响应（HTTP ${response.status}）`,
    );
  }
};

const renderFormula = (latex: string) => katex.renderToString(formatFormulaForDisplay(latex), {throwOnError: false, displayMode: true});

export const Workspace: React.FC = () => {
  const [profile, setProfile] = useState<PlatformProfile | null>(null);
  const [sourceProfiles, setSourceProfiles] = useState<SourceProfile[]>([]);
  const [sourceSeriesId, setSourceSeriesId] = useState("");
  const [appVersion, setAppVersion] = useState(buildInfo.version);
  const [contentMode, setContentMode] = useState<"narration" | "math">("narration");
  const [sourceType, setSourceType] = useState<"text" | "url" | "script">("text");
  const [sourceLanguage, setSourceLanguage] = useState("auto");
  const [input, setInput] = useState("");
  const [mathInstruction, setMathInstruction] = useState("");
  const [mathFormulaSelection, setMathFormulaSelection] = useState<MathFormulaId | "auto">("auto");
  const [mathResolution, setMathResolution] = useState<"1080x1260" | "1080x1920">("1080x1260");
  const [mathHistory, setMathHistory] = useState<Array<MathDraft & {signature: string; createdAt: string}>>([]);
  const [mathHistoryOpen, setMathHistoryOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadedSettingsKey, setLoadedSettingsKey] = useState("");
  const selectedSourceAccountId = sourceProfiles.find((item) => item.seriesId === sourceSeriesId)?.accountId;
  const [textModel, setTextModel] =
    useState<Settings["defaultTextModel"]>("deepseek-v4-flash");
  const [voiceId, setVoiceId] = useState("");
  // 服务端设置加载前的占位值与正式默认语速保持一致，避免初始化时误判用户改动。
  const [speechRate, setSpeechRate] = useState(0.95);
  const [mathMusicOptions, setMathMusicOptions] = useState<MathMusicOption[]>(DEFAULT_MATH_MUSIC_OPTIONS);
  const [mathMusicSrc, setMathMusicSrc] = useState(DEFAULT_MATH_MUSIC_OPTIONS[0].id);
  const [mathOutroVariant, setMathOutroVariant] = useState<MathOutroVariant>("orbit-trace");
  const [jobId, setJobId] = useState<string | null>(null);
  const settingsKey = jobId ? `job:${jobId}` : `source:${selectedSourceAccountId ?? ""}:${sourceSeriesId}`;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [revisionView, setRevisionView] = useState<RevisionView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingDraft, setPendingDraft] = useState<Draft | null>(null);
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(null);
  const [previewSeekRequest, setPreviewSeekRequest] = useState<{sceneId: string; token: number} | null>(null);
  const [, setScriptEditorOpen] = useState(false);
  const [scriptDialogSceneId, setScriptDialogSceneId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const [pendingDelete, setPendingDelete] = useState<{jobId: string; title: string} | null>(null);
  const [loginFailures, setLoginFailures] = useState<LoginFailure[]>([]);
  const [loginFailuresOpen, setLoginFailuresOpen] = useState(false);
  const [loginFailuresBusy, setLoginFailuresBusy] = useState(false);
  const [visualRequirementDialog, setVisualRequirementDialog] = useState<{text: string; result?: string; loading: boolean; error?: string} | null>(null);
  const [visualRequirementCopyStatus, setVisualRequirementCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [coverImageBusy, setCoverImageBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [, setFeedbackOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scriptNotice, setScriptNotice] = useState<string | null>(null);
  // 切换任务后不沿用上一任务的特殊发音提示。
  useEffect(() => { setScriptNotice(null); }, [jobId]);
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [errorCopyStatus, setErrorCopyStatus] = useState<
    "idle" | "copied" | "failed"
  >("idle");
  const [titleCopyStatus, setTitleCopyStatus] = useState<
    "idle" | "copied" | "failed"
  >("idle");
  const [shortTitleCopyStatus, setShortTitleCopyStatus] = useState<
    "idle" | "copied" | "failed"
  >("idle");
  const [summaryCopyStatus, setSummaryCopyStatus] = useState<
    "idle" | "copied" | "failed"
  >("idle");
  const generationOutputRef = useRef<HTMLPreElement | null>(null);
  const previewSeekTokenRef = useRef(0);
  const scriptDialogInputRef = useRef<HTMLInputElement | null>(null);
  const scriptDialogBaselineRef = useRef<DraftScene | null>(null);
  const errorDialogButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const lastPromptedErrorRef = useRef<string | null>(null);

  const refreshRecentJobs = useCallback(async () => {
    const response = await fetch("/api/jobs", { cache: "no-store" });
    const value = await readApiJson<{ jobs?: RecentJob[]; error?: string }>(
      response,
    );
    if (!response.ok) throw new Error(value.error ?? "读取任务列表失败");
    setRecentJobs(value.jobs ?? []);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const contentProfile = snapshot?.job.contentProfile;
    const query = contentProfile
      ? `?accountId=${encodeURIComponent(contentProfile.accountId)}&seriesId=${encodeURIComponent(contentProfile.seriesId)}`
      : "";
    // 打开任务后按任务所属专题加载 profile，避免英文派生任务沿用中文默认标签。
    void fetch(`/api/profile${query}`, {cache: "no-store", signal: controller.signal})
      .then(readApiJson<PlatformProfile & {error?: string}>)
      .then((value) => { if (!value.error) setProfile(value); })
      .catch((cause: unknown) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) return; });
    return () => controller.abort();
  }, [snapshot?.job.contentProfile?.accountId, snapshot?.job.contentProfile?.seriesId]);

  useEffect(() => {
    void fetch(MATH_MUSIC_MANIFEST_URL, {cache: "no-store"})
      .then(readApiJson<unknown>)
      .then((value) => {
        if (!isMathMusicManifest(value) || !value.options.length) return;
        setMathMusicOptions(value.options);
        setMathMusicSrc((current) => value.options.some((option) => option.id === current) ? current : value.options[0].id);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void fetch("/api/version", {cache: "no-store"})
      .then(readApiJson<{version?: string; error?: string}>)
      .then((value) => {
        if (value.version) setAppVersion(value.version);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    // 切换任务时重读专题默认值；恢复人工选择，取消旧请求避免串用上一任务音色。
    const controller = new AbortController();
    const query = new URLSearchParams(jobId ? {jobId} : {
      ...(selectedSourceAccountId ? {accountId: selectedSourceAccountId} : {}),
      ...(sourceSeriesId ? {seriesId: sourceSeriesId} : {}),
    });
    void fetch(`/api/settings?${query}`, {cache: "no-store", signal: controller.signal})
      .then(readApiJson<Settings & {error?: string}>)
      .then((value) => {
        if (controller.signal.aborted) return;
        if (value.error) throw new Error(value.error);
        setSettings(value);
        setTextModel(value.generation?.textModel ?? value.defaultTextModel);
        const savedVoiceId = value.generation?.voiceId ?? value.defaultVoiceId;
        // 专题切换模型后，旧页面可能仍保存上一模型的音色；配置返回后立即回退到当前专题默认音色。
        setVoiceId(value.voices.some((voice) => voice.id === savedVoiceId) ? savedVoiceId : value.defaultVoiceId);
        setSpeechRate(value.generation?.rate ?? value.defaultRate);
        setLoadedSettingsKey(settingsKey);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取设置失败");
      });
    return () => controller.abort();
  }, [jobId, selectedSourceAccountId, sourceSeriesId, settingsKey]);

  useEffect(() => {
    void fetch("/api/profiles", {cache: "no-store"})
      .then(readApiJson<{profiles?: SourceProfile[]; error?: string}>)
      .then((value) => {
        if (value.error) throw new Error(value.error);
        const profiles = value.profiles ?? [];
        setSourceProfiles(profiles);
        setSourceSeriesId((current) => current || profiles[0]?.seriesId || "");
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "读取专栏失败"));
  }, []);

  useEffect(() => {
    void refreshRecentJobs().catch((cause) =>
      setError(cause instanceof Error ? cause.message : "读取任务列表失败"),
    );
  }, [refreshRecentJobs]);

  const refreshMathHistory = useCallback(async () => {
    const response = await fetch("/api/math/history", {cache: "no-store"});
    const value = await readApiJson<{history?: Array<MathDraft & {signature: string; createdAt: string}>; error?: string}>(response);
    if (!response.ok) throw new Error(value.error ?? "读取公式历史失败");
    setMathHistory(value.history ?? []);
  }, []);

  useEffect(() => {
    if (contentMode === "math") void refreshMathHistory().catch(() => undefined);
  }, [contentMode, refreshMathHistory]);

  const refresh = useCallback(async () => {
    if (!jobId) return;
    const response = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
    const value = await readApiJson<Snapshot & { error?: string }>(response);
    if (response.status === 404) return;
    if (!response.ok) throw new Error(value.error ?? "读取任务失败");
    const viewingCurrentRevision = true;
    setSnapshot(value);
    if (viewingCurrentRevision) {
      setRevisionView((current) => {
        const keepPlayingManifest =
          value.job.state === "rendering" &&
          current?.manifest &&
          value.manifest &&
          current.manifest.jobId === value.manifest.jobId &&
          current.manifest.revision === value.manifest.revision;
        return {
          ...revisionViewFromSnapshot(value),
          manifest: keepPlayingManifest ? current.manifest : value.manifest,
        };
      });
      // 资源编辑完成后以服务端 Draft 重建；图片和标注由 visual-resources.json 独立管理。
      setDraft(normalizeDraftForReview(value.draft));
      setPendingDraft(normalizeDraftForReview(value.pendingDraft?.draft ?? null));
    }
  }, [jobId, snapshot?.job.currentRevision]);

  const jobState = snapshot?.job.state;
  useEffect(() => {
    if (!jobId || (jobState && !ACTIVE_STATES.has(jobState))) return;
    const timer = window.setInterval(() => {
      void refresh().catch((cause) =>
        setError(cause instanceof Error ? cause.message : "读取任务失败"),
      );
    }, 800);
    return () => window.clearInterval(timer);
  }, [jobId, jobState, refresh]);

  const createJob = async () => {
    // 文稿模式只提交原文入口和模型选择，视觉规划与文稿生成在后端分阶段执行。
    if (!settings && contentMode === "narration") return;
    setBusy(true);
    setError(null);
    // 新任务切换上下文时清掉上一任务遗留的编辑提示。
    setScriptNotice(null);
    try {
      const body = contentMode === "math"
        ? {type: "math", accountId: "tech123", seriesId: "math-beautiful", instruction: mathInstruction, formulaId: mathFormulaSelection, resolution: mathResolution}
        : sourceType === "url"
          ? { type: "url", url: input, accountId: sourceProfiles.find((item) => item.seriesId === sourceSeriesId)?.accountId, seriesId: sourceSeriesId, sourceLanguage, textModel }
          : sourceType === "script"
            ? { type: "script", text: input, accountId: sourceProfiles.find((item) => item.seriesId === sourceSeriesId)?.accountId, seriesId: sourceSeriesId, sourceLanguage, textModel }
            : { type: "text", text: input, accountId: sourceProfiles.find((item) => item.seriesId === sourceSeriesId)?.accountId, seriesId: sourceSeriesId, sourceLanguage, textModel };
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const value = await readApiJson<{
        jobId?: string;
        state?: string;
        error?: string;
      }>(response);
      if (!response.ok || !value.jobId)
        throw new Error(value.error ?? "生成草稿失败");
      setJobId(value.jobId);
      setSnapshot(null);
      setRevisionView(null);
      setDraft(null);
      setPendingDraft(null);
      setScriptEditorOpen(false);
      setSaveStatus("idle");
      setStep(2);
      if (contentMode === "math") {
        setMathOutroVariant("orbit-trace");
        await refreshMathHistory();
      }
      void refreshRecentJobs();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "生成草稿失败");
    } finally {
      setBusy(false);
    }
  };
  const retryFailedDraft = async () => {
    if (!jobId || !snapshot || snapshot.job.state !== "failed") return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${jobId}/retry`, {method: "POST"});
      const value = await readApiJson<{jobId?: string; error?: string}>(response);
      if (!response.ok || !value.jobId) {
        throw new Error(value.error ?? "重新生成口播稿失败");
      }
      setJobId(value.jobId);
      setSnapshot(null);
      setRevisionView(null);
      setDraft(null);
      setPendingDraft(null);
      setScriptEditorOpen(false);
      setSaveStatus("idle");
      setStep(2);
      void refreshRecentJobs();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "重新生成口播稿失败");
    } finally {
      setBusy(false);
    }
  };
  const enterReview = async (existingJobId: string) => {
    setBusy(true);
    setError(null);
    try {
      let response: Response | null = null;
      let value: (Snapshot & { error?: string }) | undefined;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        response = await fetch(`/api/jobs/${existingJobId}`, {
          cache: "no-store",
        });
        value = await readApiJson<Snapshot & { error?: string }>(response);
        if (response.status !== 404 || attempt === 2) break;
        await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
      if (!response?.ok || !value) throw new Error(value?.error ?? "读取任务失败");
      setJobId(existingJobId);
      setSnapshot(value);
      setRevisionView(revisionViewFromSnapshot(value));
      setDraft(normalizeDraftForReview(value.draft));
      setPendingDraft(normalizeDraftForReview(value.pendingDraft?.draft ?? null));
      if (value.manifest?.contentMode === "math") {
        setMathOutroVariant(value.manifest.outroVariant);
        setMathMusicSrc(value.manifest.musicSrc);
      } else {
        setMathOutroVariant("orbit-trace");
      }
      if (value.job.generation?.voiceId) setVoiceId(value.job.generation.voiceId);
      if (value.job.generation?.rate) setSpeechRate(value.job.generation.rate);
      setScriptEditorOpen(false);
      setSaveStatus("idle");
      setFeedback("");
      setFeedbackOpen(false);
      // 重开派生任务直接恢复全文审核状态，不先跳到第二步。
      setStep(value.translation ? narrationWorkflowStep(value.job.state) : 2);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取任务失败");
    } finally {
      setBusy(false);
    }
  };

  const persistDraft = async (draftToPersist: Draft | null = draft) => {
    if (!jobId || !draftToPersist) throw new Error("没有可保存的草稿");
    const storedDraft: Draft = {...draftToPersist, narrationSegments: draftToPersist.narrationSegments?.map(({id, spokenText, ttsText, pauseAfter, keywords}) => ({id, spokenText, ...(ttsText ? {ttsText} : {}), pauseAfter, ...(keywords ? {keywords} : {})}))};
    if (storedDraft.visualsPlanned !== true) delete (storedDraft as {scenes?: DraftScene[]}).scenes;
    const response = await fetch(`/api/jobs/${jobId}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({draft: storedDraft, baseRevision: snapshot?.job.currentRevision ?? 1}),
    });
    const value = await readApiJson<Snapshot & { error?: string }>(response);
    if (!response.ok) throw new Error(value.error ?? "保存草稿失败");
    setSnapshot(value);
    setRevisionView(revisionViewFromSnapshot(value));
    setDraft(normalizeDraftForReview(value.draft));
    setPendingDraft(normalizeDraftForReview(value.pendingDraft?.draft ?? null));
    return value;
  };
  const saveDraft = async () => {
    if (!draftChanged) {
      setSaveStatus("saved");
      return;
    }
    setBusy(true);
    setSaveStatus("saving");
    setError(null);
    try {
      await persistDraft();
      setSaveStatus("saved");
    } catch (cause) {
      setSaveStatus("failed");
      setError(cause instanceof Error ? cause.message : "保存草稿失败");
    } finally {
      setBusy(false);
    }
  };
  const submitFeedback = async () => {
    if (!jobId || !draft) return;
    const value = feedback.trim();
    if (value.length < 4) {
      setError("反馈内容至少需要 4 个字符");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${jobId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, feedback: value }),
      });
      const result = await readApiJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(result.error ?? "提交 AI 修正失败");
      setFeedback("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "提交 AI 修正失败");
    } finally {
      setBusy(false);
    }
  };
  const acceptPendingDraft = async () => {
    if (!jobId || !pendingDraft) return;
    setBusy(true);
    setError(null);
    try {
      // 确认时提交候选稿当前内容，允许用户先编辑再生成新版本。
      const response = await fetch(`/api/jobs/${jobId}/feedback/accept`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({draft: pendingDraft})});
      const value = await readApiJson<Snapshot & {error?: string}>(response);
      if (!response.ok) throw new Error(value.error ?? "采用候选稿失败");
      setSnapshot(value);
      setRevisionView(revisionViewFromSnapshot(value));
      setDraft(normalizeDraftForReview(value.draft));
      setPendingDraft(null);
      setFeedback("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "采用候选稿失败");
    } finally {
      setBusy(false);
    }
  };
  const discardPendingDraft = async () => {
    if (!jobId || !pendingDraft) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${jobId}/feedback/discard`, {method: "POST"});
      const value = await readApiJson<Snapshot & {error?: string}>(response);
      if (!response.ok) throw new Error(value.error ?? "保留当前稿失败");
      setSnapshot(value);
      setRevisionView(revisionViewFromSnapshot(value));
      setDraft(normalizeDraftForReview(value.draft));
      setPendingDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保留当前稿失败");
    } finally {
      setBusy(false);
    }
  };
  const updatePendingScene = (index: number, spokenText: string) => {
    const existingTtsText = pendingDraft?.narrationSegments?.[index]?.ttsText?.trim();
    setPendingDraft((current) => {
      if (!current) return current;
      const scenes = current.scenes.map((scene, sceneIndex) =>
        sceneIndex === index ? {...scene, spokenText} : scene,
      );
      const narrationSegments = current.narrationSegments?.map((segment, segmentIndex) =>
        segmentIndex === index ? {...segment, spokenText, ttsText: undefined} : segment,
      );
      return {...current, scenes, ...(narrationSegments ? {narrationSegments} : {})};
    });
    // 只有确实存在发音覆盖文本时，修改显示文字才需要提醒用户。
    setScriptNotice(existingTtsText ? "已清空该段特殊发音文本；如仍需特殊读法，请重新填写。" : null);
  };
  const updatePendingTtsText = (index: number, ttsText: string) => {
    setPendingDraft((current) => {
      if (!current) return current;
      const segments = current.narrationSegments?.length
        ? current.narrationSegments
        : current.scenes.map((scene) => ({id: scene.segmentId, spokenText: scene.spokenText, pauseAfter: "medium" as const}));
      const narrationSegments = segments.map((segment, segmentIndex) => segmentIndex === index ? {...segment, ...(ttsText.trim() ? {ttsText: ttsText.trim()} : {ttsText: undefined})} : segment);
      return {...current, narrationSegments};
    });
    setScriptNotice(null);
  };
  const deleteMathHistory = async (signature?: string) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/math/history${signature ? `?signature=${encodeURIComponent(signature)}` : ""}`, {method: "DELETE"});
      const value = await readApiJson<{error?: string}>(response);
      if (!response.ok) throw new Error(value.error ?? "删除公式历史失败");
      await refreshMathHistory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除公式历史失败");
    } finally {
      setBusy(false);
    }
  };
  const autoSaveCurrentDraft = async () => {
    if (!draftChanged) return snapshot;
    setSaveStatus("saving");
    try {
      const value = await persistDraft();
      setSaveStatus("saved");
      return value;
    } catch (cause) {
      setSaveStatus("failed");
      throw cause;
    }
  };
  const requestPreviewSeek = (sceneId?: string | null) => {
    const targetSceneId = sceneId ?? previewSceneId ?? draft?.scenes[0]?.id;
    if (!targetSceneId) return;
    previewSeekTokenRef.current += 1;
    setPreviewSceneId(targetSceneId);
    setPreviewSeekRequest({sceneId: targetSceneId, token: previewSeekTokenRef.current});
  };
  const openScriptForScene = (sceneId?: string) => {
    const targetSceneId = sceneId ?? previewSceneId ?? draft?.scenes[0]?.id;
    const scene = draft?.scenes.find((item) => item.id === targetSceneId);
    if (!scene) return;
    scriptDialogBaselineRef.current = JSON.parse(JSON.stringify(scene)) as DraftScene;
    setPreviewSceneId(scene.id);
    setScriptDialogSceneId(scene.id);
    setError(null);
    setSaveStatus("idle");
  };
  const restoreScriptDialogBaseline = () => {
    const baseline = scriptDialogBaselineRef.current;
    if (!baseline) return;
    setDraft((current) => current
      ? {...current, scenes: current.scenes.map((scene) => scene.id === baseline.id ? baseline : scene)}
      : current,
    );
  };
  const closeScriptDialog = async (save: boolean) => {
    const targetSceneId = scriptDialogSceneId;
    if (!targetSceneId) return;
    if (!save) {
      restoreScriptDialogBaseline();
      scriptDialogBaselineRef.current = null;
      setScriptDialogSceneId(null);
      setSaveStatus("idle");
      return;
    }
    if (!draftChanged) {
      requestPreviewSeek(targetSceneId);
      scriptDialogBaselineRef.current = null;
      setScriptDialogSceneId(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await autoSaveCurrentDraft();
      requestPreviewSeek(targetSceneId);
      scriptDialogBaselineRef.current = null;
      setScriptDialogSceneId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "自动保存草稿失败");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!scriptDialogSceneId) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => scriptDialogInputRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        const baseline = scriptDialogBaselineRef.current;
        if (baseline) {
          setDraft((current) => current
            ? {...current, scenes: current.scenes.map((scene) => scene.id === baseline.id ? baseline : scene)}
            : current,
          );
        }
        scriptDialogBaselineRef.current = null;
        setScriptDialogSceneId(null);
        setSaveStatus("idle");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [busy, scriptDialogSceneId]);
  useEffect(() => {
    if (step !== 2 || !draft) return;
    // 每次段落内容变化后按 scrollHeight 自适应高度，保证审核时能看到完整口播文本。
    const frame = window.requestAnimationFrame(() => {
      document.querySelectorAll<HTMLTextAreaElement>(".script-segment-card textarea").forEach((textarea) => {
        textarea.style.height = "auto";
        textarea.style.height = `${textarea.scrollHeight}px`;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [draft, step]);
  const trigger = async (action: "approve" | "render") => {
    // 配置未就绪时不提交旧任务残留的音色或语速。
    if (action === "approve" && !mathDraft && loadedSettingsKey !== settingsKey) {
      setError("配音配置尚未加载完成，请稍后重试");
      return;
    }
    if (!jobId || !snapshot) return;
    setBusy(true);
    setError(null);
    try {
      const mathSettingsMatchManifest = draft?.contentMode === "math" && revisionView?.manifest?.contentMode === "math" &&
        revisionView.manifest.outroVariant === mathOutroVariant && revisionView.manifest.musicSrc === mathMusicSrc;
      if (action === "approve" && draft?.contentMode === "math" && !draftChanged && mathSettingsMatchManifest && (snapshot.job.state === "ready" || snapshot.job.state === "completed")) {
        const renderResponse = await fetch(`/api/jobs/${jobId}/render`, {method: "POST"});
        const renderValue = await readApiJson<{error?: string; state?: string}>(renderResponse);
        if (!renderResponse.ok) throw new Error(renderValue.error ?? "启动渲染失败");
        await refresh();
        setStep(3);
        return;
      }
      if (action === "approve" && draft?.contentMode === "math") {
        await autoSaveCurrentDraft();
        const response = await fetch(`/api/jobs/${jobId}/approve`, {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({musicSrc: mathMusicSrc, outroVariant: mathOutroVariant}),
        });
        const value = await readApiJson<{error?: string; state?: string}>(response);
        if (!response.ok) throw new Error(value.error ?? "确认公式失败");
        if (value.state === "ready") {
          const renderResponse = await fetch(`/api/jobs/${jobId}/render`, {method: "POST"});
          const renderValue = await readApiJson<{error?: string; state?: string}>(renderResponse);
          if (!renderResponse.ok) throw new Error(renderValue.error ?? "启动渲染失败");
          setStep(3);
        }
        await refresh();
        return;
      }
      if (action === "approve") {
        const savedSnapshot = await autoSaveCurrentDraft();
        if (!voiceId) throw new Error("请先选择配音音色");
        if (!DIRECT_APPROVE_STATES.has(savedSnapshot?.job.state ?? snapshot.job.state)) {
          throw new Error("当前稿件状态不允许生产配音，请稍后重试");
        }
        const response = await fetch(`/api/jobs/${jobId}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({voiceId, rate: speechRate}),
        });
        const value = await readApiJson<{error?: string; state?: string}>(response);
        if (!response.ok) throw new Error(value.error ?? "生产配音失败");
        await refresh();
        return;
      }
      if (draftChanged) {
        await autoSaveCurrentDraft();
        throw new Error("当前稿件已保存，请先生成配音");
      }
      // 成片渲染以服务端 manifest 和音频文件为准，避免客户端旧快照误拦截已有配音。
      const response = await fetch(
        `/api/jobs/${jobId}/${action}`,
        { method: "POST" },
      );
      const value = await readApiJson<{ error?: string; state?: string }>(response);
      if (!response.ok) throw new Error(value.error ?? "操作失败");
      await refresh();
      setStep(mathWorkflow ? 3 : 6);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  const rejectAudio = async () => {
    if (!jobId || !snapshot) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${jobId}/audio/reject`, {method: "POST"});
      const value = await readApiJson<{error?: string}>(response);
      if (!response.ok) throw new Error(value.error ?? "退回口播稿失败");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "退回口播稿失败");
    } finally {
      setBusy(false);
    }
  };
  const saveVisualPlan = async (plan: VisualPlanSaveInput): Promise<VisualPlan> => {
    if (!jobId) throw new Error("当前任务不存在");
    const response = await fetch(`/api/jobs/${jobId}/visual-plan`, {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(plan),
    });
    const result = await readApiJson<{plan?: VisualPlan; error?: string}>(response);
    if (!response.ok || !result.plan) throw new Error(result.error ?? "保存镜头规划失败");
    await refresh();
    return result.plan;
  };
  const replanVisuals = async (visualFeedback: string) => {
    if (!jobId) throw new Error("当前任务不存在");
    const response = await fetch(`/api/jobs/${jobId}/visual-plan/replan`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({feedback: visualFeedback}),
    });
    const result = await readApiJson<{error?: string}>(response);
    if (!response.ok) throw new Error(result.error ?? "重新规划失败");
    await refresh();
  };
  const startVisualPlanning = async () => {
    if (!jobId) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/jobs/${jobId}/visual-plan/generate`, {method: "POST"});
      const result = await readApiJson<{error?: string}>(response);
      if (!response.ok) throw new Error(result.error ?? "启动镜头规划失败");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "启动镜头规划失败"); }
    finally { setBusy(false); }
  };
  const finalizeVisualPlan = async (basePlanVersion: number) => {
    if (!jobId || !snapshot) throw new Error("当前任务不存在");
    if (snapshot.job.state !== "awaiting_visual_review") throw new Error(`当前状态 ${snapshot.job.state} 不能确认镜头规划`);
    const response = await fetch(`/api/jobs/${jobId}/approve`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({baseRevision: snapshot.job.currentRevision, basePlanVersion}),
    });
    const result = await readApiJson<{error?: string}>(response);
    if (!response.ok) throw new Error(result.error ?? "确认镜头规划失败");
    await refresh();
  };
  const deriveEnglishVideo = async () => {
    if (!jobId) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/derive`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({seriesId: "tech-minute-en"})});
      const result = await readApiJson<{jobId?: string; error?: string}>(response);
      if (!response.ok || !result.jobId) throw new Error(result.error ?? "派生英文视频失败");
      // 先读取子任务快照，再切换界面，避免翻译页加载期间闪现普通素材输入表单。
      setScriptNotice(null);
      await enterReview(result.jobId);
      await refreshRecentJobs();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "派生英文视频失败"); }
    finally { setBusy(false); }
  };
  const handleTranslationAction = async (action: "save" | "generate" | "confirm", translated: TranslationText) => {
    if (!jobId) return;
    setBusy(true); setError(null); setScriptNotice(null);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/translation`, {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify(action === "generate" ? {action} : {action, translated}),
      });
      const result = await readApiJson<Snapshot & {error?: string}>(response);
      if (!response.ok) throw new Error(result.error ?? "处理译稿失败");
      setSnapshot(result);
      // 命中缓存时后台可能在本次响应前完成，立即接收正式稿，不能只依赖后续轮询。
      setRevisionView(revisionViewFromSnapshot(result));
      setDraft(normalizeDraftForReview(result.draft));
      setPendingDraft(normalizeDraftForReview(result.pendingDraft?.draft ?? null));
      if (action === "save") setScriptNotice("译稿已保存");
      await refreshRecentJobs();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "处理译稿失败"); }
    finally { setBusy(false); }
  };
  const requestDelete = (targetId: string, title: string) => {
    setPendingDelete({jobId: targetId, title});
  };
  const confirmDelete = async () => {
    const target = pendingDelete;
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${target.jobId}`, {method: "DELETE"});
      const value = await readApiJson<{error?: string}>(response);
      if (!response.ok) throw new Error(value.error ?? "删除失败");
      setRecentJobs((prev) => prev.filter((job) => job.jobId !== target.jobId));
      setPendingDelete(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };
  const updateScene = (index: number, patch: Partial<DraftScene>) => {
    if (!draft) return;
    const spokenText = patch.spokenText;
    const existingTtsText = draft.narrationSegments?.[index]?.ttsText?.trim();
    setDraft({
      ...draft,
      scenes: draft.scenes.map((scene, sceneIndex) =>
        sceneIndex === index ? { ...scene, ...patch } : scene,
      ),
      ...(typeof spokenText === "string" && draft.narrationSegments
        ? {
            narrationSegments: draft.narrationSegments.map((segment, segmentIndex) =>
              segmentIndex === index ? {...segment, spokenText, ttsText: undefined} : segment,
            ),
          }
        : {}),
    });
    // 普通文字修改不再显示误导性提示；仅在实际清掉发音覆盖时提醒。
    if (typeof spokenText === "string") setScriptNotice(existingTtsText ? "已清空该段特殊发音文本；如仍需特殊读法，请重新填写。" : null);
  };
  const updateTtsText = (index: number, ttsText: string) => {
    setDraft((current) => {
      if (!current) return current;
      const segments = current.narrationSegments?.length
        ? current.narrationSegments
        : current.scenes.map((scene) => ({id: scene.segmentId, spokenText: scene.spokenText, pauseAfter: "medium" as const}));
      const narrationSegments = segments.map((segment, segmentIndex) => segmentIndex === index ? {...segment, ...(ttsText.trim() ? {ttsText: ttsText.trim()} : {ttsText: undefined})} : segment);
      return {...current, narrationSegments};
    });
    setScriptNotice(null);
  };
  const replaceNarrationSegments = (segments: readonly EditableNarrationSegment[]) => {
    if (!draft) return;
    // 保存前统一编号，避免拆分后临时段落 ID 与后续音频时间轴串联。
    const narrationSegments = segments.map((segment, index) => ({
      ...segment,
      id: `narration-${String(index + 1).padStart(2, "0")}`,
    }));
    setDraft({...draft, narrationSegments, scenes: narrationSegments.map((segment, index) => ({
      id: segment.id, segmentId: segment.id, spokenText: segment.spokenText,
      content: {title: `口播段落 ${index + 1}`, subtitle: "", text: "", keywords: [segment.spokenText.slice(0, 8)]},
      templateId: index === 0 ? "ip/opening-stage" : index === narrationSegments.length - 1 ? "ip/closing-stage" : "rve/generic-content",
      rollType: index === 0 || index === narrationSegments.length - 1 ? "a-roll" : "b-roll",
      presenterMode: index === 0 || index === narrationSegments.length - 1 ? "hero" : "hidden",
      presenterPoseId: "neutral", presenterPlacement: index === 0 || index === narrationSegments.length - 1 ? "hero" : "right-lower", presenterFraming: index === 0 || index === narrationSegments.length - 1 ? "full" : "waist",
    }))});
  };
  const splitDraftSegment = (index: number, textarea: HTMLTextAreaElement) => {
    if (!draft?.narrationSegments) return;
    try {
      replaceNarrationSegments(splitNarrationSegment(draft.narrationSegments, index, textarea.selectionStart, textarea.selectionStart));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "拆分口播段落失败");
    }
  };
  const mergeDraftSegment = (index: number) => {
    if (!draft?.narrationSegments) return;
    try {
      replaceNarrationSegments(mergeNarrationSegmentWithPrevious(draft.narrationSegments, index));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "合并口播段落失败");
    }
  };
  const deleteDraftSegment = (index: number) => {
    if (!draft?.narrationSegments) return;
    try {
      replaceNarrationSegments(deleteNarrationSegment(draft.narrationSegments, index));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除口播段落失败");
    }
  };
  const generateVisualRequirementInline = async (segmentId: string, spokenText: string, transparentBackground: boolean) => {
    if (!jobId) throw new Error("当前任务不存在");
    const response = await fetch(`/api/jobs/${jobId}/narration-segments/${encodeURIComponent(segmentId)}/visual-requirement`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({transparentBackground, spokenText})});
    const value = await readApiJson<{visualRequirement?: string; error?: string}>(response);
    if (!response.ok || !value.visualRequirement) throw new Error(value.error ?? "生成视觉要求失败");
    return value.visualRequirement;
  };
  const generateCoverImageRequirement = async (coverTitle: string) => {
    setVisualRequirementCopyStatus("idle");
    if (!jobId || !snapshot?.visualPlan) return;
    setVisualRequirementDialog({text: `封面标题：${coverTitle}`, loading: true});
    try {
      const response = await fetch(`/api/jobs/${jobId}/cover/image-requirement`, {method: "POST"});
      const value = await readApiJson<{visualRequirement?: string; error?: string}>(response);
      if (!response.ok || !value.visualRequirement) throw new Error(value.error ?? "生成封面图片要求失败");
      setVisualRequirementDialog((current) => current ? {...current, result: value.visualRequirement, loading: false} : current);
    } catch (cause) {
      setVisualRequirementDialog((current) => current ? {...current, loading: false, error: cause instanceof Error ? cause.message : "生成封面图片要求失败"} : current);
    }
  };
  const uploadCoverImage = async (file: File) => {
    if (!jobId || !snapshot?.visualPlan) return;
    setCoverImageBusy(true);
    try {
      const body = new FormData(); body.append("image", file);
      const response = await fetch(`/api/jobs/${jobId}/cover/image`, {method: "POST", body});
      const value = await readApiJson<{error?: string}>(response);
      if (!response.ok) throw new Error(value.error ?? "封面图片上传失败");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "封面图片上传失败"); }
    finally { setCoverImageBusy(false); }
  };
  const deleteCoverImage = async () => {
    if (!jobId || !snapshot?.visualPlan || !window.confirm("确定删除封面图片吗？")) return;
    setCoverImageBusy(true);
    try {
      const response = await fetch(`/api/jobs/${jobId}/cover/image`, {method: "DELETE"});
      const value = await readApiJson<{error?: string}>(response);
      if (!response.ok) throw new Error(value.error ?? "封面图片删除失败");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "封面图片删除失败"); }
    finally { setCoverImageBusy(false); }
  };
  // 镜头规划使用 scene.id 隔离资源，图片和标注不再进入口播 Draft。
  const uploadSceneImage = async (sceneId: string, segmentId: string, file: File) => {
    if (!jobId || !snapshot || draftChanged) { setError("请先保存口播稿，再上传图片"); return; }
    try {
      const body = new FormData(); body.append("image", file); body.append("sceneId", sceneId);
      const response = await fetch(`/api/jobs/${jobId}/narration-segments/${encodeURIComponent(segmentId)}/image`, {method: "POST", body});
      const result = await readApiJson<{error?: string; imagePath?: string; imageWidth?: number; imageHeight?: number}>(response);
      if (!response.ok || !result.imagePath || !result.imageWidth || !result.imageHeight) throw new Error(result.error ?? "图片上传失败");
      // 图片接口只更新资源快照，不刷新整份 visualPlan，避免覆盖当前尚未保存的模板选择。
      setSnapshot((current) => {
        if (!current) return current;
        const previous = current.visualResources?.resources.find((item) => item.sceneId === sceneId)
          ?? current.visualResources?.resources.find((item) => !item.sceneId && item.segmentId === segmentId);
        const resource = {segmentId, sceneId, imagePath: result.imagePath!, imageWidth: result.imageWidth!, imageHeight: result.imageHeight!, polygons: previous?.polygons ?? []};
        return {...current, visualResources: {revision: (current.visualResources?.revision ?? 1) + 1, resources: [...(current.visualResources?.resources ?? []).filter((item) => item.sceneId !== sceneId), resource]}};
      });
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "图片上传失败"); }
  };
  const deleteSceneImage = async (sceneId: string, segmentId: string) => {
    if (!jobId || !snapshot || !window.confirm("确定删除这张图片及其多边形标注吗？")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/jobs/${jobId}/narration-segments/${encodeURIComponent(segmentId)}/image`, {method: "DELETE", headers: {"Content-Type": "application/json"}, body: JSON.stringify({sceneId})});
      const result = await readApiJson<{error?: string}>(response);
      if (!response.ok) throw new Error(result.error ?? "图片删除失败");
      // 建立场景级空资源，明确屏蔽旧的 segment 图片，并保持当前镜头模板不变。
      setSnapshot((current) => {
        if (!current) return current;
        const resource = {segmentId, sceneId, polygons: []};
        return {...current, visualResources: {revision: (current.visualResources?.revision ?? 1) + 1, resources: [...(current.visualResources?.resources ?? []).filter((item) => item.sceneId !== sceneId), resource]}};
      });
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "图片删除失败"); }
    finally { setBusy(false); }
  };
  const saveScenePolygons = async (sceneId: string, segmentId: string, boxes: Array<{text: string; points: Array<{x: number; y: number}>}>) => {
    if (!jobId) throw new Error("当前任务不存在");
    const persistedBoxes = boxes.filter((box) => box.text.trim()).map((box) => ({...box, text: box.text.trim()}));
    const response = await fetch(`/api/jobs/${jobId}/narration-segments/${encodeURIComponent(segmentId)}/polygons`, {method: "PUT", headers: {"Content-Type": "application/json"}, body: JSON.stringify({sceneId, polygons: persistedBoxes})});
    const result = await readApiJson<{error?: string; resources?: VisualResourcesPayload}>(response);
    if (!response.ok) throw new Error(result.error ?? "保存多边形失败");
    if (result.resources) setSnapshot((current) => current ? {...current, visualResources: result.resources!} : current);
  };
  const selectTemplate = (index: number, id: string) => {
    const template = templateRegistry.find((item) => item.id === id);
    const scene = draft?.scenes[index];
    if (!template?.adapted) {
      setError("该模板仍在适配中，当前画面保持不变");
      return;
    }
    if (!scene) return;
    setPreviewSceneId(scene.id);
    // 首场默认是主讲舞台，切换为 B-roll 时同步人物配置，避免保存时模板与人物角色冲突。
    const presenter = index === 0 && template.rollRole === "b-roll"
      ? {rollType: "b-roll" as const, presenterMode: "hidden" as const, presenterPlacement: "right-lower" as const, presenterFraming: "waist" as const}
      : index === 0
        ? {rollType: "a-roll" as const, presenterMode: "hero" as const, presenterPlacement: "hero" as const, presenterFraming: "full" as const}
        : {};
    updateScene(index, {templateId: id, ...presenter});
  };
  const audioDraftChanged = useMemo(() => Boolean(draft && revisionView?.draft && audioDraftSignature(draft) !== audioDraftSignature(revisionView.draft)), [draft, revisionView?.draft]);
  const draftChanged = audioDraftChanged;
  // 第五步切换可能早于 revisionView 初始化，优先使用当前快照的同版 manifest，避免步骤条下方空白。
  const previewManifest =
    revisionView &&
    !draftChanged &&
    revisionView.manifest?.revision === revisionView.revision
      ? revisionView.manifest
      : !draftChanged
        ? snapshot?.manifest ?? null
        : null;
  const previewShortTitle = previewManifest?.contentMode === "narration"
    ? previewManifest.shortTitle
    : undefined;
  // 页面不再提供历史 revision 切换，工作区始终操作当前 revision。
  const isHistoricalRevision = false;
  const audioStatus: ReviewAudioStatus = snapshot
    ? reviewAudioStatus({
        draftChanged: audioDraftChanged,
        selectedRevision: snapshot.job.currentRevision,
        currentRevision: snapshot.job.currentRevision,
        jobState: snapshot.job.state,
        // 与第五步预览共用同一份 manifest，避免快照兜底时误判为未生成配音。
        manifest: previewManifest,
        voiceId: voiceId || snapshot.job.generation?.voiceId,
      })
    : "missing";
  const editorLocked = Boolean(
    isHistoricalRevision || (snapshot && EDITOR_LOCKED_STATES.has(snapshot.job.state)),
  );
  const scriptDialogSceneIndex = draft && scriptDialogSceneId
    ? draft.scenes.findIndex((scene) => scene.id === scriptDialogSceneId)
    : -1;
  const scriptDialogScene = scriptDialogSceneIndex >= 0 && draft
    ? draft.scenes[scriptDialogSceneIndex]
    : null;
  const scriptDialogTemplate = scriptDialogScene
    ? templateRegistry.find((item) => item.id === scriptDialogScene.templateId)
    : undefined;
  const mathDraft = draft?.contentMode === "math" ? draft as MathDraft : null;
  const mathPreviewManifest = useMemo<MathRenderManifest | null>(() => {
    if (!mathDraft || !snapshot) return null;
    return {
      schemaVersion: "1.0",
      contentMode: "math",
      jobId: snapshot.job.jobId,
      revision: snapshot.job.currentRevision,
      contentProfile: snapshot.job.contentProfile,
      title: mathDraft.title,
      summary: ensureMathSummaryTags(mathDraft.summary, formulaCatalog[mathDraft.formulaId]),
      outroVariant: mathOutroVariant,
      video: {width: 1080, height: mathDraft.resolution === "1080x1260" ? 1260 : 1920, fps: 30, outroDurationMs: 3000},
      formula: {id: mathDraft.formulaId, latex: mathDraft.formulaLatex, parameters: mathDraft.parameters, plot: mathDraft.plot},
      musicSrc: mathMusicSrc,
      brand: {
        logoSrc: profile?.logoSrc ?? "profile-assets/tech123/logo.png",
        title: profile?.title ?? "Tech123",
        subtitle: profile?.subtitle ?? "科学·科技·科创",
        label: profile?.displayLabel ?? "TECH123 · 数学之美",
        downloadPrefix: profile?.downloadPrefix ?? "tech123-math",
      },
    };
  }, [mathDraft, mathMusicSrc, mathOutroVariant, profile, snapshot]);
  const mathWorkflow = contentMode === "math" || mathDraft !== null || previewManifest?.contentMode === "math";
  const stateStep = narrationWorkflowStep(snapshot?.job.state);
  // 渲染阶段失败：manifest 已定稿（音频、镜头规划齐全），失败只发生在导出环节。
  // 这类任务应停留在第 5 步重试渲染，而不是被打回第二步锁死后续操作。
  const failedAtRender = snapshot?.job.state === "failed" && previewManifest !== null && !mathWorkflow;
  const workflowStep = mathWorkflow ? step : failedAtRender ? 5 : stateStep;
  const maxStep = mathWorkflow ? (previewManifest ? 3 : draft ? 2 : 1) : failedAtRender ? 5 : stateStep;
  useEffect(() => {
    if (!mathWorkflow && snapshot?.job.state) setStep(failedAtRender ? 5 : stateStep);
  }, [mathWorkflow, snapshot?.job.jobId, snapshot?.job.state, stateStep, failedAtRender]);
  const visibleSteps = mathWorkflow
    ? [{step: 1, label: "素材"}, {step: 2, label: "审稿"}, {step: 3, label: "成片交付"}]
    : steps.map((label, index) => ({step: index + 1, label: index === 0 && snapshot?.translation ? "翻译对照" : label}));
  const deliverySummary = previewManifest?.summary?.trim() ?? "";
  const rawVisibleError = error ?? snapshot?.job.error ?? "";
  // 失败原因（含 worker 侧音频合成失败，只落在 job.error）必须始终展示在顶部横幅，避免静默失败。
  const visibleError = isLegacyNarrationDurationError(rawVisibleError) ? "" : rawVisibleError;
  // 但失败任务不弹错误模态框：第二步仍允许修改口播；渲染阶段失败（failedAtRender）落在第 5 步重试，
  // 旧错误只展示在顶部横幅，不遮挡重试入口。
  const rawPromptError = error ?? (snapshot?.job.state === "failed" && (step === 2 || failedAtRender) ? "" : snapshot?.job.error ?? "");
  const promptError = isLegacyNarrationDurationError(rawPromptError) ? "" : rawPromptError;
  useEffect(() => {
    if (!promptError) {
      lastPromptedErrorRef.current = null;
      setErrorDialogOpen(false);
      return;
    }
    if (promptError !== lastPromptedErrorRef.current) {
      lastPromptedErrorRef.current = promptError;
      setErrorDialogOpen(true);
    }
  }, [promptError]);
  useEffect(() => {
    if (!errorDialogOpen || !promptError) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => errorDialogButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setErrorDialogOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [errorDialogOpen, promptError]);
  const draftStats = useMemo(() => {
    if (!draft) return null;
    const narration = draft.scenes
      .map((scene) => scene.spokenText.trim())
      .join("\n");
    return {
      sceneCount: draft.scenes.length,
      characterCount: Array.from(narration.replace(/\s/g, "")).length,
    };
  }, [draft]);
  useEffect(() => {
    const output = generationOutputRef.current;
    if (output) output.scrollTop = output.scrollHeight;
  }, [snapshot?.job.generationProgress?.text]);
  useEffect(() => {
    setErrorCopyStatus("idle");
  }, [visibleError]);
  useEffect(() => {
    setTitleCopyStatus("idle");
    setShortTitleCopyStatus("idle");
    setSummaryCopyStatus("idle");
  }, [previewManifest?.revision, previewManifest?.title, previewShortTitle, previewManifest?.summary]);
  const copyText = async (value: string) => {
    // On mobile Safari/embedded browsers, a rejected clipboard promise can
    // consume the click's user activation before the legacy fallback runs.
    // Use the synchronous path first while the click is still active.
    const isTouchDevice = navigator.maxTouchPoints > 0
      || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    const copyWithLegacyApi = () => {
      const textarea = document.createElement("textarea");
      const activeElement = document.activeElement as HTMLElement | null;
      textarea.value = value;
      textarea.setAttribute("aria-hidden", "true");
      textarea.tabIndex = -1;
      textarea.style.position = "fixed";
      textarea.style.top = "0";
      textarea.style.left = "-9999px";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus({preventScroll: true});
      textarea.select();
      textarea.setSelectionRange(0, value.length);
      const copied = document.execCommand("copy");
      textarea.remove();
      activeElement?.focus({preventScroll: true});
      return copied;
    };

    if (isTouchDevice && copyWithLegacyApi()) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
      }
    } catch {
      // Fall through to the legacy copy path for HTTP pages and older browsers.
    }
    if (!copyWithLegacyApi()) throw new Error("复制失败");
  };
  const copyVisualRequirement = async () => {
    const value = visualRequirementDialog?.result;
    if (!value) return;
    try { await copyText(value); setVisualRequirementCopyStatus("copied"); }
    catch { setVisualRequirementCopyStatus("failed"); }
  };
  const copyError = async () => {
    if (!visibleError) return;
    try {
      await copyText(visibleError);
      setErrorCopyStatus("copied");
    } catch {
      setErrorCopyStatus("failed");
    }
  };
  const copyTitle = async () => {
    if (!previewManifest?.title) return;
    try {
      await copyText(previewManifest.title);
      setTitleCopyStatus("copied");
    } catch {
      setTitleCopyStatus("failed");
    }
  };
  const copyShortTitle = async () => {
    if (!previewShortTitle) return;
    try {
      await copyText(previewShortTitle);
      setShortTitleCopyStatus("copied");
    } catch {
      setShortTitleCopyStatus("failed");
    }
  };
  const copySummary = async () => {
    if (!deliverySummary) return;
    try {
      await copyText(deliverySummary);
      setSummaryCopyStatus("copied");
    } catch {
      setSummaryCopyStatus("failed");
    }
  };
  const openLoginFailures = async () => {
    setSettingsOpen(false);
    setLoginFailuresOpen(true);
    setLoginFailuresBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/security/login-failures", {
        cache: "no-store",
      });
      const value = await readApiJson<{
        failures?: LoginFailure[];
        error?: string;
      }>(response);
      if (!response.ok) throw new Error(value.error ?? "读取登录失败日志失败");
      setLoginFailures(value.failures ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取登录失败日志失败");
    } finally {
      setLoginFailuresBusy(false);
    }
  };
  useEffect(() => {
    if (!settingsOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!settingsMenuRef.current?.contains(event.target as Node)) setSettingsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [settingsOpen]);

  const isEnglishProfile = profile?.outputLanguage === "en-US";
  return (
    <main className="workspace">
      <section className="hero">
        <div>
          <p className="eyebrow section-kicker">{profile?.workspaceName ?? "TECH123 / VIDEO STUDIO"}</p>
          <h1 className="hero-title">视频<span className="accent">创作</span>平台</h1>
          <p>从素材到成片，按步骤完成。</p>
          <p className="build-info" title={buildInfo.commit || undefined}>
            v{appVersion}
            {buildInfo.commit ? ` · ${buildInfo.commit}` : ""}
            {` · ${formatCommitTime(buildInfo.commitTime)}`}
          </p>
        </div>
        <div className="hero-actions">
          <div className="settings-menu" ref={settingsMenuRef}>
            <button
              className="secondary icon-label settings-menu-trigger"
              type="button"
              aria-expanded={settingsOpen}
              aria-haspopup="menu"
              onClick={() => setSettingsOpen((open) => !open)}
            >
              <Icon name="settings" />
              设置
              <Icon name="chevron-down" />
            </button>
            {settingsOpen ? (
              <div className="settings-menu-popover" role="menu" aria-label="设置菜单">
                <button
                  className="icon-label"
                  type="button"
                  role="menuitem"
                  onClick={() => void openLoginFailures()}
                >
                  <Icon name="shield" />
                  登录记录
                </button>
              </div>
            ) : null}
          </div>
          {snapshot ? (
            <div className={`status status-${snapshot.job.state}`}>
              {jobStateLabels[snapshot.job.state] ?? snapshot.job.state}
              {snapshot.job.state === "rendering"
                ? ` ${snapshot.job.renderProgress ?? 0}%`
                : ""}
            </div>
          ) : null}
        </div>
      </section>
      {loginFailuresOpen ? (
        <section className="panel login-failures-panel">
          <div className="panel-heading">
            <div>
              <h2>登录记录</h2>
            </div>
            <div className="login-failures-actions">
              <button
                className="secondary icon-label"
                disabled={loginFailuresBusy}
                onClick={() => void openLoginFailures()}
              >
                <Icon name="refresh" />
                {loginFailuresBusy ? "读取中…" : "刷新"}
              </button>
              <button
                className="secondary"
                onClick={() => setLoginFailuresOpen(false)}
              >
                关闭
              </button>
            </div>
          </div>
          {loginFailures.length ? (
            <div className="login-failures-list">
              {loginFailures.map((failure, index) => (
                <article className="login-failure" key={`${failure.timestamp}-${index}`}>
                  <div className="login-failure-meta">
                    <strong>{failure.reason === "invalid_password" ? "密码错误" : failure.reason}</strong>
                    <time dateTime={failure.timestamp}>
                      {new Date(failure.timestamp).toLocaleString("zh-CN")}
                    </time>
                  </div>
                  <div className="login-failure-details">
                    <span>IP：{failure.ip}</span>
                    <span title={failure.userAgent}>设备：{failure.userAgent}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="hint">暂无错误登录记录。</p>
          )}
        </section>
      ) : null}
      <nav className="stepper" aria-label="视频制作步骤">
        {visibleSteps.map(({step: targetStep, label}) => {
          const isCurrent = targetStep === step;
          const isCompleted = targetStep < workflowStep;
          return (
            <button
              key={label}
              className={isCurrent ? "current" : isCompleted ? "completed" : ""}
              aria-current={isCurrent ? "step" : undefined}
              disabled={targetStep > maxStep || busy}
              onClick={() => setStep(targetStep)}
            >
              <span className="stepper-marker">
                {isCompleted ? <Icon name="check" /> : <Icon name={stepIcons[targetStep - 1]} />}
              </span>
              <span className="stepper-label">
                <small>0{targetStep}</small>
                {label}
              </span>
            </button>
          );
        })}
      </nav>
      {visibleError ? (
        <div className="error" role="alert">
          <span className="error-message">{visibleError}</span>
          <button
            className="secondary icon-label error-copy"
            type="button"
            onClick={() => void copyError()}
          >
            <Icon name="copy" />
            {errorCopyStatus === "copied"
              ? "已复制"
              : errorCopyStatus === "failed"
                ? "复制失败"
                : "复制错误"}
          </button>
        </div>
      ) : null}
      {errorDialogOpen && promptError ? (
        <div
          className="confirm-overlay error-prompt-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setErrorDialogOpen(false);
          }}
        >
          <div
            className="confirm-dialog panel error-prompt"
            role="dialog"
            aria-modal="true"
            aria-labelledby="error-prompt-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="error-prompt-title">当前操作无法继续</h2>
            <p className="error-prompt-message">{promptError}</p>
            <p className="hint">
              {promptError === "请先生产配音"
                ? "草稿画面预览仍然保留；生产配音后才能进入试听或生成成片。"
                : "关闭提示后可以继续查看当前预览或处理其他内容。"}
            </p>
            <div className="actions">
              <button
                ref={errorDialogButtonRef}
                type="button"
                onClick={() => setErrorDialogOpen(false)}
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {step === 2 && mathDraft && snapshot ? (
        <section className="panel math-review">
          <div className="panel-heading">
            <div>
              <h2 className="icon-label"><Icon name="sparkles" />公式审稿</h2>
              <p className="hint">随机生成结果 · 可用自然语言微调</p>
            </div>
            <span className="metadata">版本 {snapshot.job.currentRevision}</span>
          </div>
          <h3>{mathDraft.title}</h3>
          <p>{ensureMathSummaryTags(mathDraft.summary, formulaCatalog[mathDraft.formulaId])}</p>
          <section className="math-review-preview">
            <div className="math-history-heading"><strong>实时预览</strong><span className="hint">公式与配乐均来自当前草稿</span></div>
            {mathPreviewManifest ? <VideoPlayer manifest={mathPreviewManifest} /> : null}
          </section>
          <section className="math-outro-picker" aria-labelledby="math-outro-picker-title">
            <div className="math-history-heading">
              <strong id="math-outro-picker-title">片尾动效</strong>
              <span className="hint">固定 3 秒 · 切换后实时预览</span>
            </div>
            <div className="math-outro-options" role="radiogroup" aria-label="数学片尾动效">
              {MATH_OUTRO_VARIANTS.map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  className={`math-outro-option${mathOutroVariant === variant.id ? " is-selected" : ""}`}
                  aria-checked={mathOutroVariant === variant.id}
                  role="radio"
                  disabled={busy || editorLocked}
                  onClick={() => setMathOutroVariant(variant.id)}
                >
                  <span className="math-outro-option-title">{variant.label}</span>
                  <span className="math-outro-option-description">{variant.description}</span>
                </button>
              ))}
            </div>
          </section>
          <label>
            成片分辨率
            <select
              value={mathDraft.resolution ?? "1080x1920"}
              disabled={busy || editorLocked}
              onChange={(event) => setDraft({
                ...mathDraft,
                resolution: event.target.value as "1080x1260" | "1080x1920",
              })}
            >
              <option value="1080x1260">1080×1260 · 与口播一致</option>
              <option value="1080x1920">1080×1920 · 竖屏</option>
            </select>
          </label>
          <DraftMetadataEditor
            draft={mathDraft}
            busy={busy}
            disabled={editorLocked}
            draftChanged={draftChanged}
            saveStatus={saveStatus}
            onChange={(patch) => setDraft({...mathDraft, ...patch})}
            onSave={() => void saveDraft()}
          />
          <div className="math-formula-card">
            <div className="math-formula-display" aria-label="公式" dangerouslySetInnerHTML={{__html: renderFormula(mathDraft.formulaLatex)}} />
            <div className="math-formula-source">{mathDraft.formulaLatex}</div>
            <div className="math-parameter-grid">
              {Object.entries(mathDraft.parameters).map(([key, value]) => <div className="math-parameter" key={key}><span>{key}</span><strong>{Number(value).toFixed(3)}</strong></div>)}
            </div>
          </div>
          <label>
            自然语言微调
            <textarea rows={3} value={feedback} disabled={busy || EDITOR_LOCKED_STATES.has(snapshot.job.state)} onChange={(event) => setFeedback(event.target.value)} placeholder="例如：换一个更复杂的公式，参数变化慢一点。" />
          </label>
          <div className="actions">
            <button className="secondary" disabled={busy || !feedback.trim() || EDITOR_LOCKED_STATES.has(snapshot.job.state)} onClick={() => void submitFeedback()}>重新生成公式</button>
            <button disabled={busy || !(DIRECT_APPROVE_STATES.has(snapshot.job.state) || snapshot.job.state === "ready" || snapshot.job.state === "completed")} onClick={() => void trigger("approve")}><Icon name="arrow-right" />{snapshot.job.state === "completed" ? "再次导出" : "确认公式并导出"}</button>
          </div>
          <div className="math-history-heading">
            <button className="math-history-toggle" type="button" aria-expanded={mathHistoryOpen} onClick={() => setMathHistoryOpen((open) => !open)}>
              <span><strong>公式历史</strong><span className="hint">{mathHistory.length} 条</span></span>
              <span className="icon-label">{mathHistoryOpen ? "收起" : "展开"}<Icon name={mathHistoryOpen ? "chevron-up" : "chevron-down"} /></span>
            </button>
            {mathHistoryOpen ? <button className="secondary" disabled={busy || !mathHistory.length} onClick={() => void deleteMathHistory()}>清空历史</button> : null}
          </div>
          {mathHistoryOpen ? (mathHistory.length ? <div className="math-history-list">{mathHistory.slice(0, 8).map((item) => <div className="math-history-item" key={item.signature}><span>{item.title}</span><button className="secondary" disabled={busy} onClick={() => void deleteMathHistory(item.signature)}>删除</button></div>)}</div> : <p className="hint">暂无公式历史。</p>) : null}
        </section>
      ) : null}
      {step === 2 && draft && snapshot ? <div className="review-meta-grid">
      { !mathDraft ? (
        <section className="panel caption-settings">
          <div>
            <strong className="icon-label"><Icon name="edit" />字幕样式</strong>
          </div>
          <select
            value={draft.captionStyle ?? "narration"}
            disabled={busy || isHistoricalRevision}
            onChange={(event) =>
              setDraft({
                ...draft,
                captionStyle: event.target.value as CaptionStyle,
              })
            }
          >
            <option value="narration">轻量解说 · 半透明底</option>
            <option value="clean">极简白底 · 弱阴影</option>
            <option value="impact">重点强调 · 深色卡片</option>
          </select>
        </section>
      ) : null}
      {(
        <section className="panel audio-settings">
          <div>
            <strong className="icon-label"><Icon name="volume" />{mathDraft ? "配乐选择" : "配音选择"}</strong>
          </div>
          {mathDraft ? <>
            <select value={mathMusicSrc} onChange={(event) => setMathMusicSrc(event.target.value)} disabled={busy || EDITOR_LOCKED_STATES.has(snapshot.job.state)}>
              {mathMusicOptions.map((music) => <option key={music.id} value={music.id}>{music.label}</option>)}
            </select>
            <p className="hint">公式模式不使用 TTS，只播放选定的背景音乐。后续可继续增加配乐。</p>
          </> : <>
            <select
              value={voiceId}
              onChange={(event) => setVoiceId(event.target.value)}
              disabled={busy || loadedSettingsKey !== settingsKey || EDITOR_LOCKED_STATES.has(snapshot.job.state) || isHistoricalRevision}
            >
              {settings?.voices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name} · {voice.description}
                </option>
              ))}
            </select>
            <label className="audio-rate-field">
              <span><strong>语速</strong><output>{speechRate.toFixed(2)}×</output></span>
              <input
                aria-label="配音语速"
                type="range"
                min="0.5"
                max="1.5"
                step="0.05"
                value={speechRate}
                disabled={busy || loadedSettingsKey !== settingsKey || EDITOR_LOCKED_STATES.has(snapshot.job.state) || isHistoricalRevision}
                onChange={(event) => setSpeechRate(Number(event.target.value))}
              />
              <small className="hint">0.5× 较慢 · 1.0× 标准 · 1.5× 较快</small>
            </label>
          </>}
        </section>
      )}
      {draftStats && !mathDraft ? (
        <section className="panel draft-stats" aria-labelledby="draft-stats-title">
          <div className="draft-stats-heading">
            <strong id="draft-stats-title">稿件概览</strong>
            <span>{draftStats.sceneCount} 段 · {draftStats.characterCount} 字</span>
          </div>
          <div className="draft-stats-details">
            <div>
              <span>口播段落</span>
              <strong>{draftStats.sceneCount}</strong>
            </div>
            <div>
              <span>口播字数</span>
              <strong>{draftStats.characterCount}</strong>
            </div>
          </div>
        </section>
      ) : null}
      </div> : null}
      {step === 2 && (!draft || snapshot?.job.state === "drafting") && snapshot?.job.state !== "failed" ? (
        <section className="panel model-stream">
          <div className="panel-heading">
            <div>
            <h2>{draft ? "正在修改口播稿" : "正在生成口播稿"}</h2>
            </div>
            <span>
              {snapshot?.job.generationProgress
                ? `${snapshot.job.generationProgress.text.length} 字`
                : "连接中…"}
            </span>
          </div>
          <pre ref={generationOutputRef}>
            {snapshot?.job.generationProgress?.text || "正在等待模型返回…"}
          </pre>
        </section>
      ) : null}
      {step === 4 && snapshot && ["planning_visuals", "finalizing_visuals"].includes(snapshot.job.state) ? (
        <section className="panel visual-plan-progress" aria-live="polite" aria-labelledby="visual-plan-progress-title">
          <div className="panel-heading">
            <div>
              <p className="review-section-label">第 4 步 · 镜头规划</p>
              <h2 id="visual-plan-progress-title" className="icon-label"><Icon name="timeline" />正在生成镜头规划</h2>
            </div>
            <span className="status status-planning_visuals">{snapshot.job.state === "finalizing_visuals" ? "生成视频清单" : "规划画面"}</span>
          </div>
          <div className="visual-plan-flow" aria-label="镜头规划数据流">
            {[
              ["source", "来源与确认稿"],
              ["audio", "口播段落与真实音频时间轴"],
              ["model", "视觉规划模型"],
              ["validate", "segment 覆盖与模板校验"],
              ["manifest", "最终 manifest"],
            ].map(([id, label], index) => { const progress = snapshot.job.generationProgress?.text ?? ""; const active = (id === "source" && (progress.includes("读取") || progress.includes("来源"))) || (id === "audio" && progress.includes("口播")) || (id === "model" && (progress.includes("模型") || progress.includes("模板目录"))) || (id === "validate" && progress.includes("校验")) || (id === "manifest" && (progress.includes("manifest") || snapshot.job.state === "finalizing_visuals")); return <div className={`visual-plan-flow-node ${active ? "is-active" : ""}`} key={id}><span>{String(index + 1).padStart(2, "0")}</span><strong>{label}</strong>{index < 4 ? <i aria-hidden="true">→</i> : null}</div>; })}
          </div>
          <div className="visual-plan-progress-message"><span className="progress-pulse" aria-hidden="true" />{snapshot.job.generationProgress?.text || "正在启动视觉规划 worker…"}</div>
        </section>
      ) : null}
      {step === 2 && snapshot?.job.state === "failed" && !draft ? (
        <section className="panel model-stream generation-failed-panel">
          <div className="panel-heading">
            <div>
              <h2>口播稿生成失败</h2>
              <p className="hint">可以基于当前任务的原始素材重新生成。</p>
            </div>
            <span className="status status-failed">失败</span>
          </div>
          {snapshot.job.error ? <p className="generation-error">{isLegacyNarrationDurationError(snapshot.job.error) ? "旧的口播时长校验已取消，可直接重新生成口播稿。" : snapshot.job.error}</p> : null}
          <div className="actions">
            <button type="button" disabled={busy} onClick={() => void retryFailedDraft()}>
              <Icon name="refresh" />重新生成口播稿
            </button>
          </div>
        </section>
      ) : null}
      {/* 新派生任务在第一步核对全文，已确认的对照记录仍可回看。 */}
      {step === 1 && snapshot?.translation ? <TranslationReview
        key={`${snapshot.job.jobId}:${snapshot.translation.updatedAt}`}
        review={snapshot.translation} state={snapshot.job.state} progress={snapshot.job.generationProgress?.text}
        busy={busy} notice={scriptNotice} onAction={handleTranslationAction}
      /> : null}
      {step === 1 && !snapshot?.translation ? (
        <section className="panel input-panel">
          <div className="panel-heading">
            <div>
              <p className="review-section-label">第 1 步 · 素材输入</p>
              <h2>新建视频</h2>
            </div>
            <span className="input-panel-mode-hint">{contentMode === "math" ? "数学动画模式" : "生成后不可更换模型"}</span>
          </div>
          {/* 仅重排创建页的信息层级，字段仍绑定原有状态，确保生成流程不变。 */}
          <div className="input-panel-body">
            <div className="input-panel-source">
              <div className="input-panel-content-heading">
                <div>
                  <strong>{contentMode === "math" ? "创作要求" : sourceType === "text" ? "文章正文" : sourceType === "script" ? "口播稿原文" : "网页链接"}</strong>
                  <span className="input-panel-source-subtitle">{contentMode === "math" ? "用一句话描述你想呈现的数学动画" : sourceType === "text" ? "粘贴文章，系统将自动整理为口播稿" : sourceType === "script" ? "保留原稿正文，只生成发布文案和段落边界" : "输入公开网页链接，系统将读取页面内容"}</span>
                </div>
                <span>{contentMode === "math" ? "可选" : sourceType === "url" ? input.trim() ? "已填写" : "等待输入" : `${Array.from(input).length} 字`}</span>
              </div>
              {contentMode === "math" ? <textarea value={mathInstruction} onChange={(event) => setMathInstruction(event.target.value)} placeholder="例如：换一种近期没用过的复杂曲线，参数变化慢一点。留空即随机生成。" rows={8} /> : sourceType === "url" ? <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="https://example.com/article" /> : <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder={sourceType === "script" ? "可用 # 一级标题指定标题；其余内容将原样作为口播稿" : "粘贴文章正文，建议 8 个字符以上"} rows={8} />}
              <p className="hint">{contentMode === "math" ? "留空会随机生成公式；生成后仍可在审稿阶段微调。" : sourceType === "text" ? "系统会根据正文提炼标题、摘要和分段口播稿。" : sourceType === "script" ? "第一个 # 一级标题将直接用作标题且不配音；其余正文只提取摘要、短标题并在原文字符之间分段。" : "仅支持可公开访问的网页链接。"}</p>
            </div>
            <aside className="input-panel-settings" aria-label="生成设置">
              <p className="input-panel-settings-title">生成设置</p>
              <label>
                内容模式
                <select value={contentMode} onChange={(event) => setContentMode(event.target.value as "narration" | "math")}>
                  <option value="narration">口播 · 科技一分钟</option>
                  <option value="math">公式 · 数学之美</option>
                </select>
              </label>
              {contentMode === "math" ? <>
                <label>
                  公式选择
                  <select value={mathFormulaSelection} onChange={(event) => setMathFormulaSelection(event.target.value as MathFormulaId | "auto")} disabled={busy}>
                    <option value="auto">自动轮换 · 避开近期重复</option>
                    {formulaGroups.map((group) => <optgroup key={group.label} label={group.label}>{group.formulaIds.map((formulaId) => <option key={formulaId} value={formulaId}>{formulaCatalog[formulaId].name}</option>)}</optgroup>)}
                  </select>
                </label>
                <label>
                  成片分辨率
                  <select value={mathResolution} onChange={(event) => setMathResolution(event.target.value as "1080x1260" | "1080x1920")} disabled={busy}>
                    <option value="1080x1260">1080×1260 · 与口播一致</option>
                    <option value="1080x1920">1080×1920 · 竖屏</option>
                  </select>
                </label>
              </> : <>
                <label>
                  母稿专栏
                  <select value={sourceSeriesId} onChange={(event) => setSourceSeriesId(event.target.value)} disabled={busy || !sourceProfiles.length}>
                    {sourceProfiles.map((item) => <option key={item.seriesId} value={item.seriesId}>{item.displayLabel}</option>)}
                  </select>
                </label>
                <label>
                  素材来源
                  <select value={sourceType} onChange={(event) => setSourceType(event.target.value as "text" | "url" | "script")}>
                    <option value="text">粘贴正文</option>
                    <option value="url">网页链接</option>
                    <option value="script">口播稿</option>
                  </select>
                </label>
                <label>
                  语言
                  <select value={sourceLanguage} onChange={(event) => setSourceLanguage(event.target.value)}>
                    <option value="auto">自动识别</option>
                    <option value="zh">中文</option>
                    <option value="en">英文</option>
                    <option value="mixed">中英混合</option>
                  </select>
                </label>
                <label>
                  生成模型
                  <select value={textModel} onChange={(event) => setTextModel(event.target.value as Settings["defaultTextModel"])}>
                    {settings?.textModels.map((model) => <option key={model} value={model}>{model}</option>)}
                  </select>
                </label>
              </>}
            </aside>
          </div>
          <div className="actions input-panel-actions">
            <button
              disabled={busy || (contentMode === "narration" && (!settings || input.trim().length < 8))}
              onClick={createJob}
            >
              <Icon name="sparkles" />
              {busy ? "处理中…" : contentMode === "math" ? "随机生成公式" : "生成草稿"}
            </button>
          </div>
        </section>
      ) : null}

      {step === 2 && draft && snapshot && !mathDraft ? (
        <section className="script-review-workspace" aria-label="口播稿审核">
          <article className="script-review-editor panel">
            <header className="script-review-header">
              <div>
                <p className="review-section-label">第 2 步 · 口播审核</p>
                <h2>口播内容</h2>
                <p className="hint">逐段检查表达、事实和节奏；修改完成后手动保存新版本。</p>
              </div>
              <span className="script-review-version">版本 {snapshot.job.currentRevision}</span>
            </header>
            <div className="script-review-meta">
              <div className="script-review-title-fields">
                <label className="script-review-title-field">标题<input value={draft.title} maxLength={40} disabled={editorLocked || busy || Boolean(pendingDraft)} onChange={(event) => setDraft({...draft, title: event.target.value})} /><span className="field-hint">{Array.from(draft.title).length}/40 字 · 修改后点击“保存口播稿”</span></label>
                <label className="script-review-short-title-field">{isEnglishProfile ? "短标题" : "16 字短标题"}<input value={draft.shortTitle ?? ""} {...(isEnglishProfile ? {} : {maxLength: 16})} disabled={editorLocked || busy || Boolean(pendingDraft)} onChange={(event) => setDraft({...draft, shortTitle: event.target.value})} /><span className="field-hint">{isEnglishProfile ? "英文内容不限制长度" : `${Array.from(draft.shortTitle ?? "").length}/16 字`}</span></label>
              </div>
              <div className="script-review-stats"><span>{draftStats?.characterCount ?? 0} 字</span><span>{draftStats?.sceneCount ?? 0} 段</span></div>
            </div>
            {scriptNotice ? <p className="script-edit-notice" role="status">{scriptNotice}</p> : null}
            <div className="script-segment-list">
              {draft.scenes.map((scene, index) => (
                <div className="script-segment-card" key={scene.id}>
                  <span className="script-segment-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="script-segment-body"><span className="script-segment-label">显示/字幕文本 · {Array.from(scene.spokenText).length} 字</span><textarea rows={4} value={scene.spokenText} disabled={editorLocked || busy || Boolean(pendingDraft)} onChange={(event) => updateScene(index, {spokenText: event.target.value})} /><label className="script-segment-tts-field"><span>发音文本（可选）</span><textarea rows={2} value={draft.narrationSegments?.[index]?.ttsText ?? ""} disabled={editorLocked || busy || Boolean(pendingDraft)} onChange={(event) => updateTtsText(index, event.target.value)} /></label></span>
                  {/* 段落操作改为图标按钮，保留 aria-label 和 title 说明具体动作。 */}
                  <span className="actions script-segment-actions">
                    <button type="button" className="secondary icon-only" aria-label="按光标拆分" title="按光标拆分" data-tooltip="按光标拆分" disabled={editorLocked || busy || Boolean(pendingDraft)} onClick={(event) => { const textarea = event.currentTarget.parentElement?.parentElement?.querySelector("textarea"); if (textarea) splitDraftSegment(index, textarea); }}><Icon name="flow" /></button>
                    <button type="button" className="secondary icon-only" aria-label="与上一段合并" title="与上一段合并" data-tooltip="与上一段合并" disabled={editorLocked || busy || Boolean(pendingDraft) || index === 0} onClick={() => mergeDraftSegment(index)}><Icon name="layers" /></button>
                    <button type="button" className="secondary icon-only" aria-label="删除口播段落" title="删除口播段落" data-tooltip="删除口播段落" disabled={editorLocked || busy || Boolean(pendingDraft) || (draft.narrationSegments?.length ?? 0) <= 1} onClick={() => deleteDraftSegment(index)}><Icon name="trash" /></button>
                  </span>
                </div>
              ))}
            </div>
            <footer className="script-review-footer">
              <div>{saveStatus === "saving" ? <span className="save-status is-saving">保存中…</span> : null}{saveStatus === "saved" && !draftChanged ? <span className="save-status is-saved">已保存</span> : null}{saveStatus === "failed" ? <span className="save-status is-failed">保存失败</span> : null}{draftChanged ? <span className="hint">有未保存修改</span> : null}</div>
              <div className="script-review-footer-actions">
                {snapshot.audioPreview && !isHistoricalRevision ? <AudioReview compact src={snapshot.audioPreview.src} narration={snapshot.audioPreview.narration} segments={draft.narrationSegments ?? draft.scenes.map((scene, index) => ({id: `narration-${String(index + 1).padStart(2, "0")}`, spokenText: scene.spokenText}))} busy={busy} onApprove={audioStatus === "review" ? () => setStep(3) : undefined} /> : null}
                <div className="actions">
                <button className="secondary" disabled={busy || editorLocked || Boolean(pendingDraft) || !draftChanged} onClick={() => void saveDraft()}><Icon name="save" />保存口播稿</button>
                {/* 第二步只负责确认口播并进入第三步，视觉资源准备在音频确认后进入第四步。 */}
                <button disabled={busy || loadedSettingsKey !== settingsKey || editorLocked || Boolean(pendingDraft) || audioDraftChanged || (audioStatus !== "ready" && audioStatus !== "review" && !voiceId)} onClick={() => audioStatus === "ready" || audioStatus === "review" ? setStep(3) : void trigger("approve")}><Icon name="volume" />{audioStatus === "synthesizing" ? "生成中…" : audioStatus === "ready" || audioStatus === "review" ? "进入音频试听" : audioStatus === "failed" ? "配音失败，点击重试" : "确认并生成配音"}</button>
                </div>
              </div>
            </footer>
          </article>
          <aside className="script-ai-panel panel">
            <header className="script-review-header"><div><p className="review-section-label">辅助创作</p><h2>AI 重新生成</h2><p className="hint">描述你希望如何调整，AI 会先生成候选稿供你确认。</p></div><Icon name="sparkles" /></header>
            <div className="script-ai-presets" aria-label="常用修改要求">
              <button className="secondary" disabled={busy || editorLocked || Boolean(pendingDraft)} onClick={() => setFeedback("请将口播精简到 60–90 秒，保留一条核心主线，合并重复定义、空泛过渡和多次总结。")}>精简到 60–90 秒</button>
              <button className="secondary" disabled={busy || editorLocked || Boolean(pendingDraft)} onClick={() => setFeedback("请把口播改得更口语化、更自然，减少书面表达，但保留事实和核心观点。")}>语气更口语化</button>
              <button className="secondary" disabled={busy || editorLocked || Boolean(pendingDraft)} onClick={() => setFeedback("请重新组织口播结构，让开头更快进入主题，段落之间衔接更清楚，结尾保留明确结论。")}>重组结构</button>
            </div>
            <textarea className="script-ai-input" rows={9} value={feedback} disabled={busy || editorLocked || Boolean(pendingDraft)} onChange={(event) => setFeedback(event.target.value)} placeholder="例如：删掉背景铺垫，先说结论，再用两个例子解释。" />
            <button className="script-ai-submit" disabled={busy || editorLocked || Boolean(pendingDraft) || feedback.trim().length < 4} onClick={() => void submitFeedback()}><Icon name="sparkles" />{snapshot.job.state === "drafting" ? "生成中…" : "生成新口播稿"}</button>
            {snapshot.job.state === "drafting" ? <p className="script-ai-status" role="status">AI 正在整理新的口播内容，请稍候…</p> : null}
            {pendingDraft ? <section className="script-candidate" aria-label="AI 候选稿"><div className="script-candidate-heading"><div><p className="review-section-label">候选稿已生成</p><h3>编辑后确认采用</h3><p className="hint">当前稿暂时保持不变；你可以先修改候选稿，再一次性确认。</p></div><span>{pendingDraft.scenes.length} 段</span></div><label className="script-candidate-title">候选标题<input value={pendingDraft.title} maxLength={40} disabled={busy} onChange={(event) => setPendingDraft({...pendingDraft, title: event.target.value})} /><span className="field-hint">{Array.from(pendingDraft.title).length}/40 字</span></label><label className="script-candidate-title">候选短标题<input value={pendingDraft.shortTitle ?? ""} maxLength={16} disabled={busy} onChange={(event) => setPendingDraft({...pendingDraft, shortTitle: event.target.value})} /><span className="field-hint">{Array.from(pendingDraft.shortTitle ?? "").length}/16 字</span></label><div className="script-candidate-copy">{pendingDraft.scenes.map((scene, index) => <label className="script-candidate-scene" key={scene.id}><strong>{String(index + 1).padStart(2, "0")}</strong><textarea rows={4} value={scene.spokenText} disabled={busy} onChange={(event) => updatePendingScene(index, event.target.value)} /><span>发音文本（可选）</span><textarea rows={2} value={pendingDraft.narrationSegments?.[index]?.ttsText ?? ""} disabled={busy} onChange={(event) => updatePendingTtsText(index, event.target.value)} /></label>)}</div><div className="actions"><button className="secondary" disabled={busy} onClick={() => void discardPendingDraft()}>保留当前稿</button><button disabled={busy || !pendingDraft.title.trim()} onClick={() => void acceptPendingDraft()}>确认采用并继续</button></div></section> : null}
          </aside>
        </section>
      ) : null}

      {step === 3 && draft && snapshot && !mathDraft && !isHistoricalRevision ? (
        snapshot.job.state === "synthesizing" || !snapshot.audioPreview ? (
          <section className="panel audio-review audio-review-progress" aria-live="polite">
            <div className="panel-heading"><div><p className="review-section-label">第 3 步 · 音频试听</p><h2 className="icon-label"><Icon name="volume" />正在合成口播音频</h2></div><span className="status status-synthesizing">合成中</span></div>
            <p>{snapshot.job.generationProgress?.text || "音频生成完成后会自动进入试听。"}</p>
          </section>
        ) : (
          <AudioReview
            src={snapshot.audioPreview.src}
            narration={snapshot.audioPreview.narration}
            segments={draft.narrationSegments ?? draft.scenes.map((scene, index) => ({id: `narration-${String(index + 1).padStart(2, "0")}`, spokenText: scene.spokenText}))}
            busy={busy}
            onApprove={snapshot.job.state === "awaiting_audio_review" ? () => void trigger("approve") : undefined}
            onReject={snapshot.job.state === "awaiting_audio_review" ? () => void rejectAudio() : undefined}
            approveLabel={snapshot.job.error ? "重新开始规划" : undefined}
          />
        )
      ) : null}

      {step === 3 && isHistoricalRevision ? (
        <section className="panel">
          <div className="panel-heading"><div><p className="review-section-label">第 3 步 · 音频试听</p><h2>历史版本不单独回放音频</h2></div><span className="status">只读</span></div>
          <p className="hint">历史 revision 不会读取当前版本的音频或规划数据，请前往第 5 步查看该版本的最终视频预览。</p>
          <div className="actions"><button type="button" onClick={() => setStep(5)}><Icon name="play" />前往视频预览</button></div>
        </section>
      ) : null}

      {/* 资源准备贯穿第四步；镜头规划完成后进入 ready/rendering 时仍需保留在规划区上方。 */}
      {step === 4 && snapshot?.job.state === "awaiting_visual_resources" && !isHistoricalRevision ? (
        <section className="panel visual-planning-gate" aria-label="启动镜头规划">
          <div className="panel-heading"><div><p className="review-section-label">第 4 步 · 镜头规划</p><h2>准备开始镜头规划</h2></div><span className="status">待规划</span></div>
          <p className="hint">点击“规划”后进入镜头规划页；图片、视觉要求和多边形标注均在对应镜头中准备。</p>
          <div className="actions"><button type="button" disabled={busy} onClick={() => void startVisualPlanning()}><Icon name="timeline" />规划</button></div>
        </section>
      ) : null}
      {step === 4 && snapshot && !isHistoricalRevision && !["planning_visuals", "finalizing_visuals", "awaiting_visual_resources"].includes(snapshot.job.state) && snapshot.visualPlan && snapshot.audioPreview && draft && profile && jobId ? (
        <VisualPlanWorkspace
          jobId={jobId}
          title={draft.title}
          plan={snapshot.visualPlan}
          audioSrc={snapshot.audioPreview.src}
          segments={snapshot.audioPreview.narration.segments ?? []}
          captions={snapshot.audioPreview.narration.captions ?? []}
          visualResources={snapshot.visualResources ?? {resources: []}}
          previewArtifactToken={snapshot.previewArtifactToken}
          spokenSegments={draft.narrationSegments ?? draft.scenes.map((scene) => ({id: scene.id, spokenText: scene.spokenText}))}
          profile={profile}
          brand={{logoSrc: profile.logoSrc, title: profile.title, subtitle: profile.subtitle, label: profile.displayLabel, downloadPrefix: profile.downloadPrefix}}
          busy={busy}
          canFinalize={snapshot.job.state === "awaiting_visual_review"}
          coverImageBusy={coverImageBusy}
          onUploadCoverImage={uploadCoverImage}
          onDeleteCoverImage={deleteCoverImage}
          onGenerateCoverImageRequirement={generateCoverImageRequirement}
          onGenerateVisualRequirement={generateVisualRequirementInline}
          onUploadImage={uploadSceneImage}
          onDeleteImage={deleteSceneImage}
          onSavePolygons={saveScenePolygons}
          onSave={saveVisualPlan}
          onReplan={replanVisuals}
          onFinalize={finalizeVisualPlan}
        />
      ) : null}

      {step === 4 && isHistoricalRevision ? (
        <section className="panel">
          <div className="panel-heading"><div><p className="review-section-label">第 4 步 · 镜头规划</p><h2>历史版本不可编辑镜头</h2></div><span className="status">只读</span></div>
          <p className="hint">为避免与当前 revision 串版，历史版本只使用已定稿 manifest 预览，不加载当前镜头规划。</p>
          <div className="actions"><button type="button" onClick={() => setStep(5)}><Icon name="play" />前往视频预览</button></div>
        </section>
      ) : null}

      {scriptDialogScene && draft && snapshot ? (
        <div
          className="scene-script-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) void closeScriptDialog(false);
          }}
        >
          <section
            className="scene-script-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="scene-script-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="scene-script-dialog-header">
              <div>
                <p className="review-section-label">场景 {String(scriptDialogSceneIndex + 1).padStart(2, "0")}</p>
                <h2 id="scene-script-dialog-title">编辑本场口播</h2>
                <p className="hint">修改会实时更新预览，保存并关闭后创建新的稿件版本。</p>
              </div>
              <button
                className="scene-script-dialog-close"
                type="button"
                aria-label="关闭场景编辑"
                disabled={busy}
                onClick={() => void closeScriptDialog(false)}
              >
                ×
              </button>
            </header>
            <div className="scene-script-dialog-body">
              <div className="scene-script-dialog-meta">
                <span>{scriptDialogScene.id}</span>
                <span>{editorLocked ? "只读版本" : "预览同步编辑"}</span>
              </div>
              <label>
                主标题
                <input
                  ref={scriptDialogInputRef}
                  value={scriptDialogScene.content.title}
                  disabled={editorLocked || draft.visualsPlanned !== true}
                  onChange={(event) => updateScene(scriptDialogSceneIndex, {content: {...scriptDialogScene.content, title: event.target.value}})}
                />
              </label>
              <label>
                口播
                <textarea
                  rows={6}
                  value={scriptDialogScene.spokenText}
                  disabled={editorLocked}
                  onChange={(event) => updateScene(scriptDialogSceneIndex, {spokenText: event.target.value})}
                />
              </label>
              <p className="hint">画面结构和数字人配置由镜头规划区域统一设置。</p>
              <div className="template-field">
                <label>可用模板</label>
                <CompatibleTemplatePicker scene={scriptDialogScene} profile={snapshot.job.contentProfile} isFirstScene={scriptDialogSceneIndex === 0} isLastScene={scriptDialogSceneIndex === (draft.scenes.length - 1)} disabled={editorLocked || draft.visualsPlanned !== true} onSelect={(id) => selectTemplate(scriptDialogSceneIndex, id)} />
                <span className="hint scene-script-dialog-template-hint">
                  {scriptDialogTemplate?.adapted
                    ? "人工选择 · 预览会同步更新"
                    : "当前模板不可用"}
                </span>
              </div>
            </div>
            <footer className="scene-script-dialog-footer">
              <div>
                {saveStatus === "saving" ? <span className="save-status is-saving">保存中…</span> : null}
                {saveStatus === "saved" ? <span className="save-status is-saved">已保存</span> : null}
                {saveStatus === "failed" ? <span className="save-status is-failed">保存失败</span> : null}
              </div>
              <div className="actions">
                <button className="secondary" type="button" disabled={busy} onClick={() => void closeScriptDialog(false)}>取消</button>
                <button type="button" disabled={busy || editorLocked} onClick={() => void closeScriptDialog(true)}>
                  {busy ? "保存中…" : "保存并关闭"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}

      {!mathWorkflow && step === 5 && previewManifest && snapshot ? (
        <section className="panel preview">
          <div className="panel-heading">
            <h2 className="icon-label"><Icon name="play" />视频预览</h2>
            <span>
              {(
                (previewManifest.narration.spokenDurationMs ??
                  previewManifest.narration.durationMs) / 1000
              ).toFixed(1)}{" "}
              秒纯口播 +{" "}
              {(
                (previewManifest.narration.durationMs -
                  (previewManifest.narration.spokenDurationMs ??
                    previewManifest.narration.durationMs)) /
                1000
              ).toFixed(1)}{" "}
              秒停顿 + 3 秒片尾
            </span>
          </div>
          <ReviewPreview
            manifest={previewManifest}
            draftScenes={draft?.scenes ?? []}
            title={previewManifest.title}
            audioStatus={audioStatus}
            isRendering={snapshot.job.state === "rendering"}
            activeSceneId={previewSceneId}
            isHistorical={isHistoricalRevision}
            busy={busy}
            onSceneSelect={setPreviewSceneId}
            onOpenScript={(sceneId) => openScriptForScene(sceneId)}
            onProduceAudio={() => void trigger("approve")}
            onRender={() => undefined}
            feedbackOpen={false}
            onToggleFeedback={() => undefined}
            sceneSeekRequest={previewSeekRequest}
            showActions={false}
            compact
          />
          <div className="actions">
            <button className="secondary" onClick={() => setStep(4)}>
              <Icon name="arrow-right" className="icon-flip" />返回镜头规划
            </button>
            <button
              disabled={
                busy ||
                isHistoricalRevision ||
                false ||
                !RENDERABLE_STATES.has(snapshot.job.state)
              }
              onClick={() => trigger("render")}
            >
              <Icon name="play" />
              {snapshot.job.state === "rendering"
                ? `渲染中 ${snapshot.job.renderProgress ?? 0}%`
                : "生成成片"}
            </button>
          </div>
        </section>
      ) : null}

      {(mathWorkflow ? step === 3 : step === 6) && previewManifest && revisionView && snapshot ? (
        <section className="panel delivery">
          <div className="panel-heading">
            <h2 className="icon-label"><Icon name="download" />成片交付</h2>
            <span>
              {revisionView.outputReady
                ? "成片已就绪"
                : snapshot.job.state === "rendering"
                  ? `渲染中 ${snapshot.job.renderProgress ?? 0}%`
                  : snapshot.job.state === "synthesizing"
                    ? "合成音频中…"
                    : "等待开始渲染"}
            </span>
          </div>
          <p>成片规格：{previewManifest.contentMode === "math"
            ? `${previewManifest.video.width}×${previewManifest.video.height}（${previewManifest.video.height === 1260 ? "与口播一致" : "9:16"}）`
            : "1080×1260"} · 30 FPS · 片尾 3 秒</p>
          <section
            className="summary-card delivery-title-card"
            aria-labelledby="video-delivery-title"
          >
            <div className="summary-heading">
              <div>
                <h3 id="video-delivery-title">视频标题</h3>
                <span>版本 {previewManifest.revision}</span>
              </div>
              <button className="secondary" type="button" onClick={() => void copyTitle()}>
                <Icon name="copy" />复制标题
              </button>
            </div>
            <input
              readOnly
              value={previewManifest.title}
              aria-label="视频标题"
            />
            {titleCopyStatus === "copied" ? (
              <span className="copy-status success" role="status" aria-live="polite">
                标题已复制
              </span>
            ) : titleCopyStatus === "failed" ? (
              <span className="copy-status failed" role="status" aria-live="polite">
                复制失败，请手动选择标题文本
              </span>
            ) : null}
          </section>
          {previewManifest.contentMode === "narration" && previewManifest.shortTitle ? (
            <section className="summary-card delivery-title-card" aria-labelledby="video-delivery-short-title">
              <div className="summary-heading">
                <div><h3 id="video-delivery-short-title">16 字短标题</h3><span>用于平台标题栏和封面文案 · 版本 {previewManifest.revision}</span></div>
                <button className="secondary" type="button" onClick={() => void copyShortTitle()}><Icon name="copy" />复制短标题</button>
              </div>
              <input readOnly value={previewManifest.shortTitle} aria-label="16 字短标题" />
              {shortTitleCopyStatus === "copied" ? <span className="copy-status success" role="status" aria-live="polite">短标题已复制</span> : shortTitleCopyStatus === "failed" ? <span className="copy-status failed" role="status" aria-live="polite">复制失败，请手动选择短标题文本</span> : null}
            </section>
          ) : null}
          <section className="summary-card" aria-labelledby="video-summary-title">
            <div className="summary-heading">
              <div>
                <h3 id="video-summary-title">
                  {previewManifest.contentMode === "math" ? "公式介绍" : "视频摘要"}
                </h3>
                <span>
                  {deliverySummary ? `${Array.from(deliverySummary).length} 字` : "未生成"} · 版本 {previewManifest.revision}
                </span>
              </div>
              <button
                className="secondary"
                type="button"
                disabled={!deliverySummary}
                onClick={() => void copySummary()}
              >
                <Icon name="copy" />{previewManifest.contentMode === "math" ? "复制介绍" : "复制摘要"}
              </button>
            </div>
            <textarea
              readOnly
              rows={5}
              value={deliverySummary}
              placeholder="当前版本暂无摘要"
              aria-label={previewManifest.contentMode === "math" ? "公式介绍" : "视频摘要"}
            />
            {deliverySummary && summaryCopyStatus === "copied" ? (
              <span className="copy-status success" role="status" aria-live="polite">
                {previewManifest.contentMode === "math" ? "介绍已复制" : "摘要已复制"}
              </span>
            ) : deliverySummary && summaryCopyStatus === "failed" ? (
              <span className="copy-status failed" role="status" aria-live="polite">
                复制失败，请手动选择文本
              </span>
            ) : null}
          </section>
          <div className="actions">
            <button className="secondary" onClick={() => setStep(mathWorkflow ? 2 : 5)}>
              <Icon name="arrow-right" className="icon-flip" />{mathWorkflow ? "返回审稿" : "返回预览"}
            </button>
            {!revisionView.outputReady && mathWorkflow ? (
              <button
                disabled={
                  busy ||
                  false ||
                  !RENDERABLE_STATES.has(snapshot.job.state)
                }
                onClick={() => trigger("render")}
              >
                <Icon name="play" />
                {snapshot.job.state === "rendering"
                  ? `渲染中 ${snapshot.job.renderProgress ?? 0}%`
                  : "生成成片"}
              </button>
            ) : revisionView.outputReady ? (
              <a
                className="button-link"
                href={`/api/jobs/${encodeURIComponent(snapshot.job.jobId)}/artifacts/output.mp4`}
                download={videoDownloadFilename(previewManifest.title, profile?.downloadPrefix ?? "tech123-video")}
              >
                <Icon name="download" />下载成片
              </a>
            ) : <span className="metadata">{snapshot.job.state === "rendering" ? "请稍候，渲染完成后即可下载" : "当前暂无可下载成片"}</span>}
          </div>
          {!mathWorkflow && snapshot.job.state === "completed" && snapshot.job.contentProfile.seriesId === "tech-minute" ? <div className="actions"><button disabled={busy} onClick={() => void deriveEnglishVideo()}><Icon name="arrow-right" />派生英文视频</button></div> : null}
        </section>
      ) : null}
      {visualRequirementDialog ? (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="visual-requirement-title" onClick={() => (visualRequirementDialog.loading || busy ? undefined : setVisualRequirementDialog(null))}>
          <div className="confirm-dialog panel visual-requirement-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="visual-requirement-dialog-header"><h2 id="visual-requirement-title">封面图片要求</h2>{visualRequirementDialog.result ? <button className="secondary icon-only" type="button" aria-label="复制视觉要求" title="复制视觉要求" onClick={() => void copyVisualRequirement()}><Icon name="copy" /></button> : null}</div>
            {visualRequirementCopyStatus === "copied" ? <p className="copy-status success" role="status">视觉要求已复制</p> : visualRequirementCopyStatus === "failed" ? <p className="copy-status failed" role="status">复制失败，请手动选择文本</p> : null}
            <p className="hint">当前口播：{visualRequirementDialog.text}</p>
            {visualRequirementDialog.loading ? <p>正在读取内容并生成配图要求…</p> : visualRequirementDialog.error ? <p className="error-text">{visualRequirementDialog.error}</p> : visualRequirementDialog.result ? <p className="visual-requirement-result">{visualRequirementDialog.result}</p> : null}
            <div className="actions"><button className="secondary" type="button" disabled={visualRequirementDialog.loading || busy} onClick={() => setVisualRequirementDialog(null)}>关闭</button></div>
          </div>
        </div>
      ) : null}
      {/* 首页任务列表放在全部工作区内容之后，降低对新建任务主流程的干扰。 */}
      {step === 1 && !jobId && recentJobs.length ? (
        <section className="panel recent-jobs">
          <div className="panel-heading">
            <div><h2>最近任务</h2></div>
            <button className="secondary" disabled={busy} onClick={() => void refreshRecentJobs()}>刷新</button>
          </div>
          <div className="recent-job-list">
            {recentJobs.map((job) => (
              <div className="recent-job" key={job.jobId}>
                <button className="recent-job-open" type="button" disabled={busy} aria-label={`进入审稿：${job.title}`} onClick={() => void enterReview(job.jobId)}>
                  <div><strong>{job.title}</strong><span>版本 {job.currentRevision} · {jobStateLabels[job.state] ?? job.state} · {new Date(job.updatedAt).toLocaleString("zh-CN", {month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"})}</span></div>
                  <span className="recent-job-action icon-label">打开任务 <Icon name="arrow-right" /></span>
                </button>
                <button className="recent-job-delete" type="button" disabled={busy} aria-label={`删除任务：${job.title}`} onClick={() => requestDelete(job.jobId, job.title)}>删除</button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {pendingDelete ? (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-title"
          onClick={() => (busy ? undefined : setPendingDelete(null))}
        >
          <div className="confirm-dialog panel" onClick={(event) => event.stopPropagation()}>
            <h2 id="confirm-delete-title">删除任务</h2>
            <p>
              确定删除任务「{pendingDelete.title}」？该操作不可撤销，任务的所有版本、草稿、音视频与日志都会被移除。
            </p>
            <div className="actions">
              <button
                className="secondary"
                type="button"
                disabled={busy}
                onClick={() => setPendingDelete(null)}
              >
                取消
              </button>
              <button
                className="confirm-delete"
                type="button"
                disabled={busy}
                onClick={() => void confirmDelete()}
              >
                {busy ? "删除中…" : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
};
