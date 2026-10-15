import {promises as fs} from "node:fs";
import path from "node:path";
import {z} from "zod";
import {REPO_ROOT} from "./paths";
import {PRESENTER_GESTURE_DIRECTIONS, PRESENTER_SAFE_SIDES, type PresenterGestureDirection, type PresenterPoseId, type PresenterSafeSide} from "../remotion/presenter-config";

const idSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/, "ID 只能包含小写字母、数字和连字符");
// 正式与兼容姿态共用元数据契约；兼容姿态不进入新任务的选择列表。
const poseConfigSchema = z.object({
  id: idSchema,
  label: z.string().trim().min(1),
  file: z.string().min(1).refine((value) => path.basename(value) === value, "IP 素材必须是目录内的文件名"),
  semanticTags: z.array(z.string().trim().min(1)).min(1),
  gestureDirection: z.enum(PRESENTER_GESTURE_DIRECTIONS),
  safeSide: z.enum(PRESENTER_SAFE_SIDES),
}).strict();
const accountSchema = z.object({
  schemaVersion: z.string().min(1),
  configVersion: z.string().min(1),
  id: idSchema,
  title: z.string().min(1),
  subtitle: z.string().min(1),
  workspaceName: z.string().min(1),
  workspaceTitle: z.string().min(1),
  workspaceDescription: z.string().min(1),
  downloadPrefix: z.string().min(1),
  userAgentSuffix: z.string().min(1),
  logo: z.string().min(1).refine((value) => path.basename(value) === value, "logo 必须是品牌目录内的文件名"),
  ip: z.object({
    directory: z.string().min(1).refine((value) => path.basename(value) === value, "IP 目录必须位于账号根目录"),
    // 退役姿态不进入新任务选择，但旧 Manifest 的素材 URL 仍要能由同步脚本恢复。
    compatibilityArchive: z.string().regex(/^backup\/[a-z0-9-]+$/, "兼容素材目录必须位于 IP backup 下").optional(),
    poses: z.array(poseConfigSchema).min(1),
    compatibilityPoses: z.array(poseConfigSchema).optional(),
  }).strict(),
});
// 英文派生专题可配置固定片尾文案；未配置时渲染端沿用中文默认片尾。
const brandOutroSchema = z.object({
  title: z.string().trim().min(1),
  subtitle: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
}).strict();
// 专题可覆盖声音表现；语速保持与工作台滑块一致，停顿遵循时间轴上限。
export const profileTtsSchema = z.object({
  // 专题只保存模型 ID；可用模型和音色兼容关系统一由 pipeline.config.json 管理。
  model: z.string().trim().min(1).optional(),
  languageHints: z.array(z.enum(["zh", "en", "fr", "de", "ja", "ko", "ru", "pt", "th", "id", "vi", "es", "it", "ms", "fil", "ar"])).length(1).optional(),
  rate: z.number().min(0.5).max(1.5).optional(),
  pitch: z.number().min(0.5).max(2).optional(),
  volume: z.number().min(0).max(100).optional(),
  instruction: z.string().optional(),
  seed: z.number().int().min(0).max(65535).optional(),
  pauseMs: z.object({
    short: z.number().int().min(0).max(700).optional(),
    medium: z.number().int().min(0).max(700).optional(),
    long: z.number().int().min(0).max(700).optional(),
  }).strict().optional(),
}).strict();

const seriesSchema = z.object({
  schemaVersion: z.string().min(1),
  configVersion: z.string().min(1),
  id: idSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  displayLabel: z.string().min(1),
  defaultTextModel: z.enum(["deepseek-v4-flash", "deepseek-v4-pro"]).optional(),
  defaultVoiceId: z.string().min(1).optional(),
  tts: profileTtsSchema.optional(),
  downloadPrefix: z.string().min(1).optional(),
  // source 专栏可直接输入素材；derived 专栏只能从已完成任务派生。
  kind: z.enum(["source", "derived"]).default("source"),
  sourceSeriesId: idSchema.optional(),
  sourceLanguage: z.enum(["zh", "en", "mixed"]).default("zh"),
  outputLanguage: z.enum(["zh-CN", "en-US"]).default("zh-CN"),
  brandOutro: brandOutroSchema.optional(),
  narration: z.object({
    minSeconds: z.number().positive().default(60),
    targetSeconds: z.number().positive().default(75),
    maxSeconds: z.number().positive().default(90),
    hardMaxSeconds: z.number().positive().default(100),
    minScenes: z.number().int().positive().default(7),
    maxScenes: z.number().int().positive().default(12),
    hardMaxScenes: z.number().int().positive().default(14),
    cjkCharactersPerSecond: z.number().positive().default(5.3),
  }).default({minSeconds: 60, targetSeconds: 75, maxSeconds: 90, hardMaxSeconds: 100, minScenes: 7, maxScenes: 12, hardMaxScenes: 14, cjkCharactersPerSecond: 5.3}),
});

export type ContentProfileContext = {
  accountId: string;
  seriesId: string;
  accountVersion: string;
  seriesVersion: string;
  outputLanguage?: "zh-CN" | "en-US";
};

