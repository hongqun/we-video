import {promises as fs, openSync, closeSync} from "node:fs";
import path from "node:path";
import {createHash, randomUUID} from "node:crypto";
import {execFile, spawn} from "node:child_process";
import {promisify} from "node:util";
import sharp from "sharp";
import {atomicWriteJson, jobDir, readJob, readJson, safeArtifactPath, updateJobState} from "./jobs";
import {mutateVisualResources, readVisualResources, type VisualResources} from "./visual-resources";
import {assertVisualPlanEditableState, readVisualPlan} from "./visual-plan";
import {readFixedPrompt} from "./narration-prompts";
import {readJobPlatformProfile} from "./profile";
import {spokenTextForTimeRange} from "./visual-plan-text";
import {HANDDRAW_PATH_FIELDS, HANDDRAW_VERSION, handdrawDataSchema, handdrawMotionSchema, handdrawLiftMs, handdrawPromptBudget, type HanddrawData, type HanddrawResource} from "@/remotion/templates/handdraw-schema";

const execFileAsync = promisify(execFile);
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const asset = (jobId: string, relative: string) => {
  if (!/^handdraw\/[a-zA-Z0-9/_.-]+$/.test(relative) || relative.split("/").some((part) => part.startsWith("."))) throw new Error("手绘素材路径无效");
  return safeArtifactPath(jobId, relative.split("/"));
};
export const handdrawCacheKey = (resource: HanddrawResource) => resource.lineart && resource.color ? digest(`${HANDDRAW_VERSION}:${resource.lineart.sha256}:${resource.color.sha256}`) : undefined;

export const assertHanddrawScene = async (jobId: string, sceneId: string, editable = false) => {
  if (!/^[-a-zA-Z0-9]+$/.test(sceneId)) throw new Error("镜头 ID 无效");
  const job = await readJob(jobId);
  if (editable) assertVisualPlanEditableState(job.state);
  if (editable && job.state === "planning_visuals") throw new Error("镜头规划正在生成，请完成后再修改手绘素材");
  const plan = await readVisualPlan(jobId);
  const scene = plan.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error("未找到镜头；请先保存镜头规划");
  return {job, scene, plan};
};

const invalidate = async (jobId: string) => {
  const job = await readJob(jobId);
  await Promise.all(["manifest.json", "output.mp4"].map((name) => fs.rm(path.join(jobDir(jobId), name), {force: true})));
  if (["ready", "completed", "failed"].includes(job.state)) await updateJobState(jobId, {state: "awaiting_visual_review", error: null});
};

export const changeHanddrawImage = async (jobId: string, sceneId: string, kind: "lineart" | "color", file?: File) => {
  const {scene} = await assertHanddrawScene(jobId, sceneId, true);
  let image: NonNullable<HanddrawResource["lineart"]> | undefined;
  if (file) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size <= 0 || file.size > 10 * 1024 * 1024) throw new Error("仅支持 10MB 以内的 PNG、JPEG 或 WebP 图片");
    const input = Buffer.from(await file.arrayBuffer());
    const metadata = await sharp(input, {limitInputPixels: 16000000}).metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > 16000000 || (metadata.pages ?? 1) > 1 || !["png", "jpeg", "webp"].includes(metadata.format ?? "")) throw new Error("仅支持不超过 1600 万像素的静态 PNG、JPEG 或 WebP 图片");
    const normalized = await sharp(input, {limitInputPixels: 16000000}).rotate().flatten({background: "white"}).removeAlpha().png().toBuffer({resolveWithObject: true});
    const sha256 = digest(normalized.data);
    const relative = `handdraw/inputs/${sha256}.png`;
    await fs.mkdir(path.dirname(asset(jobId, relative)), {recursive: true});
    // 输入只按内容寻址，替换和拆分都不会改写其他镜头仍在引用的文件。
    await fs.writeFile(asset(jobId, relative), normalized.data, {flag: "wx"}).catch((error) => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; });
    image = {path: relative, sha256, width: normalized.info.width, height: normalized.info.height};
  }
  await mutateVisualResources(jobId, async (resources) => {
    await assertHanddrawScene(jobId, sceneId, true);
    const current = resources.resources.find((item) => item.sceneId === sceneId) ?? {sceneId, segmentId: scene.segmentId, polygons: []};
    const previous = current.handdraw;
    const next: HanddrawResource = {lineart: previous?.lineart, color: previous?.color, [kind]: image, status: "waiting"};
    if (next.lineart && next.color && (next.lineart.width !== next.color.width || next.lineart.height !== next.color.height)) throw new Error("线稿与上色图尺寸不一致；请以原线稿上色并保持画布尺寸");
    return {...resources, resources: [...resources.resources.filter((item) => item.sceneId !== sceneId), {...current, handdraw: next}]};
  });
  await invalidate(jobId);
  if (file) await startHanddraw(jobId, sceneId);
  return readVisualResources(jobId);
};

