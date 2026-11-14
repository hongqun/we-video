import {createHash, randomUUID} from "node:crypto";
import {promises as fs} from "node:fs";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import sharp, {type OverlayOptions} from "sharp";
import {atomicWriteJson, jobDir, readJson} from "../jobs";
import {EXPLAINER_VERSION, EXPLAINER_TIMING_VERSION, EXPLAINER_LAYER_PATHS, explainerDataSchema, explainerDesignSchema, explainerMotionSchema, explainerSchedule, type ExplainerData, type ExplainerDesign} from "../../remotion/templates/handdraw-explainer-schema";
import type {ExplainerContext} from "./context";
import {assertExplainerRequest, explainerDirectory, withExplainerLock, type ExplainerArtwork} from "./store";

export class ExplainerCompilationError extends Error {}
const execute = promisify(execFile);
export const explainerDigest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const compiler = () => path.join(process.cwd(), "packages/handdraw-agent/scripts/compile.py");
const python = () => process.env.HANDDRAW_PYTHON?.trim() || "python3";

// 限制附件必须来自当前任务的手绘目录，拒绝越界路径和指向任务外的符号链接。
export const explainerAsset = async (jobId: string, relative: string) => {
  const normalized = relative.replace(/^artifact:\/\//u, "");
  if (!normalized.startsWith("handdraw-explainers/") || normalized.includes("\\") || normalized.split("/").some((part) => !part || part === "." || part === "..")) throw new ExplainerCompilationError("手绘附件路径无效");
  const root = await fs.realpath(jobDir(jobId));
  const file = await fs.realpath(path.join(root, normalized));
  if (!file.startsWith(`${root}${path.sep}`)) throw new ExplainerCompilationError("手绘附件超出任务范围");
  return file;
};
const runCompiler = async (args: string[], signal?: AbortSignal, timeout = 300000) => {
  try {return await execute(python(), [compiler(), ...args], {timeout, maxBuffer: 2_000_000, signal});}
  catch (cause) {
    const error = cause as Error & {stderr?: string; code?: string};
    if (signal?.aborted) throw new ExplainerCompilationError("手绘请求已取消或超时");
    if (error.code === "ENOENT" || /ModuleNotFoundError|No module named/u.test(error.stderr ?? "")) throw new ExplainerCompilationError("手绘预处理环境缺失，请安装 scripts/handdraw/requirements.txt 并配置根 .env 的 HANDDRAW_PYTHON");
    throw new ExplainerCompilationError(error.stderr?.trim().split(/\r?\n/u).at(-1)?.slice(0, 1600) || "手绘预处理失败或超时，请简化素材后重试");
  }
};
// 实际发起制作时先验证本地运行环境，避免生图成功后才发现 Python 模块缺失。
export const assertExplainerEnvironment = async () => {
  const {stdout} = await runCompiler(["doctor"], undefined, 10000);
  if (JSON.parse(stdout).ready !== true) throw new ExplainerCompilationError("手绘预处理环境未就绪");
};
export const probeExplainerLine = async (file: string, signal?: AbortSignal) => {
  const {stdout} = await runCompiler(["probe", file], signal);
  const report = JSON.parse(stdout) as {strokeCount: number; minimumLineMs: number};
  if (!Number.isFinite(report.minimumLineMs) || report.minimumLineMs <= 0) throw new ExplainerCompilationError("线稿预算报告无效");
  return report;
};

// 绘制源码、字体和笔顺资料都参与缓存身份，替换运行依赖不会悄悄复用旧产物。
export const explainerDependencyIdentity = async () => {
  const lock = await readJson<{modules: Record<string, string>}>(path.join(process.cwd(), "packages/handdraw-agent/resources/drawing-modules.lock.json"));
  const files = [...Object.keys(lock.modules), "packages/handdraw-agent/scripts/compile.py", "packages/handdraw-agent/scripts/handwriting.py", "packages/handdraw-agent/resources/hanzi/gb2312-strokes.json.xz", "public/fonts/ZCOOLKuaiLe-Regular.ttf"];
  return Promise.all(files.map(async (name) => {
    const digest = explainerDigest(await fs.readFile(path.join(process.cwd(), name)));
    if (lock.modules[name] && lock.modules[name] !== digest) throw new ExplainerCompilationError("绘制模块与固定版本不一致，请核对并同步 drawing-modules.lock.json 后再制作");
    return [name, digest];
  }));
};

export const compileExplainer = async (jobId: string, context: ExplainerContext, raw: unknown, artworks: ExplainerArtwork[], requestId: string, signal?: AbortSignal): Promise<{design: ExplainerDesign; data: ExplainerData; notes: unknown[]}> => {
  const design = explainerDesignSchema.parse(raw);
  const [sx, sy, sw, sh] = context.canvas.safeArea as [number, number, number, number];
  for (const item of [...design.illustrations, ...design.labels]) {
    const [x, y, w, h] = item.box;
    if (x < sx || y < sy || x + w > sx + sw + .001 || y + h > sy + sh + .001) throw new ExplainerCompilationError(`元素 ${item.id} 超出当前人物安全区，请调整布局`);
  }
  const inputs: Record<string, {lineFile: string; colorFile: string}> = {};
  const identities = [];
  for (const picture of design.illustrations) {
    const art = artworks.find((item) => item.id === picture.artworkId);
    if (!art) throw new ExplainerCompilationError(`插画 ${picture.artworkId} 尚未完成生图和视觉复核`);
    if (art.contextFingerprint !== context.fingerprint) throw new ExplainerCompilationError(`插画 ${picture.artworkId} 需要按当前口播与风格重新复核后再复用`);
    const lineFile = await explainerAsset(jobId, art.linePath), colorFile = await explainerAsset(jobId, art.colorPath);
    if (explainerDigest(await fs.readFile(lineFile)) !== art.lineHash || explainerDigest(await fs.readFile(colorFile)) !== art.colorHash) throw new ExplainerCompilationError("插画已被替换，请重新复核后制作");
    inputs[picture.artworkId] = {lineFile, colorFile}; identities.push([art.id, art.lineHash, art.colorHash]);
  }
  const cacheKey = explainerDigest(JSON.stringify({version: EXPLAINER_VERSION, timingVersion: EXPLAINER_TIMING_VERSION, fingerprint: context.fingerprint, design, identities, dependencies: await explainerDependencyIdentity()}));
  const directory = explainerDirectory(jobId, context.sceneId);
  const relative = `handdraw-explainers/${context.sceneId}/compiled/${cacheKey}`;
  const final = path.join(jobDir(jobId), relative);
  try {return {design, data: await verifyExplainerArtifacts(jobId, await readJson(path.join(final, "data.json"))), notes: []};}
  catch { /* 缓存不存在或损坏时在独立目录完整重建。 */ }
  const work = path.join(directory, `work-${randomUUID()}`);
  await fs.mkdir(work, {recursive: true});
  try {
    await atomicWriteJson(path.join(work, "input.json"), {design, artworks: inputs});
    await runCompiler(["compile", path.join(work, "input.json"), work], signal);
    const report = await readJson<{layers: Array<Omit<ExplainerData["layers"][number], "startFrame" | "endFrame" | "hashes">>; notes: unknown[]}>(path.join(work, "report.json"));
    let schedule: ReturnType<typeof explainerSchedule>;
    try {schedule = explainerSchedule(context.scene, context.captions, design, Object.fromEntries(report.layers.map((item) => [item.id, item.durationMs])));}
    catch (cause) {throw new ExplainerCompilationError(cause instanceof Error ? cause.message : "口播窗口校验失败");}
    const speedNotes = report.layers.flatMap((layer) => {
      const window = schedule[layer.id]!;
      const speed = layer.durationMs * .03 / (window.endFrame - window.startFrame);
      return speed > 1.01 ? [`动作 ${layer.id} 按 ${speed.toFixed(2)} 倍速绘制，已保留阅读窗口`] : [];
    });
    report.notes.push(...speedNotes);
    const layers: ExplainerData["layers"] = [];
    const overlays: OverlayOptions[] = [];
    const artMask = new Uint8Array(960 * 800), textMask = new Uint8Array(960 * 800);
    for (const layer of report.layers) {
      const hashes = {} as ExplainerData["layers"][number]["hashes"];
      for (const key of EXPLAINER_LAYER_PATHS) hashes[key] = explainerDigest(await fs.readFile(path.join(work, layer[key])));
      layers.push({...layer, ...schedule[layer.id]!, ...Object.fromEntries(EXPLAINER_LAYER_PATHS.map((key) => [key, `${relative}/${layer[key]}`])), hashes});
      const width = Math.max(1, Math.round(layer.box[2] * 960)), height = Math.max(1, Math.round(layer.box[3] * 800));
      const left = Math.round(layer.box[0] * 960), top = Math.round(layer.box[1] * 800);
      const combined = await sharp(path.join(work, layer.colorPath)).composite([{input: path.join(work, layer.linePath)}]).png().toBuffer();
      const buffer = await sharp(combined).resize(width, height).png().toBuffer();
      const raw = await sharp(buffer).ensureAlpha().raw().toBuffer();
      const target = layer.kind === "text" ? textMask : artMask;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (raw[(y * width + x) * 4 + 3]! > 24) {
        const at = (top + y) * 960 + left + x;
        if (at < 0 || at >= target.length || left + x >= 960 || top + y >= 800) throw new ExplainerCompilationError("绘制内容越过画布");
        if (layer.kind === "text" && target[at]) throw new ExplainerCompilationError("手写标签彼此重叠，请调整文字位置");
        target[at] = 1;
      }
      overlays.push({input: buffer, left, top});
    }
    if (textMask.some((value, index) => value !== 0 && artMask[index] !== 0)) throw new ExplainerCompilationError("手写文字与插画真实像素重叠，请为文字预留空白区域");
    const complete = await sharp({create: {width: 960, height: 800, channels: 4, background: "#00000000"}}).composite(overlays).png().toBuffer();
    await fs.writeFile(path.join(work, "complete.png"), complete);
    const data = explainerDataSchema.parse({schemaVersion: "1.0", compilerVersion: EXPLAINER_VERSION, sceneId: context.sceneId, sceneStartMs: context.scene.startMs, sceneEndMs: context.scene.endMs, contextFingerprint: context.fingerprint, cacheKey, width: 960, height: 800, fps: 30, durationInFrames: context.durationInFrames, layers, completePath: `${relative}/complete.png`, completeHash: explainerDigest(complete)});
    await atomicWriteJson(path.join(work, "data.json"), data);
    await fs.mkdir(path.dirname(final), {recursive: true});
    // 缓存发布也受请求锁保护，取消后的编译进程不能移走新请求已经发布的图层。
    const published = await withExplainerLock(jobId, context.sceneId, async () => {
      await assertExplainerRequest(jobId, context.sceneId, requestId);
      if (signal?.aborted) throw new ExplainerCompilationError("手绘请求已取消或超时");
      if ((await (await import("./context")).loadExplainerContext(jobId, context.sceneId)).context.fingerprint !== context.fingerprint) throw new ExplainerCompilationError("镜头上下文已变化，请重新制作");
      try {return await verifyExplainerArtifacts(jobId, await readJson(path.join(final, "data.json")));}
      catch { /* 只替换已损坏的缓存，正确的不可变产物始终复用。 */ }
      await fs.rm(final, {recursive: true, force: true});
      await fs.rename(work, final);
      return verifyExplainerArtifacts(jobId, data);
    });
    return {design, data: published, notes: report.notes};
  } finally {await fs.rm(work, {recursive: true, force: true});}
};

export const verifyExplainerArtifacts = async (jobId: string, raw: unknown) => {
  const data = explainerDataSchema.parse(raw);
  const prefix = `handdraw-explainers/${data.sceneId}/compiled/${data.cacheKey}/`;
  const verify = async (relative: string, hash: string, dimensions?: {width: number; height: number}) => {
    if (!relative.replace(/^artifact:\/\//u, "").startsWith(prefix)) throw new ExplainerCompilationError("手绘产物与镜头缓存不一致");
    const bytes = await fs.readFile(await explainerAsset(jobId, relative));
    if (explainerDigest(bytes) !== hash) throw new ExplainerCompilationError("手绘产物已变更或损坏，请重新制作");
    if (dimensions) {const metadata = await sharp(bytes).metadata(); if (metadata.format !== "png" || metadata.width !== dimensions.width || metadata.height !== dimensions.height) throw new ExplainerCompilationError("手绘图层格式或尺寸不一致");}
    return bytes;
  };
  await verify(data.completePath, data.completeHash, data);
  for (const layer of data.layers) for (const key of EXPLAINER_LAYER_PATHS) {
    const bytes = await verify(layer[key], layer.hashes[key], key === "motionPath" ? undefined : layer);
    if (key === "motionPath") {
      const motion = explainerMotionSchema.parse(JSON.parse(bytes.toString()));
      if (motion.durationMs !== layer.durationMs || motion.points.some((point) => point[1] < -1 || point[2] < -1 || point[1] > layer.width + 1 || point[2] > layer.height + 1)) throw new ExplainerCompilationError("画笔轨迹与图层不一致");
    }
  }
  return data;
};
