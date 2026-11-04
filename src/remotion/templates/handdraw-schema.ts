import {z} from "zod";

// 算法版本参与缓存键，预览与导出只消费相同版本的不可变产物。
export const HANDDRAW_VERSION = "handdraw-4";
// 老任务仍能播放，修复白边与渐变分区后的新产物使用独立缓存键。
const handdrawVersionSchema = z.enum(["handdraw-1", "handdraw-2", "handdraw-3", HANDDRAW_VERSION]);
const fileSchema = z.object({path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), width: z.number().int().positive(), height: z.number().int().positive()}).strict();
export const handdrawDataSchema = z.object({
  algorithmVersion: handdrawVersionSchema, cacheKey: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive().max(1600), height: z.number().int().positive().max(1600),
  minimumDrawMs: z.number().int().positive().max(600000),
  // 缓存保留参考绘制时长；抬笔统计让播放时可以先压缩空程，再加速出墨。
  motionTiming: z.object({liftMs: z.number().finite().nonnegative().max(600000)}).strict().optional(),
  completePath: z.string().min(1), lineLayerPath: z.string().min(1), colorLayerPath: z.string().min(1),
  lineTimePath: z.string().min(1), colorTimePath: z.string().min(1), motionPath: z.string().min(1),
  hashes: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
}).strict();
export const HANDDRAW_PATH_FIELDS = ["completePath", "lineLayerPath", "colorLayerPath", "lineTimePath", "colorTimePath", "motionPath"] as const;
export const handdrawResourceSchema = z.object({
  lineart: fileSchema.optional(), color: fileSchema.optional(),
  status: z.enum(["waiting", "processing", "ready", "failed"]),
  requestId: z.string().optional(), startedAt: z.string().optional(), error: z.string().optional(),
  data: handdrawDataSchema.optional(),
}).strict();
export type HanddrawResource = z.infer<typeof handdrawResourceSchema>;
export type HanddrawData = z.infer<typeof handdrawDataSchema>;
// PNG 的 RGB 通道存储毫秒整数，alpha=0 表示永不显现；禁止有损编码或色彩变换。
export const handdrawMotionSchema = z.object({
  algorithmVersion: handdrawVersionSchema, cacheKey: z.string(), width: z.number().int().positive(), height: z.number().int().positive(), minimumDrawMs: z.number().int().positive(),
  points: z.array(z.tuple([z.number().nonnegative(), z.number().finite(), z.number().finite(), z.union([z.literal(0), z.literal(1), z.literal(2)])])).min(2),
}).strict();
export type HanddrawMotion = z.infer<typeof handdrawMotionSchema>;

export const handdrawTemplateData = (resource: HanddrawResource | undefined, resolve: (path: string) => string): HanddrawData | undefined => {
  if (resource?.status !== "ready" || !resource.data) return undefined;
  const data = handdrawDataSchema.parse(resource.data);
  return {...data, ...Object.fromEntries(HANDDRAW_PATH_FIELDS.map((key) => [key, resolve(data[key])]))};
};

export type HanddrawSceneWindow = {startMs: number; endMs: number; transition?: {durationMs: number}};
// 用户允许手绘镜头最高额外十倍加速，预算与预览共用此上限。
export const HANDDRAW_MAX_ACCELERATION = 10;
export const handdrawWindow = (scene: HanddrawSceneWindow) => {
  const duration = scene.endMs - scene.startMs;
  // 两端避开转场，成图展示至少占可用窗口三成，且不少于一秒。
  const inset = Math.min(300, scene.transition?.durationMs ?? 0);
  const available = duration - inset * 2;
  return {duration, inset, available, budget: Math.max(0, Math.min(available * .7, available - 1000))};
};

export const handdrawPromptBudget = (scene: HanddrawSceneWindow) => {
  const window = handdrawWindow(scene);
  const seconds = window.budget / 1000;
  // 生成目标按自然速度留余量，不把最高加速额度预先消耗在生图复杂度上。
  return {
    sceneSeconds: window.duration / 1000, drawSeconds: seconds,
    holdSeconds: Math.max(0, window.available - window.budget) / 1000,
    maxStrokes: Math.max(4, Math.min(120, Math.floor(seconds * 1.8))),
    maxSubjects: seconds < 30 ? 1 : 2,
    maxProps: seconds < 15 ? 1 : 2,
    maxColors: seconds < 15 ? 3 : seconds < 30 ? 4 : 5,
    maxRegions: seconds < 15 ? 6 : seconds < 30 ? 10 : 16,
  };
};