export const startHanddraw = async (jobId: string, sceneId: string) => {
  await assertHanddrawScene(jobId, sceneId, true);
  const requestId = randomUUID(); let started = false;
  await mutateVisualResources(jobId, async (resources) => {
    await assertHanddrawScene(jobId, sceneId, true);
    const resource = resources.resources.find((item) => item.sceneId === sceneId)?.handdraw;
    if (!resource?.lineart || !resource.color) return resources;
    if (resource.status === "processing" && Date.now() - Date.parse(resource.startedAt ?? "") < 11 * 60000) return resources;
    started = true;
    return {...resources, resources: resources.resources.map((item) => item.sceneId === sceneId ? {...item, handdraw: {...resource, status: "processing" as const, data: undefined, error: undefined, requestId, startedAt: new Date().toISOString()}} : item)};
  });
  if (!started) return;
  await invalidate(jobId);
  let log: number | undefined;
  try {
    log = openSync(path.join(jobDir(jobId), "handdraw.log"), "a");
    // 直接使用当前 Node 的 tsx loader，避免 npx CLI 的额外 IPC 和 PATH 环境差异。
    const child = spawn(process.execPath, ["--import", "tsx", "src/server/handdraw-worker.ts", jobId, sceneId, requestId], {cwd: process.cwd(), env: {...process.env}, detached: true, stdio: ["ignore", log, log]});
    await new Promise<void>((resolve, reject) => {child.once("spawn", resolve); child.once("error", reject);});
    child.once("exit", (code) => {if (code !== 0) void publishHanddrawResult(jobId, sceneId, requestId, undefined, "手绘预处理进程异常退出，请重试；详细原因见 handdraw.log").catch(console.error);});
    child.unref();
  } catch (error) { await publishHanddrawResult(jobId, sceneId, requestId, undefined, error instanceof Error ? error.message : String(error)); }
  finally { if (log !== undefined) closeSync(log); }
};

// worker 只能提交仍属于本次请求的结果，替图或删除后的旧请求直接丢弃。
export const publishHanddrawResult = async (jobId: string, sceneId: string, requestId: string, data?: HanddrawData, error?: string) => mutateVisualResources(jobId, (resources) => {
  const current = resources.resources.find((item) => item.sceneId === sceneId)?.handdraw;
  if (!current || current.requestId !== requestId || current.status !== "processing") return resources;
  if (data && handdrawCacheKey(current) !== data.cacheKey) return resources;
  return {...resources, resources: resources.resources.map((item) => item.sceneId === sceneId ? {...item, handdraw: {...current, status: data ? "ready" as const : "failed" as const, data, error}} : item)};
});

