import {promises as fs} from "node:fs";
import path from "node:path";
import {createHash, randomUUID} from "node:crypto";
import {profilesRoot} from "./profile";
import {REPO_ROOT} from "./paths";
import type {RenderManifest} from "../remotion/schema";

// 历史 Manifest 引用静态品牌目录，按原文件名查找并固定，不依赖启动同步。
export const freezeLegacyBrandAssets = async (manifest: RenderManifest, directory: string): Promise<RenderManifest> => {
  const copy = async (src: string) => {
    if (!src.startsWith("profile-assets/")) return src;
    const parts = src.slice("profile-assets/".length).split("/");
    if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\\"))) throw new Error("历史品牌素材路径无效");
    const [accountId, ...relative] = parts;
    const accountRoot = path.join(profilesRoot(), accountId);
    const candidates = [path.join(REPO_ROOT, "public", src), path.join(accountRoot, ...(relative.length === 1 ? ["brand", ...relative] : relative))];
    if (relative[0] === "ip") {
      // 退役姿态仍使用原文件名，兼容账号配置中的归档目录。
      const account = await fs.readFile(path.join(accountRoot, "account.json"), "utf8").then(JSON.parse).catch((e: NodeJS.ErrnoException) => {if (e.code === "ENOENT") return null; throw e;});
      if (account?.ip?.compatibilityArchive) candidates.push(path.join(accountRoot, account.ip.directory, account.ip.compatibilityArchive, relative.at(-1)!));
    }
    for (const file of candidates) {
      let bytes: Buffer;
      try {bytes = await fs.readFile(file);} catch (e) {if ((e as NodeJS.ErrnoException).code === "ENOENT") continue; throw e;}
      const name = `${createHash("sha256").update(bytes).digest("hex")}${path.extname(file)}`;
      await fs.mkdir(path.join(directory, "profile-assets"), {recursive: true});
      // 内容寻址保证并发读取和重复渲染引用同一不可变素材。
      const temporary = path.join(directory, "profile-assets", `.${randomUUID()}.tmp`);
      try {await fs.writeFile(temporary, bytes); await fs.rename(temporary, path.join(directory, "profile-assets", name));}
      finally {await fs.unlink(temporary).catch(() => undefined); }
      return `artifact://profile-assets/${name}`;
    }
    throw new Error(`历史品牌素材不存在：${src}，请恢复原始图片文件`);
  };
  return {...manifest, brand: {...manifest.brand, logoSrc: await copy(manifest.brand.logoSrc)},
    ...(manifest.presenter ? {presenter: {poses: await Promise.all(manifest.presenter.poses.map(async (pose) => ({...pose, src: await copy(pose.src)})))}} : {}),
  };
};
