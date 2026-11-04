import {promises as fs} from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import sharp from "sharp";
import {z} from "zod";
import {accountSchema, seriesSchema, profileTtsSchema, profilesRoot, readPlatformProfile, type PlatformProfile} from "./profile";
import {readPromptEntry} from "./narration-prompts";
import {VISUAL_STYLE_IDS} from "../remotion/visual-style";

// 界面只接受实际生效的业务字段，目录、文件名及版本由服务端维护。
export const profileEditSchema = z.object({
  accountId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/).optional(),
  seriesId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/).optional(),
  copyFromSeriesId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/).optional(),
  version: z.string().optional(), accountVersion: z.string().optional(),
  title: z.string().trim().min(1).max(100), description: z.string().max(5000).default(""),
  expressionStyle: z.string().max(5000).default(""), outputLanguage: z.enum(["zh-CN", "en-US"]).default("zh-CN"),
  defaultTextModel: z.enum(["deepseek-v4-flash", "deepseek-v4-pro"]).optional(), defaultVoiceId: z.string().optional(),
  tts: profileTtsSchema.optional(), visualStyle: z.enum(VISUAL_STYLE_IDS).optional(), archived: z.boolean().default(false),
  brand: z.object({title: z.string().max(100).default(""), subtitle: z.string().max(200).default(""), logo: z.string().optional(), presenterEnabled: z.boolean().default(false), outroEnabled: z.boolean().default(false)}).default({title: "", subtitle: "", presenterEnabled: false, outroEnabled: false}),
  prompts: z.record(z.string(), z.string().max(50000)).default({}),
}).strict();
export const PROMPT_FILES = ["narration-system.md", "narration-user.md", "script-system.md", "script-user.md", "visual-system.md", "visual-requirement-template.md", "visual-background-transparent.md", "visual-background-opaque.md", "cover-image-requirement-template.md", "translation-system.md", "translation-user.md", "translation-segmentation.md", "translation-visual.md", "glb-model-template.md"];
const placeholders: Record<string, string[]> = {
  "narration-user.md": ["SOURCE_CONTEXT", "CURRENT_DRAFT", "USER_FEEDBACK"], "script-user.md": ["SOURCE_CONTEXT", "CURRENT_DRAFT", "USER_FEEDBACK"],
  "translation-user.md": ["TRANSLATION_CONTEXT"], "visual-requirement-template.md": ["BACKGROUND_REQUIREMENT", "SPOKEN_TEXT"], "cover-image-requirement-template.md": ["COVER_TITLE"],
};
export const DEPLOYMENT_OVERRIDES: Record<string, string> = {
  TALK_VIDEO_BRAND_TITLE: "品牌名称", TALK_VIDEO_BRAND_SUBTITLE: "品牌副标题", TALK_VIDEO_DISPLAY_LABEL: "展示标签",
  TALK_VIDEO_SERIES_TITLE: "专栏名称", TALK_VIDEO_SERIES_DESCRIPTION: "内容定位", TALK_VIDEO_LOGO: "Logo",
  TALK_VIDEO_DEFAULT_TEXT_MODEL: "默认模型", TALK_VIDEO_PROMPT_DIR: "提示词目录",
};
export const activeOverrides = () => Object.entries(DEPLOYMENT_OVERRIDES).filter(([key]) => process.env[key]?.trim()).map(([key, label]) => ({key, label}));
export class ProfileStoreError extends Error { constructor(message: string, public status = 400) { super(message); } }
const json = async (file: string) => JSON.parse(await fs.readFile(file, "utf8"));
const nextVersion = (version?: string) => /^\d+$/.test(version || "0") ? String(BigInt(version || "0") + BigInt(1)) : String(Date.now());
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";
export const writeProfileJson = async (file: string, data: unknown) => {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temp = `${file}.${randomUUID()}.tmp`;
  try {await fs.writeFile(temp, JSON.stringify(data, null, 2) + "\n"); await fs.rename(temp, file);}
  finally {await fs.unlink(temp).catch(() => undefined);}
};
// 文件锁保护多个请求和 worker；版本比较与写入处于同一个临界区。
export const withProfileLock = async <T>(action: () => Promise<T>) => {
  await fs.mkdir(profilesRoot(), {recursive: true});
  const file = path.join(profilesRoot(), ".manager.lock");
  const handle = await fs.open(file, "wx").catch(() => {throw new ProfileStoreError("配置正在保存，请稍后重试", 409);});
  try {return await action();} finally {await handle.close(); await fs.unlink(file);}
};
export const scanProfiles = async (accountFilter?: string): Promise<Array<{accountId: string; seriesId: string; profile?: PlatformProfile; error?: string}>> => {
  const result: Array<{accountId: string; seriesId: string; profile?: PlatformProfile; error?: string}> = [];
  const accounts = await fs.readdir(profilesRoot(), {withFileTypes: true}).catch((e) => {if (missing(e)) return []; throw e;});
  for (const account of accounts.filter((a) => a.isDirectory() && !a.name.startsWith(".") && !(a.name === "defaults" && profilesRoot() === path.join(process.cwd(), "content")) && (!accountFilter || a.name === accountFilter))) {
    try {
      const entries = await fs.readdir(path.join(profilesRoot(), account.name, "series"), {withFileTypes: true});
      for (const series of entries.filter((s) => s.isDirectory() && !s.name.startsWith("."))) {
        try {result.push({accountId: account.name, seriesId: series.name, profile: await readPlatformProfile(account.name, series.name)});}
        catch (e) {result.push({accountId: account.name, seriesId: series.name, error: e instanceof Error ? e.message : "配置无效"});}
      }
    } catch (e) {result.push({accountId: account.name, seriesId: "", error: e instanceof Error ? e.message : "账号无法读取"});}
  }
  return result;
};
export const profileEditorData = async (profile: PlatformProfile) => {
  const file = path.join(profilesRoot(), profile.accountId, "series", profile.seriesId, "series.json");
  const stored = seriesSchema.parse(await json(file));
  const prompts: Record<string, {value: string; inheritedValue: string; source: string; inheritedSource: string; override?: string}> = {};
  for (const name of PROMPT_FILES) {
    const entry = await readPromptEntry(profile, name, name);
    const inherited = await readPromptEntry({...profile, resolvedPrompts: undefined}, name, name);
    prompts[name] = {...entry, inheritedValue: inherited.value, inheritedSource: inherited.source, override: stored.promptOverrides?.[name]};
  }
  return {accountId: profile.accountId, seriesId: profile.seriesId, version: profile.seriesVersion, accountVersion: profile.accountVersion,
    title: profile.seriesTitle, description: profile.seriesDescription, expressionStyle: stored.expressionStyle ?? "", outputLanguage: profile.outputLanguage,
    defaultTextModel: (process.env.TALK_VIDEO_DEFAULT_TEXT_MODEL?.trim() || profile.defaultTextModel) as PlatformProfile["defaultTextModel"], defaultVoiceId: profile.defaultVoiceId, tts: profile.tts, visualStyle: profile.visualStyle,
    archived: profile.archived ?? false, brand: {title: profile.title, subtitle: profile.subtitle, logo: profile.logo, presenterEnabled: stored.brand?.presenterEnabled ?? true, outroEnabled: profile.outroEnabled ?? false},
    logoSrc: profile.logoSrc, poses: profile.presenter.poses, prompts, sharedBrand: true, kind: profile.kind, sourceSeriesId: profile.sourceSeriesId,
  };
};
export const saveProfile = async (raw: unknown) => withProfileLock(async () => {
  const input = profileEditSchema.parse(raw);
  const accountId = input.accountId ?? `local-${randomUUID().slice(0, 8)}`;
  const seriesId = input.seriesId ?? `series-${randomUUID().slice(0, 8)}`;
  if (accountId === "builtin") throw new ProfileStoreError("通用配置请复制为新专栏后编辑");
  const root = path.join(profilesRoot(), accountId);
  const file = path.join(root, "series", seriesId, "series.json");
  const existing = await json(file).catch((e) => {if (missing(e)) return null; throw e;});
  if (input.seriesId && !input.accountId) throw new ProfileStoreError("缺少专栏所属账号");
  if (input.seriesId && !existing) throw new ProfileStoreError("专栏不存在", 404);
  if (existing && existing.configVersion !== input.version) throw new ProfileStoreError("配置已被修改，请重新加载后保存", 409);
  let account = await json(path.join(root, "account.json")).catch((e) => {if (missing(e)) return null; throw e;});
  if (account && input.accountVersion !== account.configVersion) throw new ProfileStoreError("共享人物素材已更新，请重新加载后保存", 409);
  // 部署覆盖的字段只允许原样保存，避免用户误以为编辑已生效。
  if (existing) {
    const current = await readPlatformProfile(accountId, seriesId);
    const changed: Record<string, boolean> = {TALK_VIDEO_BRAND_TITLE: input.brand.title !== current.title, TALK_VIDEO_BRAND_SUBTITLE: input.brand.subtitle !== current.subtitle,
      TALK_VIDEO_SERIES_TITLE: input.title !== current.seriesTitle, TALK_VIDEO_SERIES_DESCRIPTION: input.description !== current.seriesDescription,
      TALK_VIDEO_DEFAULT_TEXT_MODEL: input.defaultTextModel !== process.env.TALK_VIDEO_DEFAULT_TEXT_MODEL,
      TALK_VIDEO_LOGO: (input.brand.logo ?? "") !== current.logo, TALK_VIDEO_PROMPT_DIR: JSON.stringify(input.prompts) !== JSON.stringify(existing.promptOverrides ?? {})};
    for (const {key, label} of activeOverrides()) if (changed[key]) throw new ProfileStoreError(`${label}由 ${key} 覆盖，请先调整部署配置`);
  } else if (activeOverrides().length) throw new ProfileStoreError("当前存在部署级内容覆盖，请先清除覆盖后创建专栏，或使用已有专栏");
  for (const [name, value] of Object.entries(input.prompts)) {
    if (!PROMPT_FILES.includes(name) || !value.trim()) throw new ProfileStoreError(`提示词 ${name} 无效`);
    for (const token of placeholders[name] ?? []) if (!value.includes(`{{${token}}}`)) throw new ProfileStoreError(`${name} 缺少占位符 {{${token}}}`);
  }
  if (input.brand.logo && path.basename(input.brand.logo) !== input.brand.logo) throw new ProfileStoreError("Logo 文件名无效");
  const newAccount = !account;
  if (!account) {
    account = accountSchema.parse({schemaVersion: "1.0", configVersion: "1", id: accountId, title: "", subtitle: "", workspaceName: "WE-VIDEO", workspaceTitle: "We-Video 视频创作", workspaceDescription: "AI 视频创作工作台", downloadPrefix: "we-video", userAgentSuffix: "We-Video"});
  }
  if (input.brand.logo) await fs.access(path.join(root, "brand", input.brand.logo)).catch(() => {throw new ProfileStoreError("Logo 不存在，请重新上传");});
  // 校验默认模型和音色兼容性；缺少服务配置文件时仍允许管理内容。
  const {readPipelineSettings} = await import("./pipeline-settings");
  const base = (await import("./profile")).builtinProfile();
  await readPipelineSettings({...base, outputLanguage: input.outputLanguage, defaultTextModel: input.defaultTextModel || undefined, defaultVoiceId: input.defaultVoiceId || undefined, tts: input.tts}, {requireCredentials: false}).catch((e) => {if (!missing(e)) throw e;});
  const copied = input.copyFromSeriesId ? await json(path.join(root, "series", input.copyFromSeriesId, "series.json")) : null;
  if (copied && copied.configVersion !== input.version) throw new ProfileStoreError("来源专栏已更新，请重新复制", 409);
  const data = {...(existing ?? copied), schemaVersion: "1.0", configVersion: nextVersion(existing?.configVersion), id: seriesId,
    title: input.title, description: input.description, displayLabel: input.title, expressionStyle: input.expressionStyle,
    outputLanguage: input.outputLanguage, defaultTextModel: input.defaultTextModel || undefined, defaultVoiceId: input.defaultVoiceId || undefined,
    tts: input.tts, visualStyle: input.visualStyle, archived: input.archived, brand: input.brand, promptOverrides: input.prompts};
  // 保存其他字段时保留被部署覆盖的原始值，移除覆盖后可恢复原配置。
  if (existing) {
    if (process.env.TALK_VIDEO_SERIES_TITLE?.trim()) data.title = existing.title;
    if (process.env.TALK_VIDEO_SERIES_DESCRIPTION?.trim()) data.description = existing.description;
    if (process.env.TALK_VIDEO_DISPLAY_LABEL?.trim()) data.displayLabel = existing.displayLabel;
    if (process.env.TALK_VIDEO_DEFAULT_TEXT_MODEL?.trim()) data.defaultTextModel = existing.defaultTextModel;
    if (process.env.TALK_VIDEO_BRAND_TITLE?.trim()) data.brand.title = existing.brand?.title ?? account.title;
    if (process.env.TALK_VIDEO_BRAND_SUBTITLE?.trim()) data.brand.subtitle = existing.brand?.subtitle ?? account.subtitle;
    if (process.env.TALK_VIDEO_LOGO?.trim()) data.brand.logo = existing.brand?.logo ?? account.logo;
  }
  seriesSchema.parse(data);
  if (newAccount) {
    // 新账号与首个专栏同时发布，失败时不留下半配置的账号目录。
    const staging = path.join(profilesRoot(), `.new-${randomUUID()}`);
    try {
      await writeProfileJson(path.join(staging, "account.json"), account);
      await writeProfileJson(path.join(staging, "series", seriesId, "series.json"), data);
      await fs.rename(staging, root);
    } finally {await fs.rm(staging, {recursive: true, force: true});}
  } else await writeProfileJson(file, data);
  return profileEditorData(await readPlatformProfile(accountId, seriesId));
});
export const uploadProfileAsset = async (accountId: string, kind: string, version: string, file: File) => withProfileLock(async () => {
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(accountId) || !["logo", "presenter"].includes(kind)) throw new ProfileStoreError("素材类型无效");
  if (file.size > 10 * 1024 * 1024) throw new ProfileStoreError("图片不能超过 10MB");
  const accountFile = path.join(profilesRoot(), accountId, "account.json");
  const rawAccount = await json(accountFile);
  const account = {...rawAccount, ...accountSchema.parse(rawAccount)};
  if (account.configVersion !== version) throw new ProfileStoreError("素材配置已更新，请重新加载", 409);
  const bytes = Buffer.from(await file.arrayBuffer());
  const image = sharp(bytes, {limitInputPixels: 40_000_000});
  const meta = await image.metadata();
  if (!["png", "jpeg", "webp"].includes(meta.format ?? "")) throw new ProfileStoreError("仅支持 PNG、JPEG、WebP 图片");
  // 完整解码并重新编码，拒绝损坏图片，生成不可变文件名供旧任务引用。
  const filename = `${randomUUID()}.png`;
  const directory = kind === "logo" ? "brand" : account.ip.directory;
  await fs.mkdir(path.join(profilesRoot(), accountId, directory), {recursive: true});
  await fs.writeFile(path.join(profilesRoot(), accountId, directory, filename), await image.png().toBuffer());
  const pose = {id: `pose-${randomUUID().slice(0, 8)}`, file: filename, label: file.name.slice(0, 80) || "默认人物", semanticTags: ["默认"], gestureDirection: "neutral" as const, safeSide: "both" as const};
  if (kind === "presenter") {
    account.ip.poses = [...account.ip.poses, pose];
    account.ip.defaultPoseId = pose.id;
  }
  account.configVersion = nextVersion(account.configVersion);
  await writeProfileJson(accountFile, account);
  return {filename, pose: kind === "presenter" ? {...pose, src: `/api/profile-assets/${accountId}/${directory}/${filename}`} : undefined, accountVersion: account.configVersion, src: `/api/profile-assets/${accountId}/${directory}/${filename}`};
});
