import {promises as fs} from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {atomicWriteJson, jobDir} from "./jobs";
import {readVisualPlan, visualPlanSchema} from "./visual-plan";

const imageExtension = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"} as const;

export const saveCoverImage = async (jobId: string, file: File) => {
  const extension = imageExtension[file.type as keyof typeof imageExtension];
  if (!extension || file.size <= 0 || file.size > 10 * 1024 * 1024) throw new Error("仅支持 10MB 以内的 PNG、JPEG 或 WebP 图片");
  const bytes = Buffer.from(await file.arrayBuffer());
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height) throw new Error("图片尺寸无效");
  const relativePath = `uploaded-images/cover.${extension}`;
  const directory = jobDir(jobId);
  await fs.mkdir(path.join(directory, "uploaded-images"), {recursive: true});
  const existing = await readVisualPlan(jobId);
  if (existing.cover?.imagePath && existing.cover.imagePath !== relativePath) await fs.unlink(path.join(directory, existing.cover.imagePath)).catch(() => undefined);
  const next = visualPlanSchema.parse({
    ...existing,
    planVersion: existing.planVersion + 1,
    createdAt: new Date().toISOString(),
    cover: {...existing.cover!, imagePath: relativePath, imageWidth: metadata.width, imageHeight: metadata.height},
  });
  await fs.writeFile(path.join(directory, relativePath), bytes);
  await atomicWriteJson(path.join(directory, "visual-plan.json"), next);
  return {imagePath: relativePath, imageWidth: metadata.width, imageHeight: metadata.height, plan: next};
};

export const deleteCoverImage = async (jobId: string) => {
  const directory = jobDir(jobId);
  const plan = await readVisualPlan(jobId);
  if (plan.cover?.imagePath) await fs.unlink(path.join(directory, plan.cover.imagePath)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  const cover = {...plan.cover!};
  delete cover.imagePath;
  delete cover.imageWidth;
  delete cover.imageHeight;
  const next = visualPlanSchema.parse({...plan, planVersion: plan.planVersion + 1, createdAt: new Date().toISOString(), cover});
  await atomicWriteJson(path.join(directory, "visual-plan.json"), next);
  return {plan: next};
};
