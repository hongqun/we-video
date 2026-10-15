import {promises as fs} from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {z} from "zod";
import {atomicWriteJson, jobDir, readJson} from "./jobs";
import {visualImagePolygonSchema} from "@/remotion/templates/visual-image-schema";

// 第四步视觉资源是独立事实源；新资源按 sceneId 隔离，segmentId 只保留父口播段兼容关系。
export const visualResourceSchema = z.object({
  segmentId: z.string().trim().min(1),
  sceneId: z.string().trim().min(1).optional(),
  imagePath: z.string().trim().min(1).optional(),
  imageWidth: z.number().int().positive().optional(),
  imageHeight: z.number().int().positive().optional(),
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
      ? resources.resources.map((item) => item.sceneId === sceneId ? {segmentId, sceneId, polygons: []} : item)
      : [...resources.resources, {segmentId, sceneId, polygons: []}]
    : resources.resources.map((item) => !item.sceneId && item.segmentId === segmentId ? {segmentId, polygons: []} : item);
  await atomicWriteJson(visualResourcesPath(jobId), visualResourcesSchema.parse({...resources, revision: resources.revision + 1, resources: next}));
};
