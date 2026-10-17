import {promises as fs} from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {createHash} from "node:crypto";
import {z} from "zod";
import {atomicWriteJson, jobDir, readJob, readJson, updateJobState} from "./jobs";
import {resetModelPlan} from "@/remotion/templates/model-scene-editing";
import type {VisualPlan} from "./visual-plan";
import {visualResourceForScene} from "./visual-resource-selection";
import {visualImagePolygonSchema} from "@/remotion/templates/visual-image-schema";

// 第四步视觉资源是独立事实源；新资源按 sceneId 隔离，segmentId 只保留父口播段兼容关系。
export const visualResourceSchema = z.object({
  segmentId: z.string().trim().min(1),
  sceneId: z.string().trim().min(1).optional(),
  imagePath: z.string().trim().min(1).optional(),
  imageWidth: z.number().int().positive().optional(),
  imageHeight: z.number().int().positive().optional(),
  modelPath: z.string().trim().min(1).optional(),
  polygons: z.array(visualImagePolygonSchema).default([]),
}).strict().superRefine((resource, context) => {
  const imageFields = [resource.imagePath, resource.imageWidth, resource.imageHeight].filter((value) => value !== undefined).length;
  if (imageFields && imageFields !== 3) context.addIssue({code: "custom", path: ["imagePath"], message: "图片路径与真实尺寸必须同时保存"});
});
export const visualResourcesSchema = z.object({schemaVersion: z.literal("1.0"), revision: z.number().int().positive().default(1), resources: z.array(visualResourceSchema)}).strict();
export type VisualResource = z.infer<typeof visualResourceSchema>;
export type VisualResources = z.infer<typeof visualResourcesSchema>;

