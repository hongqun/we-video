import {z} from "zod";
import type {Caption, VideoScene} from "../schema";
import {resolveNarrationCue} from "./narration-cue";
import {sceneFrameSpan} from "../timeline";

export const EXPLAINER_VERSION = "explainer-1";
// 只压缩绘制时间，不改口播；超过五倍仍应简化，避免笔画快到无法辨认。
export const EXPLAINER_MAX_SPEED = 5;
export const EXPLAINER_TIMING_VERSION = "fast-handwriting-2";
export const EXPLAINER_TEXT_SPEED = 4;
export const EXPLAINER_WIDTH = 960;
export const EXPLAINER_HEIGHT = 800;
const id = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const explainerBoxSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().positive().max(1), z.number().positive().max(1)]).refine(([x, y, w, h]) => x + w <= 1.001 && y + h <= 1.001, "区域超出画布");
const cue = {cueText: z.string().trim().min(1).max(200), occurrence: z.number().int().min(1).max(100).default(1)};
export const explainerDesignSchema = z.object({
  schemaVersion: z.literal("1.0"),
  illustrations: z.array(z.object({id, artworkId: id, box: explainerBoxSchema, parts: z.array(z.object({id, name: z.string().trim().min(1).max(60), box: explainerBoxSchema, ...cue}).strict()).min(1).max(12)}).strict()).min(1).max(4),
  labels: z.array(z.object({id, text: z.string().trim().min(1).max(60), box: explainerBoxSchema, fontSize: z.number().min(18).max(72), color: z.string().regex(/^#[a-fA-F0-9]{6}$/).default("#222222"), ...cue}).strict()).max(12),
}).strict().superRefine((design, context) => {
  const ids = [...design.illustrations.flatMap((item) => item.parts.map((part) => `${item.id}-${part.id}`)), ...design.labels.map((label) => label.id)];
  if (new Set(ids).size !== ids.length) context.addIssue({code: "custom", message: "绘制动作 ID 必须唯一"});
  if (new Set(design.illustrations.map((item) => item.id)).size !== design.illustrations.length) context.addIssue({code: "custom", message: "插画 ID 必须唯一"});
});
export type ExplainerDesign = z.infer<typeof explainerDesignSchema>;
export const explainerMotionSchema = z.object({durationMs: z.number().positive().max(600000), points: z.array(z.tuple([z.number().nonnegative(), z.number().finite(), z.number().finite(), z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(5)])])).min(2).max(500000)}).strict().superRefine((motion, context) => {
  if (motion.points.some((point, i) => point[0] > motion.durationMs || i > 0 && point[0] < motion.points[i - 1]![0])) context.addIssue({code: "custom", message: "画笔轨迹时间无效"});
});
export const EXPLAINER_LAYER_PATHS = ["linePath", "colorPath", "lineTimePath", "colorTimePath", "motionPath"] as const;
export const explainerLayerSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,96}$/), kind: z.enum(["illustration", "text"]), box: explainerBoxSchema,
  width: z.number().int().positive().max(1600), height: z.number().int().positive().max(1600),
  startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive(), durationMs: z.number().positive().max(600000),
  linePath: z.string().min(1), colorPath: z.string().min(1), lineTimePath: z.string().min(1), colorTimePath: z.string().min(1), motionPath: z.string().min(1),
  hashes: z.object({linePath: hash, colorPath: hash, lineTimePath: hash, colorTimePath: hash, motionPath: hash}).strict(),
}).strict();
export const explainerDataSchema = z.object({
  schemaVersion: z.literal("1.0"), compilerVersion: z.literal(EXPLAINER_VERSION), contextFingerprint: hash, cacheKey: hash,
  sceneId: z.string().regex(/^[a-zA-Z0-9-]+$/),
  sceneStartMs: z.number().int().nonnegative(), sceneEndMs: z.number().int().positive(),
  width: z.literal(EXPLAINER_WIDTH), height: z.literal(EXPLAINER_HEIGHT), fps: z.literal(30), durationInFrames: z.number().int().positive(),
  layers: z.array(explainerLayerSchema).min(1).max(60), completePath: z.string().min(1), completeHash: hash,
}).strict().superRefine((data, context) => {
  if (data.sceneEndMs <= data.sceneStartMs) context.addIssue({code: "custom", message: "镜头时间范围无效"});
  const ordered = [...data.layers].sort((a, b) => a.startFrame - b.startFrame);
  if (new Set(ordered.map((layer) => layer.id)).size !== ordered.length) context.addIssue({code: "custom", message: "图层 ID 重复"});
  let busy = 0;
  ordered.forEach((layer, index) => {
    busy += layer.endFrame - layer.startFrame;
    if (layer.endFrame <= layer.startFrame || layer.endFrame > data.durationInFrames - data.fps || index > 0 && layer.startFrame < ordered[index - 1]!.endFrame) context.addIssue({code: "custom", message: "绘制区间重叠或缺少成图阅读时间"});
    if (layer.endFrame - layer.startFrame < Math.ceil(layer.durationMs * data.fps / 1000 / EXPLAINER_MAX_SPEED)) context.addIssue({code: "custom", message: `绘制速度超过 ${EXPLAINER_MAX_SPEED} 倍上限`});
  });
  if (busy > data.durationInFrames * .7) context.addIssue({code: "custom", message: "绘制占用超过镜头七成"});
});
export type ExplainerData = z.infer<typeof explainerDataSchema>;
export type ExplainerMotion = z.infer<typeof explainerMotionSchema>;
export const explainerResourceSchema = z.object({status: z.enum(["idle", "running", "ready", "failed", "cancelled", "interrupted", "stale"]), progress: z.string(), error: z.string().optional()}).strict();