export const handdrawTiming = (scene: HanddrawSceneWindow, data: HanddrawData) => {
  const {duration, inset, available, budget} = handdrawWindow(scene);
  const acceleration = data.minimumDrawMs / Math.max(1, budget);
  if (budget <= 0 || acceleration > HANDDRAW_MAX_ACCELERATION) {
    const fastest = data.minimumDrawMs / HANDDRAW_MAX_ACCELERATION;
    const required = Math.ceil(Math.max(fastest / .7, fastest + 1000) + inset * 2);
    throw new Error(`手绘镜头当前 ${(duration / 1000).toFixed(1)} 秒，需要约 ${acceleration.toFixed(1)} 倍加速，超过 ${HANDDRAW_MAX_ACCELERATION} 倍上限；至少需要 ${(required / 1000).toFixed(1)} 秒。请只保留一个主体和必要道具，减少细线、色块与渐变后重新生成`);
  }
  const drawDurationMs = Math.min(data.minimumDrawMs, budget);
  const liftMs = Math.min(data.minimumDrawMs, data.motionTiming?.liftMs ?? 0);
  // 优先缩短停顿与抬笔，最多缩到原来的 35%；仍放不下时才统一加速笔画。
  const liftScale = liftMs > 0 ? Math.max(.35, 1 - (data.minimumDrawMs - drawDurationMs) / liftMs) : 1;
  const speed = (data.minimumDrawMs - liftMs * (1 - liftScale)) / drawDurationMs;
  return {drawStartMs: inset, drawEndMs: inset + drawDurationMs, drawDurationMs, holdMs: available - drawDurationMs, acceleration: data.minimumDrawMs / drawDurationMs, liftScale, speed};
};

export const handdrawLiftMs = (motion: HanddrawMotion) => {
  let lift = motion.points[0]![0];
  for (let i = 0; i + 1 < motion.points.length; i++) if (motion.points[i]![3] === 0) lift += motion.points[i + 1]![0] - motion.points[i]![0];
  if (motion.points.at(-1)![3] === 0) lift += motion.minimumDrawMs - motion.points.at(-1)![0];
  return lift;
};

export type HanddrawPlaybackTrack = Array<{sourceMs: number; playbackMs: number}>;
export const handdrawPlaybackTrack = (motion: HanddrawMotion, timing: Pick<ReturnType<typeof handdrawTiming>, "liftScale" | "speed">): HanddrawPlaybackTrack => {
  const track: HanddrawPlaybackTrack = [{sourceMs: 0, playbackMs: 0}];
  let source = 0; let playback = 0; let phase = 0;
  for (const [time, , , nextPhase] of motion.points) {
    playback += (time - source) * (phase === 0 ? timing.liftScale : 1) / timing.speed;
    track.push({sourceMs: time, playbackMs: playback}); source = time; phase = nextPhase;
  }
  playback += (motion.minimumDrawMs - source) * (phase === 0 ? timing.liftScale : 1) / timing.speed;
  track.push({sourceMs: motion.minimumDrawMs, playbackMs: playback});
  return track;
};

// 墨线时间图、上色时间图和画笔共用这一个时间映射，拖动进度仍逐帧确定。
export const handdrawSourceTimeAt = (track: HanddrawPlaybackTrack, playbackMs: number) => {
  if (playbackMs < 0) return -1;
  if (playbackMs >= track.at(-1)!.playbackMs) return track.at(-1)!.sourceMs;
  let lo = 0; let hi = track.length - 1;
  while (lo + 1 < hi) {const mid = (lo + hi) >> 1; if (track[mid]!.playbackMs <= playbackMs) lo = mid; else hi = mid;}
  const a = track[lo]!; const b = track[hi]!;
  const ratio = Math.min(1, Math.max(0, (playbackMs - a.playbackMs) / Math.max(.000001, b.playbackMs - a.playbackMs)));
  return a.sourceMs + (b.sourceMs - a.sourceMs) * ratio;
};

export const handdrawPenAt = (motion: HanddrawMotion, time: number) => {
  const points = motion.points;
  if (time < points[0]![0] || time >= motion.minimumDrawMs) return null;
  let lo = 0; let hi = points.length - 1;
  while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (points[mid]![0] <= time) lo = mid; else hi = mid; }
  const a = points[lo]!; const b = points[hi]!;
  const t = Math.max(0, Math.min(1, (time - a[0]) / Math.max(1, b[0] - a[0])));
  return {x: a[1] + (b[1] - a[1]) * t, y: a[2] + (b[2] - a[2]) * t, lifted: a[3] === 0};
};