export type PlatformProfile = {
  id: string;
  accountId: string;
  seriesId: string;
  accountVersion: string;
  seriesVersion: string;
  title: string;
  subtitle: string;
  displayLabel: string;
  seriesTitle: string;
  seriesDescription: string;
  defaultTextModel?: "deepseek-v4-flash" | "deepseek-v4-pro";
  defaultVoiceId?: string;
  tts?: z.infer<typeof profileTtsSchema>;
  kind?: "source" | "derived";
  sourceSeriesId?: string;
  sourceLanguage?: "zh" | "en" | "mixed";
  outputLanguage?: "zh-CN" | "en-US";
  brandOutro?: z.infer<typeof brandOutroSchema>;
  narration: z.infer<typeof seriesSchema>["narration"];
  workspaceName: string;
  workspaceTitle: string;
  workspaceDescription: string;
  downloadPrefix: string;
  userAgentSuffix: string;
  logo: string;
  logoSrc: string;
  presenter: {
    poses: Array<{id: PresenterPoseId; label: string; src: string; semanticTags: string[]; gestureDirection: PresenterGestureDirection; safeSide: PresenterSafeSide}>;
    compatibilityPoses?: Array<{id: PresenterPoseId; label: string; src: string; semanticTags: string[]; gestureDirection: PresenterGestureDirection; safeSide: PresenterSafeSide}>;
  };
  promptRoot: string;
};

export type PublicPlatformProfile = Omit<PlatformProfile, "promptRoot" | "userAgentSuffix">;

const requiredEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`环境变量 ${name} 未设置`);
  return value;
};

const override = (name: string, fallback: string) => process.env[name]?.trim() || fallback;

const logoFilename = (fallback: string) => {
  const logo = override("TALK_VIDEO_LOGO", fallback);
  if (path.basename(logo) !== logo) throw new Error("TALK_VIDEO_LOGO 必须是品牌目录内的文件名");
  return logo;
};

export const profilesRoot = () => path.resolve(
  REPO_ROOT,
  process.env.TALK_VIDEO_PROFILES_DIR?.trim() || "content",
);

export const defaultAccountId = () => requiredEnv("TALK_VIDEO_ACCOUNT");
export const configuredSeriesId = () => requiredEnv("TALK_VIDEO_SERIES");

export const readPlatformProfile = async (
  requestedAccountId?: string,
  requestedSeriesId?: string,
): Promise<PlatformProfile> => {
  // 账号和专题共同决定提示词目录、默认模型及文稿时长等生成约束。
  const accountId = idSchema.parse(requestedAccountId || defaultAccountId());
  const accountRoot = path.join(profilesRoot(), accountId);
  const account = accountSchema.parse(JSON.parse(await fs.readFile(path.join(accountRoot, "account.json"), "utf8")));
  if (account.id !== accountId) throw new Error("账号目录名与 account.json 的 id 不一致");
  const seriesId = idSchema.parse(requestedSeriesId || configuredSeriesId());
  const seriesRoot = path.join(accountRoot, "series", seriesId);
  const series = seriesSchema.parse(JSON.parse(await fs.readFile(path.join(seriesRoot, "series.json"), "utf8")));
  if (series.id !== seriesId) throw new Error("专题目录名与 series.json 的 id 不一致");
  const logo = logoFilename(account.logo);
  const promptRoot = seriesRoot;
  await Promise.all([
    fs.access(path.join(accountRoot, "brand", logo)),
    fs.access(promptRoot),
    ...account.ip.poses.map((pose) => fs.access(path.join(accountRoot, account.ip.directory, pose.file))),
    ...(account.ip.compatibilityArchive ? (account.ip.compatibilityPoses ?? []).map((pose) => fs.access(path.join(accountRoot, account.ip.directory, account.ip.compatibilityArchive!, pose.file))) : []),
  ]);
  if ((account.ip.compatibilityPoses?.length ?? 0) && !account.ip.compatibilityArchive) throw new Error("兼容 IP 姿态必须指定归档目录");
  const allPoseIds = [...account.ip.poses, ...(account.ip.compatibilityPoses ?? [])].map((pose) => pose.id);
  const poseIds = new Set(allPoseIds);
  if (poseIds.size !== allPoseIds.length) throw new Error("账号 IP 姿态 id 必须唯一");
  // neutral 是无效选择和安全区冲突时的账号级兜底，不允许省略。
  if (!account.ip.poses.some((pose) => pose.id === "neutral")) throw new Error("账号正式 IP 姿态必须包含 neutral");
  return {
    id: account.id,
    accountId,
    seriesId,
    accountVersion: account.configVersion,
    seriesVersion: series.configVersion,
    title: override("TALK_VIDEO_BRAND_TITLE", account.title),
    subtitle: override("TALK_VIDEO_BRAND_SUBTITLE", account.subtitle),
    displayLabel: override("TALK_VIDEO_DISPLAY_LABEL", series.displayLabel),
    seriesTitle: override("TALK_VIDEO_SERIES_TITLE", series.title),
    seriesDescription: override("TALK_VIDEO_SERIES_DESCRIPTION", series.description),
    defaultTextModel: series.defaultTextModel,
    defaultVoiceId: series.defaultVoiceId,
    tts: series.tts,
    kind: series.kind,
    ...(series.sourceSeriesId ? {sourceSeriesId: series.sourceSeriesId} : {}),
    sourceLanguage: series.sourceLanguage,
    outputLanguage: series.outputLanguage,
    ...(series.brandOutro ? {brandOutro: series.brandOutro} : {}),
    narration: series.narration,
    workspaceName: override("TALK_VIDEO_WORKSPACE_NAME", account.workspaceName),
    workspaceTitle: override("TALK_VIDEO_WORKSPACE_TITLE", account.workspaceTitle),
    workspaceDescription: override("TALK_VIDEO_WORKSPACE_DESCRIPTION", account.workspaceDescription),
    downloadPrefix: override("TALK_VIDEO_DOWNLOAD_PREFIX", series.downloadPrefix ?? account.downloadPrefix),
    userAgentSuffix: override("TALK_VIDEO_USER_AGENT_SUFFIX", account.userAgentSuffix),
    logo,
    logoSrc: `profile-assets/${accountId}/${logo}`,
    presenter: {
      poses: account.ip.poses.map((pose) => ({
        id: pose.id,
        label: pose.label,
        src: `profile-assets/${accountId}/ip/${pose.file}`,
        semanticTags: pose.semanticTags,
        gestureDirection: pose.gestureDirection,
        safeSide: pose.safeSide,
      })),
      // 旧规划按原 URL 识别退役姿态；新规划和下拉框仍只看 poses。
      compatibilityPoses: (account.ip.compatibilityPoses ?? []).map((pose) => ({
        id: pose.id,
        label: pose.label,
        src: `profile-assets/${accountId}/ip/${pose.file}`,
        semanticTags: pose.semanticTags,
        gestureDirection: pose.gestureDirection,
        safeSide: pose.safeSide,
      })),
    },
    promptRoot,
  };
};

