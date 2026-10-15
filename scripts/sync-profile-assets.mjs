import {cp, mkdir, readdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {loadEnvFile} from "node:process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  loadEnvFile(path.join(root, ".env"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`环境变量 ${name} 未设置`);
  return value;
};
const profileRoot = path.resolve(root, process.env.TALK_VIDEO_PROFILES_DIR?.trim() || "content");
const publicRoot = path.join(root, "public", "profile-assets");
const selected = requiredEnv("TALK_VIDEO_ACCOUNT");
const selectedSeries = requiredEnv("TALK_VIDEO_SERIES");
const musicExtensions = new Set([".mp3", ".ogg"]);
const musicLabel = (name) => {
  const stem = path.basename(name, path.extname(name)).replace(/[-_]\d+$/, "");
  if (stem === "happybeat") return "Happy Beat";
  return stem
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(" ");
};
// 本地账号目录可能同时是 Git 仓库；隐藏管理目录不能作为账号读取。
const names = (await readdir(profileRoot, {withFileTypes: true}))
  .filter((item) => item.isDirectory() && !item.name.startsWith("."))
  .map((item) => item.name);
if (!names.includes(selected)) throw new Error(`账号不存在：${selected}`);
const series = JSON.parse(await readFile(path.join(profileRoot, selected, "series", selectedSeries, "series.json"), "utf8"));
if (series.id !== selectedSeries) throw new Error(`专题目录与 series.json id 不一致：${selectedSeries}`);
for (const name of names) {
  const account = JSON.parse(await readFile(path.join(profileRoot, name, "account.json"), "utf8"));
  if (account.id !== name) throw new Error(`账号目录与 account.json id 不一致：${name}`);
  const logo = name === selected ? process.env.TALK_VIDEO_LOGO?.trim() || account.logo : account.logo;
  if (path.basename(logo) !== logo) throw new Error("TALK_VIDEO_LOGO 必须是品牌目录内的文件名");
  const destination = path.join(publicRoot, name, logo);
  await mkdir(path.dirname(destination), {recursive: true});
  await cp(path.join(profileRoot, name, "brand", logo), destination);
  console.log(`synced ${name}: ${path.relative(root, destination)}`);
  if (account.ip?.directory) {
    const ipDestination = path.join(publicRoot, name, "ip");
    await mkdir(ipDestination, {recursive: true});
    // 新任务只列出正式姿态；退役素材继续同步到旧 URL，确保历史 Manifest 可渲染。
    for (const pose of account.ip.poses ?? []) {
      if (path.basename(pose.file) !== pose.file) throw new Error(`IP 素材文件名无效：${pose.file}`);
      await cp(path.join(profileRoot, name, account.ip.directory, pose.file), path.join(ipDestination, pose.file));
    }
    if (account.ip.compatibilityArchive) {
      if (!/^backup\/[a-z0-9-]+$/.test(account.ip.compatibilityArchive)) throw new Error(`兼容素材目录无效：${account.ip.compatibilityArchive}`);
      const retiredRoot = path.join(profileRoot, name, account.ip.directory, account.ip.compatibilityArchive);
      for (const entry of await readdir(retiredRoot, {withFileTypes: true})) {
        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".png") continue;
        if (path.basename(entry.name) !== entry.name) throw new Error(`兼容 IP 素材文件名无效：${entry.name}`);
        await cp(path.join(retiredRoot, entry.name), path.join(ipDestination, entry.name));
      }
    }
    console.log(`synced ${name}/ip: ${path.relative(root, ipDestination)}`);
  }
  if (account.visualAssets?.directory) {
    const visualAssetDestination = path.join(publicRoot, name, "visual-assets");
    await mkdir(visualAssetDestination, {recursive: true});
    // 视觉资源与目录一并冻结到 public，渲染阶段不再访问外部网络。
    await cp(path.join(profileRoot, name, account.visualAssets.directory), visualAssetDestination, {recursive: true});
    console.log(`synced ${name}/visual-assets: ${path.relative(root, visualAssetDestination)}`);
  }
  const seriesRoot = path.join(profileRoot, name, "series");
  for (const seriesEntry of await readdir(seriesRoot, {withFileTypes: true})) {
    if (!seriesEntry.isDirectory()) continue;
    const sourceMusicRoot = path.join(seriesRoot, seriesEntry.name, "music");
    let musicEntries;
    try {
      musicEntries = await readdir(sourceMusicRoot, {withFileTypes: true});
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const musicFiles = musicEntries
      .filter((entry) => entry.isFile() && musicExtensions.has(path.extname(entry.name).toLowerCase()))
      .sort((a, b) => {
        const aDefault = a.name === "happybeat.ogg" ? 0 : 1;
        const bDefault = b.name === "happybeat.ogg" ? 0 : 1;
        return aDefault - bDefault || a.name.localeCompare(b.name);
      });
    if (!musicFiles.length) continue;
    const publicMusicRoot = path.join(publicRoot, name, seriesEntry.name, "music");
    await mkdir(publicMusicRoot, {recursive: true});
    const options = [];
    for (const musicFile of musicFiles) {
      const musicDestination = path.join(publicMusicRoot, musicFile.name);
      await cp(path.join(sourceMusicRoot, musicFile.name), musicDestination);
      options.push({
        id: `profile-assets/${name}/${seriesEntry.name}/music/${musicFile.name}`,
        label: musicLabel(musicFile.name),
      });
      console.log(`synced ${name}/${seriesEntry.name}: ${path.relative(root, musicDestination)}`);
    }
    await writeFile(
      path.join(publicMusicRoot, "music-manifest.json"),
      `${JSON.stringify({options}, null, 2)}\n`,
      "utf8",
    );
  }
}
