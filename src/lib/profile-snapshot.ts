import {promises as fs} from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {readPlatformProfile, profilesRoot, type ContentProfileContext, type PlatformProfile} from "./profile";
import {PROMPT_FILES, writeProfileJson, withProfileLock} from "./profile-store";
import {readFixedPrompt} from "./narration-prompts";
import {JOBS_ROOT, REPO_ROOT} from "./paths";

const directoryFor = (jobId: string) => {
  // 任务 ID 可带时间字符，但不能逃出任务目录。
  if (!jobId || path.basename(jobId) !== jobId || jobId === "." || jobId === "..") throw new Error("任务 ID 无效");
  return path.join(JOBS_ROOT, jobId);
};
export const readProfileSnapshot = async (jobId: string, context: ContentProfileContext): Promise<PlatformProfile> => {
  try {
    const snapshot = JSON.parse(await fs.readFile(path.join(directoryFor(jobId), "profile-snapshot.json"), "utf8")) as PlatformProfile;
    if (snapshot.accountId !== context.accountId || snapshot.seriesId !== context.seriesId) throw new Error("任务配置快照与任务不一致");
    return snapshot;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new Error("旧任务尚未固定配置，请在工作台确认采用当前专栏配置后继续");
    throw e;
  }
};
export const hasProfileSnapshot = async (jobId: string) => fs.access(path.join(directoryFor(jobId), "profile-snapshot.json")).then(() => true, () => false);
export const freezeProfile = async (jobId: string, profile: PlatformProfile, sourceJobId?: string): Promise<PlatformProfile> => withProfileLock(async () => {
  const directory = directoryFor(jobId);
  if (await hasProfileSnapshot(jobId)) return readProfileSnapshot(jobId, profile);
  await fs.mkdir(path.join(directory, "profile-assets"), {recursive: true});
  const resolvedPrompts: Record<string, string> = {};
  for (const name of PROMPT_FILES) resolvedPrompts[name] = await readFixedPrompt(profile, name, name);
  const copy = async (src: string) => {
    if (!src) return "";
    let file: string;
    if (src.startsWith("artifact://")) {
      if (!sourceJobId) throw new Error("复制任务素材需要来源任务");
      const relative = src.slice("artifact://".length);
      if (!relative.startsWith("profile-assets/") || relative.includes("..")) throw new Error("任务素材路径无效");
      const name = `${randomUUID()}${path.extname(relative)}`;
      await fs.copyFile(path.join(directoryFor(sourceJobId), relative), path.join(directory, "profile-assets", name));
      return `artifact://profile-assets/${name}`;
    }
    if (src.startsWith("/api/profile-assets/")) {
      const relative = src.slice("/api/profile-assets/".length);
      if (relative.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("品牌素材路径无效");
      file = path.join(profilesRoot(), relative);
    } else {
      if (!src.startsWith("profile-assets/") || src.includes("..")) throw new Error("品牌素材必须是本地文件");
      file = path.join(REPO_ROOT, "public", src);
    }
    const allowedRoot = await fs.realpath(src.startsWith("/api/") ? profilesRoot() : path.join(REPO_ROOT, "public"));
    file = await fs.realpath(file);
    if (!file.startsWith(allowedRoot + path.sep)) throw new Error("品牌素材越出允许目录");
    const name = `${randomUUID()}${path.extname(file)}`;
    await fs.copyFile(file, path.join(directory, "profile-assets", name));
    return `artifact://profile-assets/${name}`;
  };
  const poses = await Promise.all(profile.presenter.poses.map(async (pose) => ({...pose, src: await copy(pose.src)})));
  const compatibilityPoses = await Promise.all((profile.presenter.compatibilityPoses ?? []).map(async (pose) => ({...pose, src: await copy(pose.src)})));
  const {readPipelineSettings} = await import("./pipeline-settings");
  const settings = await readPipelineSettings(profile, {requireCredentials: false});
  const {model, rate, pitch, volume, instruction, seed, languageHints, pauseMs} = settings.tts;
  const frozen: PlatformProfile = {...profile, snapshot: true, defaultTextModel: settings.defaultTextModel, defaultVoiceId: settings.defaultVoiceId,
    tts: {model, rate, pitch, volume, instruction, seed, languageHints: languageHints as NonNullable<PlatformProfile["tts"]>["languageHints"], pauseMs}, logoSrc: await copy(profile.logoSrc), presenter: {poses, compatibilityPoses}, resolvedPrompts};
  // 配置与提示词作为一份快照原子发布，素材先写完再暴露给 worker。
  await writeProfileJson(path.join(directory, "profile-snapshot.json"), frozen);
  return frozen;
});
export const freezeCurrentProfile = async (jobId: string, context: ContentProfileContext) => await hasProfileSnapshot(jobId) ? readProfileSnapshot(jobId, context) : freezeProfile(jobId, await readPlatformProfile(context.accountId, context.seriesId));