export const profileContext = (profile: PlatformProfile): ContentProfileContext => ({
  accountId: profile.accountId,
  seriesId: profile.seriesId,
  accountVersion: profile.accountVersion,
  seriesVersion: profile.seriesVersion,
  outputLanguage: profile.outputLanguage,
});

export const publicPlatformProfile = (profile: PlatformProfile): PublicPlatformProfile => {
  return {
    id: profile.id,
    accountId: profile.accountId,
    seriesId: profile.seriesId,
    accountVersion: profile.accountVersion,
    seriesVersion: profile.seriesVersion,
    title: profile.title,
    subtitle: profile.subtitle,
    displayLabel: profile.displayLabel,
    seriesTitle: profile.seriesTitle,
    seriesDescription: profile.seriesDescription,
    narration: profile.narration,
    defaultTextModel: profile.defaultTextModel,
    defaultVoiceId: profile.defaultVoiceId,
    tts: profile.tts,
    kind: profile.kind,
    ...(profile.sourceSeriesId ? {sourceSeriesId: profile.sourceSeriesId} : {}),
    sourceLanguage: profile.sourceLanguage,
    outputLanguage: profile.outputLanguage,
    workspaceName: profile.workspaceName,
    workspaceTitle: profile.workspaceTitle,
    workspaceDescription: profile.workspaceDescription,
    downloadPrefix: profile.downloadPrefix,
    logo: profile.logo,
    logoSrc: profile.logoSrc,
    presenter: profile.presenter,
  };
};

export const listSourceProfiles = async (requestedAccountId?: string) => {
  const accountId = idSchema.parse(requestedAccountId || defaultAccountId());
  const directory = path.join(profilesRoot(), accountId, "series");
  const entries = await fs.readdir(directory, {withFileTypes: true});
  const profiles = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => readPlatformProfile(accountId, entry.name)));
  return profiles.filter((profile) => profile.kind === "source").map(publicPlatformProfile);
};

export const readJobPlatformProfile = async (content?: Partial<ContentProfileContext>) => {
  if (!content || !content.accountId || !content.seriesId || !content.accountVersion || !content.seriesVersion) {
    throw new Error("任务的账号/专题上下文无效");
  }
  return readPlatformProfile(content.accountId, content.seriesId);
};

export const promptRoots = (profile: PlatformProfile) => {
  const override = process.env.TALK_VIDEO_PROMPT_DIR?.trim();
  const sourcePromptRoot = profile.sourceSeriesId
    ? path.join(profilesRoot(), profile.accountId, "series", profile.sourceSeriesId)
    : undefined;
  // 当前专题的提示词优先；派生专题缺失的固定模板再回退到母专题。
  return Array.from(new Set([override ? path.resolve(REPO_ROOT, override) : profile.promptRoot, profile.promptRoot, ...(sourcePromptRoot ? [sourcePromptRoot] : [])]));
};