const filenames = {completePath: "complete.png", lineLayerPath: "line.png", colorLayerPath: "color.png", lineTimePath: "line-time.png", colorTimePath: "color-time.png", motionPath: "motion.json"} as const;
export const verifyHanddrawArtifacts = async (jobId: string, raw: unknown) => {
  const data = handdrawDataSchema.parse(raw);
  let liftMs: number | undefined;
  for (const key of HANDDRAW_PATH_FIELDS) {
    const relative = data[key].replace(/^artifact:\/\//u, "");
    if (relative !== `handdraw/cache/${data.cacheKey}/${filenames[key]}`) throw new Error("手绘产物路径与缓存键不匹配");
    const bytes = await fs.readFile(asset(jobId, relative));
    if (!data.hashes[key] || digest(bytes) !== data.hashes[key]) throw new Error("手绘产物已变化，请重新处理");
    if (key !== "motionPath") {
      const metadata = await sharp(bytes).metadata();
      if (metadata.width !== data.width || metadata.height !== data.height || metadata.format !== "png") throw new Error("手绘图层尺寸或格式无效");
    } else {
      const motion = handdrawMotionSchema.parse(JSON.parse(bytes.toString()));
      if (motion.cacheKey !== data.cacheKey || motion.width !== data.width || motion.height !== data.height || motion.minimumDrawMs !== data.minimumDrawMs) throw new Error("手绘运动计划与图层不一致");
      liftMs = handdrawLiftMs(motion);
      if (data.motionTiming && Math.abs(data.motionTiming.liftMs - liftMs) > .01) throw new Error("手绘抬笔统计与运动计划不一致");
    }
  }
  return {...data, ...(liftMs !== undefined ? {motionTiming: {liftMs}} : {})};
};

export const prepareHanddraw = async (jobId: string, sceneId: string, requestId: string) => {
  const resource = (await readVisualResources(jobId)).resources.find((item) => item.sceneId === sceneId)?.handdraw;
  if (!resource?.lineart || !resource.color || resource.requestId !== requestId) return;
  const cacheKey = handdrawCacheKey(resource)!;
  const relative = `handdraw/cache/${cacheKey}`;
  const finalDir = asset(jobId, relative);
  const temporary = path.join(jobDir(jobId), "handdraw", `work-${requestId}`);
  try {
    for (const source of [resource.lineart, resource.color]) if (digest(await fs.readFile(asset(jobId, source.path))) !== source.sha256) throw new Error("上传素材已改变，请重新上传");
    let cached: HanddrawData | undefined;
    try { cached = await verifyHanddrawArtifacts(jobId, await readJson(path.join(finalDir, "data.json"))); }
    catch { /* 缓存缺失或损坏时先完整重建，发布时再原子替换。 */ }
    if (!cached) {
      await fs.mkdir(temporary, {recursive: true});
      try {
        await execFileAsync(process.env.HANDDRAW_PYTHON?.trim() || "python3", [path.join(process.cwd(), "scripts/handdraw/prepare.py"), asset(jobId, resource.lineart.path), asset(jobId, resource.color.path), temporary, cacheKey], {timeout: 10 * 60000, maxBuffer: 1024 * 1024});
      } catch (cause) {
        const error = cause as Error & {stderr?: string; code?: string};
        if (error.code === "ENOENT" || /ModuleNotFoundError|No module named/.test(error.stderr ?? "")) throw new Error("Python 环境缺失：请安装 scripts/handdraw/requirements.txt 中的依赖，并在 .env 设置 HANDDRAW_PYTHON");
        throw new Error(error.stderr?.trim().slice(-2000) || "手绘预处理超时或失败；请简化图片后重试");
      }
      const report = await readJson<{algorithmVersion: string; cacheKey: string; width: number; height: number; minimumDrawMs: number}>(path.join(temporary, "report.json"));
      const paths = Object.fromEntries(HANDDRAW_PATH_FIELDS.map((key) => [key, `${relative}/${filenames[key]}`]));
      const hashes: Record<string, string> = {};
      for (const key of HANDDRAW_PATH_FIELDS) hashes[key] = digest(await fs.readFile(path.join(temporary, filenames[key])));
      const motion = handdrawMotionSchema.parse(await readJson(path.join(temporary, "motion.json")));
      cached = handdrawDataSchema.parse({algorithmVersion: report.algorithmVersion, cacheKey: report.cacheKey, width: report.width, height: report.height, minimumDrawMs: report.minimumDrawMs, motionTiming: {liftMs: handdrawLiftMs(motion)}, ...paths, hashes});
      await atomicWriteJson(path.join(temporary, "data.json"), cached);
      // 发布与缓存修复串行，避免同图并发任务移走另一进程刚发布的正确缓存。
      await mutateVisualResources(jobId, async (resources) => {
        try {await verifyHanddrawArtifacts(jobId, await readJson(path.join(finalDir, "data.json")));}
        catch {
          await fs.mkdir(path.dirname(finalDir), {recursive: true});
          await fs.rename(finalDir, `${temporary}-invalid`).catch((error) => {if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;});
          await fs.rename(temporary, finalDir);
        }
        return resources;
      });
      cached = await verifyHanddrawArtifacts(jobId, await readJson(path.join(finalDir, "data.json")));
    }
    await publishHanddrawResult(jobId, sceneId, requestId, cached);
  } catch (error) { await publishHanddrawResult(jobId, sceneId, requestId, undefined, error instanceof Error ? error.message : String(error)); }
  finally { await Promise.all([temporary, `${temporary}-invalid`].map((directory) => fs.rm(directory, {recursive: true, force: true}))); }
};

export const readHanddrawResources = async (jobId: string, sceneId: string): Promise<VisualResources> => {
  await assertHanddrawScene(jobId, sceneId);
  return mutateVisualResources(jobId, (resources) => {
    let changed = false;
    const items = resources.resources.map((item) => {
      const resource = item.handdraw;
      if (item.sceneId !== sceneId || resource?.status !== "processing" || Date.now() - Date.parse(resource.startedAt ?? "") < 11 * 60000) return item;
      changed = true;
      return {...item, handdraw: {...resource, status: "failed" as const, error: "预处理未完成或进程中断，请重试"}};
    });
    return changed ? {...resources, resources: items} : resources;
  });
};

export const handdrawPrompts = async (jobId: string, sceneId: string) => {
  const {job, scene, plan} = await assertHanddrawScene(jobId, sceneId);
  const profile = await readJobPlatformProfile(job.contentProfile, job.jobId);
  const [narration, draft] = await Promise.all([
    readJson<{captions: Parameters<typeof spokenTextForTimeRange>[0]}>(path.join(jobDir(jobId), "audio/narration.json")),
    readJson<{narrationSegments: Array<{id: string; spokenText: string}>}>(path.join(jobDir(jobId), "draft.json")),
  ]);
  // 未拆分时使用确认稿，避免词级字幕跨段粘连导致提示词漏掉句首。
  const confirmed = draft.narrationSegments.find((segment) => segment.id === scene.segmentId)?.spokenText ?? "";
  const text = plan.scenes.filter((item) => item.segmentId === scene.segmentId).length > 1 ? spokenTextForTimeRange(narration.captions, scene.startMs, scene.endMs) || confirmed : confirmed;
  const budget = handdrawPromptBudget(scene);
  const values: Record<string, string> = {
    SPOKEN_TEXT: text, ASPECT_RATIO: "1:1（主体完整，白色画纸）", DRAW_SECONDS: budget.drawSeconds.toFixed(1),
    MAX_STROKES: String(budget.maxStrokes), MAX_SUBJECTS: String(budget.maxSubjects), MAX_PROPS: String(budget.maxProps),
    MAX_COLORS: String(budget.maxColors), MAX_REGIONS: String(budget.maxRegions),
  };
  const read = async (kind: string) => {
    const name = `handdraw-${kind}-template.md`;
    // 旧任务快照没有新模板时固定一次默认值，此后仍从该任务快照读取。
    if (profile.snapshot && !profile.resolvedPrompts?.[name]) {
      const value = await fs.readFile(path.join(process.cwd(), "content/defaults", name), "utf8");
      profile.resolvedPrompts = {...profile.resolvedPrompts, [name]: value};
      await atomicWriteJson(path.join(jobDir(jobId), "profile-snapshot.json"), profile);
    }
    let prompt = await readFixedPrompt(profile, name, "手绘提示词");
    for (const [key, value] of Object.entries(values)) prompt = prompt.replaceAll(`{{${key}}}`, value);
    // 预算独立于冻结的创作模板，旧任务和专栏覆盖也始终获得当前镜头约束。
    const currentBudget = `本镜头实际时长 ${budget.sceneSeconds.toFixed(1)} 秒，描线与上色合计最多 ${budget.drawSeconds.toFixed(1)} 秒，成图展示预留 ${budget.holdSeconds.toFixed(1)} 秒。`;
    const constraints = kind === "lineart"
      ? `最多 ${budget.maxSubjects} 个主体、${budget.maxProps} 个必要道具，独立笔画以不超过约 ${budget.maxStrokes} 笔为创作目标。只表达一个核心关系，不画完整故事、多场景拼图、重复图标或密集五官；口播内容较多时主动取舍，只保留最能解释它的画面。优先完整外轮廓，删去装饰细线。`
      : `最多使用 ${budget.maxColors} 种主要填色和约 ${budget.maxRegions} 块大色区，保留白色留白。保持线稿不变，禁止通过渐变、纹理、细碎阴影或高光新增色区。`;
    return `${prompt}\n\n当前镜头的绘制预算（优先满足）：\n${currentBudget}\n${constraints}`;
  };
  return {lineart: await read("lineart"), color: await read("color"), budget};
};
