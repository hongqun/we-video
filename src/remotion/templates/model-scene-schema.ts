import {z} from "zod";

// 锚点使用归一化后的模型坐标；与原始 GLB 的单位和原点无关。
export const modelPointSchema = z.object({x: z.number().finite().min(-2).max(2), y: z.number().finite().min(-2).max(2), z: z.number().finite().min(-2).max(2)}).strict();
// 相机允许平移到模型包围盒以外，不能复用表面锚点的坐标限制。
const cameraPointSchema = z.object({x: z.number().finite(), y: z.number().finite(), z: z.number().finite()}).strict();
export const cameraStateSchema = z.object({position: cameraPointSchema, target: cameraPointSchema, fov: z.number().min(10).max(100)}).strict();
export const cameraKeyframeSchema = cameraStateSchema.extend({
  id: z.string().min(1), timeMs: z.number().finite().nonnegative(), holdMs: z.number().finite().nonnegative(),
  boundary: z.enum(["start", "end"]).optional(),
  easing: z.enum(["linear", "ease-in", "ease-out", "ease-in-out"]),
  // 拆分镜头保留原缓动曲线区间，切点两侧不重新启动缓动。
  easingRange: z.object({from: z.number().min(0).max(1), to: z.number().min(0).max(1)}).strict().refine((range) => range.to > range.from, "缓动区间无效").optional(),
  cueText: z.string().trim().optional(), cueOccurrence: z.number().int().min(1).max(20).optional(), offsetMs: z.number().finite().optional(),
}).strict();
export type CameraState = z.infer<typeof cameraStateSchema>;
export type CameraKeyframe = z.infer<typeof cameraKeyframeSchema>;
export const modelAnnotationSchema = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(1),
  cueText: z.string().trim(),
  timeMs: z.number().finite().nonnegative(),
  endMs: z.number().finite().nonnegative(),
  offsetMs: z.number().finite().optional(),
  cueOccurrence: z.number().int().min(1).max(20).optional(),
  anchor: modelPointSchema.optional(),
  labelOffset: z.object({x: z.number().finite().min(-1).max(1), y: z.number().finite().min(-1).max(1)}).strict().optional(),
  style: z.object({
    preset: z.enum(["tag", "callout", "bubble"]),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    fontSize: z.number().finite().min(16).max(48).optional(),
    showLine: z.boolean().optional(),
  }).strict().optional(),
}).strict();
// 仅接受相机关键帧结构；动作预设格式直接拒绝，不转换、不回退。
export const modelScenePlanSchema = z.object({
  schemaVersion: z.literal("2.0", {error: "仅支持相机关键帧编排，请重新创建 3D 镜头"}),
  keyframes: z.array(cameraKeyframeSchema).min(1).max(20000),
  annotations: z.array(modelAnnotationSchema).max(12),
}).strict().superRefine((plan, context) => {
  const ids = [...plan.annotations, ...plan.keyframes].map((item) => item.id);
  if (new Set(ids).size !== ids.length) context.addIssue({code: "custom", message: "关键帧和标注 ID 不能重复"});
});
export const modelSceneDataSchema = modelScenePlanSchema.safeExtend({modelPath: z.string().trim().min(1)}).strict().superRefine((data, context) => {
  if (data.annotations.some((annotation) => !annotation.anchor)) context.addIssue({code: "custom", path: ["annotations"], message: "所有标注都需要点选模型表面"});
});
export type ModelPoint = z.infer<typeof modelPointSchema>;
export type ModelScenePlan = z.infer<typeof modelScenePlanSchema>;
export type ModelSceneData = z.infer<typeof modelSceneDataSchema>;