// 同一口播短语可承接多个动作；单笔串行执行，阅读窗口不能靠移动口播锚点挤出来。
export const explainerSchedule = (scene: Pick<VideoScene, "startMs" | "endMs" | "speechStartMs" | "speechEndMs">, captions: Caption[], design: ExplainerDesign, requirements: Record<string, number>) => {
  const span = sceneFrameSpan(scene, 30);
  const actions = [...design.illustrations.flatMap((item) => item.parts.map((part) => ({...part, id: `${item.id}-${part.id}`}))), ...design.labels];
  const bound = actions.map((action) => {
    const at = resolveNarrationCue({scene, captions, text: action.cueText, occurrence: action.occurrence});
    if (!at) throw new Error(`“${action.cueText}”第 ${action.occurrence} 次未匹配到本镜头口播`);
    const duration = requirements[action.id];
    if (!Number.isFinite(duration) || duration! <= 0) throw new Error(`动作 ${action.id} 缺少实际绘制成本`);
    return {id: action.id, start: Math.max(0, Math.round(at.startMs * .03) - span.from), frames: Math.ceil(duration! * .03), text: "text" in action};
  }).sort((a, b) => a.start - b.start);
  const result: Record<string, {startFrame: number; endFrame: number}> = {};
  for (let index = 0; index < bound.length;) {
    const first = bound[index]!;
    let end = index + 1;
    while (end < bound.length && bound[end]!.start === first.start) end++;
    const windowEnd = bound[end]?.start ?? span.durationInFrames;
    const available = windowEnd - first.start;
    const group = bound.slice(index, end);
    const needed = group.reduce((sum, action) => sum + action.frames, 0);
    const budget = Math.min(Math.floor(available * .7), available - 30);
    const minimum = group.map((action) => Math.ceil(action.frames / EXPLAINER_MAX_SPEED));
    const minimumTotal = minimum.reduce((sum, frames) => sum + frames, 0);
    if (budget < minimumTotal) throw new Error(`动作 ${first.id} 自然绘制需要 ${(needed / 30).toFixed(1)} 秒，口播窗口 ${(available / 30).toFixed(1)} 秒仅可绘制 ${(Math.max(0, budget) / 30).toFixed(1)} 秒；即使 ${EXPLAINER_MAX_SPEED} 倍速仍放不下，请减少笔画、文字或合并相邻讲解部位`);
    // 每个动作先保证五倍上限，再按路径成本分配余下帧；整数分配不侵占阅读帧。
    // 文字默认四倍快速书写；插画保持自然速度，窗口不足时才共同压缩。
    const preferred = group.map((action) => Math.ceil(action.frames / (action.text ? EXPLAINER_TEXT_SPEED : 1)));
    const preferredTotal = preferred.reduce((sum, frames) => sum + frames, 0);
    const target = Math.min(preferredTotal, budget);
    const spare = target - minimumTotal;
    const weight = preferredTotal - minimumTotal;
    let cursor = first.start, cumulative = 0, distributed = 0;
    for (const [i, action] of group.entries()) {
      cumulative += preferred[i]! - minimum[i]!;
      const share = weight > 0 ? Math.floor(cumulative * spare / weight) : 0;
      const frames = minimum[i]! + share - distributed;
      result[action.id] = {startFrame: cursor, endFrame: cursor + frames};
      cursor += frames; distributed = share;
    }
    index = end;
  }
  return result;
};

// 出墨时间图和笔尖共用源时间；任意帧重建时不依赖播放速度或上一帧状态。
export const explainerSourceTimeAt = (layer: {startFrame: number; endFrame: number; durationMs: number}, frame: number) => {
  if (frame < layer.startFrame) return -1;
  if (frame >= layer.endFrame) return layer.durationMs + 20;
  return (frame - layer.startFrame) / (layer.endFrame - layer.startFrame) * layer.durationMs;
};

// 二分查询只依赖当前时间；倒放和跳帧不会继承上一帧的画笔状态。
export const explainerPenAt = (motion: ExplainerMotion, time: number) => {
  if (time < 0 || time >= motion.durationMs) return null;
  let low = 0, high = motion.points.length - 1;
  while (low < high) {const mid = Math.ceil((low + high) / 2); if (motion.points[mid]![0] <= time) low = mid; else high = mid - 1;}
  const left = motion.points[low]!, right = motion.points[Math.min(low + 1, motion.points.length - 1)]!;
  const t = Math.max(0, Math.min(1, (time - left[0]) / Math.max(.001, right[0] - left[0])));
  return {x: left[1] + (right[1] - left[1]) * t, y: left[2] + (right[2] - left[2]) * t, lifted: left[3] === 0, phase: left[3]};
};

export const assertExplainerFrames = (scene: Pick<VideoScene, "startMs" | "endMs">, raw: unknown) => {
  const data = explainerDataSchema.parse(raw);
  const span = sceneFrameSpan(scene, data.fps);
  // 全片最后一镜按音频向上取整，可能比普通边界多一帧；具体帧数在服务端按全时间轴复核。
  const finalFrames = Math.ceil(scene.endMs * data.fps / 1000) - span.from;
  if (scene.startMs !== data.sceneStartMs || scene.endMs !== data.sceneEndMs || data.durationInFrames !== span.durationInFrames && data.durationInFrames !== finalFrames) throw new Error("镜头范围已变化，请重新制作手绘讲解");
  return data;
};

export const resolveExplainerPaths = (data: ExplainerData, resolve: (relative: string) => string): ExplainerData => ({...data, completePath: resolve(data.completePath), layers: data.layers.map((layer) => ({...layer, ...Object.fromEntries(EXPLAINER_LAYER_PATHS.map((key) => [key, resolve(layer[key])]))}))});