export const visualResourcesPath = (jobId: string) => path.join(jobDir(jobId), "visual-resources.json");
export const readVisualResources = async (jobId: string, revision?: number): Promise<VisualResources> => {
  void revision;
  try { return visualResourcesSchema.parse(await readJson<unknown>(visualResourcesPath(jobId))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {schemaVersion: "1.0", revision: 1, resources: []};
    throw error;
  }
};

export const saveVisualResource = async (jobId: string, segmentId: string, patch: Partial<Omit<VisualResource, "segmentId" | "sceneId">>, sceneId?: string) => {
  const resources = await readVisualResources(jobId);
  const draft = await readJson<{narrationSegments?: Array<{id: string}>}>(path.join(jobDir(jobId), "draft.json"));
  if (!draft.narrationSegments?.some((segment) => segment.id === segmentId)) throw new Error("未找到目标口播段落");
  const current = (sceneId ? resources.resources.find((item) => item.sceneId === sceneId) : undefined)
    ?? resources.resources.find((item) => !item.sceneId && item.segmentId === segmentId)
    ?? {segmentId, ...(sceneId ? {sceneId} : {}), polygons: []};
  const next = visualResourceSchema.parse({...current, ...patch, segmentId, ...(sceneId ? {sceneId} : {})});
  const value = {...resources, revision: resources.revision + 1, resources: [...resources.resources.filter((item) => sceneId ? item.sceneId !== sceneId : !(item.segmentId === segmentId && !item.sceneId)), next]};
  await atomicWriteJson(visualResourcesPath(jobId), visualResourcesSchema.parse(value));
  // 规划页直接读取 visual-resources.json；资源修改不再隐式生成 manifest。
  return value;
};

export const saveVisualResourceImage = async (jobId: string, segmentId: string, file: File, sceneId?: string) => {
  const directory = jobDir(jobId);
  const extension = ({"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"} as Record<string, string>)[file.type];
  if (!extension || file.size <= 0 || file.size > 10 * 1024 * 1024) throw new Error("仅支持 10MB 以内的 PNG、JPEG 或 WebP 图片");
  const relativePath = `uploaded-images/${sceneId ?? segmentId}.${extension}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height) throw new Error("图片尺寸无效");
  await fs.mkdir(path.join(directory, "uploaded-images"), {recursive: true});
  await fs.writeFile(path.join(directory, relativePath), bytes);
  await saveVisualResource(jobId, segmentId, {imagePath: relativePath, imageWidth: metadata.width, imageHeight: metadata.height}, sceneId);
  return {imagePath: relativePath, imageWidth: metadata.width, imageHeight: metadata.height};
};

export const deleteVisualResourceImage = async (jobId: string, segmentId: string, sceneId?: string) => {
  const resources = await readVisualResources(jobId);
  const current = sceneId
    ? resources.resources.find((item) => item.sceneId === sceneId)
    : resources.resources.find((item) => !item.sceneId && item.segmentId === segmentId);
  const isSharedImage = current?.imagePath && resources.resources.some((item) => item !== current && item.imagePath === current.imagePath);
  if (current?.imagePath && !isSharedImage) await fs.unlink(path.join(jobDir(jobId), current.imagePath)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  const next = sceneId
    ? resources.resources.some((item) => item.sceneId === sceneId)
      ? resources.resources.map((item) => item.sceneId === sceneId ? {segmentId, sceneId, ...(item.modelPath ? {modelPath: item.modelPath} : {}), polygons: []} : item)
      : [...resources.resources, {segmentId, sceneId, polygons: []}]
    : resources.resources.map((item) => !item.sceneId && item.segmentId === segmentId ? {segmentId, polygons: []} : item);
  await atomicWriteJson(visualResourcesPath(jobId), visualResourcesSchema.parse({...resources, revision: resources.revision + 1, resources: next}));
};

// GLB 必须把几何、纹理等资源包在单个文件内，避免渲染器访问任意外部地址。
export const validateSelfContainedGlb = (bytes: Buffer) => {
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "glTF" || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error("仅支持完整的 GLB 2.0 文件");
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a || jsonLength <= 0 || jsonLength > 8 * 1024 * 1024 || 20 + jsonLength > bytes.length) throw new Error("GLB JSON 区块无效");
  let document: {buffers?: Array<{uri?: string; byteLength?: number}>; images?: Array<{uri?: string}>; meshes?: unknown[]; extensionsUsed?: string[]; extensionsRequired?: string[]};
  try { document = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength)); }
  catch { throw new Error("GLB JSON 无法解析"); }
  if (!document.meshes?.length) throw new Error("GLB 缺少可展示的网格");
  const binOffset = 20 + jsonLength;
  const embeddedBuffers = (document.buffers ?? []).filter((buffer) => !buffer.uri);
  if (embeddedBuffers.length > 1) throw new Error("GLB 内嵌二进制区块无效");
  if (embeddedBuffers.length) {
    if (binOffset + 8 > bytes.length || bytes.readUInt32LE(binOffset + 4) !== 0x004e4942) throw new Error("GLB 内嵌二进制区块无效");
    const binLength = bytes.readUInt32LE(binOffset);
    if (!Number.isInteger(embeddedBuffers[0]!.byteLength) || embeddedBuffers[0]!.byteLength! > binLength || binOffset + 8 + binLength > bytes.length) throw new Error("GLB 内嵌二进制区块无效");
  }
  const uris = [...(document.buffers ?? []), ...(document.images ?? [])].map((item) => item.uri).filter((uri): uri is string => Boolean(uri));
  if (uris.some((uri) => !uri.startsWith("data:"))) throw new Error("GLB 引用了外部文件，请导出为自包含 GLB");
  // Draco 由本地解码器处理，Meshopt 和 KTX2 尚未接入。
  if ([...(document.extensionsUsed ?? []), ...(document.extensionsRequired ?? [])].some((name) => ["EXT_meshopt_compression", "KHR_texture_basisu"].includes(name))) throw new Error("当前不支持 Meshopt 网格或 KTX2 纹理，请导出普通或 Draco 压缩 GLB");
};

export const saveVisualResourceModel = async (jobId: string, segmentId: string, sceneId: string, file: File) => {
  const job = await readJob(jobId);
  if (!["awaiting_visual_review", "ready", "completed", "failed"].includes(job.state)) throw new Error("当前任务状态不允许修改模型");
  if (!sceneId || !/^[-a-zA-Z0-9]+$/.test(sceneId)) throw new Error("镜头 ID 无效");
  if (!file.name.toLowerCase().endsWith(".glb") || file.size <= 0 || file.size > 50 * 1024 * 1024) throw new Error("仅支持 50MB 以内的 GLB 文件");
  const bytes = Buffer.from(await file.arrayBuffer());
  validateSelfContainedGlb(bytes);
  const previous = (await readVisualResources(jobId)).resources.find((item) => item.sceneId === sceneId)?.modelPath;
  const relativePath = `uploaded-models/${sceneId}-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.glb`;
  await fs.mkdir(path.join(jobDir(jobId), "uploaded-models"), {recursive: true});
  await fs.writeFile(path.join(jobDir(jobId), relativePath), bytes);
  try { await saveVisualResource(jobId, segmentId, {modelPath: relativePath}, sceneId); }
  catch (error) { if (previous !== relativePath) await fs.unlink(path.join(jobDir(jobId), relativePath)).catch(() => undefined); throw error; }
  await invalidateModelRender(jobId, job.state);
  {
    // 上传入口属于三维镜头；同时保存模板选择，轮询和刷新后也保持三维入口。
    // 模型替换后同步废弃持久化空间数据，刷新页面也不能继续使用旧锚点。
    const planPath = path.join(jobDir(jobId), "visual-plan.json");
    type StoredPlan = VisualPlan;
    let plan: StoredPlan | null = null;
    try {plan = await readJson<StoredPlan>(planPath);}
    catch (error) {if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;}
    if (plan?.scenes.some((scene) => scene.id === sceneId && (previous !== relativePath || scene.templateId !== "rve/3d-model-scene"))) {
      await atomicWriteJson(planPath, {...plan, planVersion: plan.planVersion + 1, scenes: plan.scenes.map((scene) => scene.id === sceneId ? {...scene, templateId: "rve/3d-model-scene", presenter: {...scene.presenter, rollType: "b-roll", mode: "hidden"}, modelScene: previous !== relativePath || !scene.modelScene ? resetModelPlan(scene, scene.modelScene) : scene.modelScene} : scene)});
    }
  }
  if (previous && previous !== relativePath) await fs.unlink(path.join(jobDir(jobId), previous)).catch(() => undefined);
  return {modelPath: relativePath};
};

export const deleteVisualResourceModel = async (jobId: string, segmentId: string, sceneId: string) => {
  const job = await readJob(jobId);
  if (!["awaiting_visual_review", "ready", "completed", "failed"].includes(job.state)) throw new Error("当前任务状态不允许修改模型");
  const previous = (await readVisualResources(jobId)).resources.find((item) => item.sceneId === sceneId)?.modelPath;
  await saveVisualResource(jobId, segmentId, {modelPath: undefined}, sceneId);
  if (previous) await fs.unlink(path.join(jobDir(jobId), previous)).catch(() => undefined);
  await invalidateModelRender(jobId, job.state);
};

const invalidateModelRender = async (jobId: string, state: string) => {
  await Promise.all([fs.rm(path.join(jobDir(jobId), "manifest.json"), {force: true}), fs.rm(path.join(jobDir(jobId), "output.mp4"), {force: true})]);
  if (state !== "awaiting_visual_review") await updateJobState(jobId, {state: "awaiting_visual_review", error: null});
};

// 拆分时仅复用预览资源，持久化时为新增镜头复制 GLB，替换/删除互不影响。
export const copySplitModelResources = async (jobId: string, scenes: Array<{id: string; segmentId: string; templateId: string}>, resources: VisualResources): Promise<VisualResources> => {
  let next = resources;
  for (const scene of scenes) {
    if (scene.templateId !== "rve/3d-model-scene" || next.resources.some((r) => r.sceneId === scene.id)) continue;
    const source = visualResourceForScene(next, scene.id, scene.segmentId);
    if (!source?.modelPath || !scene.id.endsWith("-split")) continue;
    if (!/^[-a-zA-Z0-9]+$/.test(scene.id) || !/^uploaded-models\/[-a-zA-Z0-9]+\.glb$/.test(source.modelPath)) throw new Error("拆分模型路径无效");
    const bytes = await fs.readFile(path.join(jobDir(jobId), source.modelPath));
    const modelPath = `uploaded-models/${scene.id}-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.glb`;
    await fs.copyFile(path.join(jobDir(jobId), source.modelPath), path.join(jobDir(jobId), modelPath));
    next = {...next, revision: next.revision + 1, resources: [...next.resources, {sceneId: scene.id, segmentId: scene.segmentId, modelPath, polygons: []}]};
  }
  if (next !== resources) await atomicWriteJson(visualResourcesPath(jobId), next);
  return next;
};
