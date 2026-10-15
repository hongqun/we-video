import type {Caption, VideoScene} from "../schema";
import {visualImageDataSchema, visualImagePolygonSchema, type VisualImageData, type VisualImagePolygon} from "./visual-image-schema";

export {visualImageDataSchema, visualImagePolygonSchema};
export type {VisualImageData, VisualImagePolygon} from "./visual-image-schema";

export const VISUAL_IMAGE_REVEAL_RATIO = 0.65;
export const VISUAL_IMAGE_MAX_REVEAL_MS = 2_400;
export const VISUAL_IMAGE_MIN_STABLE_MS = 600;
export const VISUAL_IMAGE_MAX_STABLE_MS = 800;
export const VISUAL_IMAGE_MIN_BAND_HEIGHT_PX = 24;
export const VISUAL_IMAGE_MIN_BAND_DURATION_MS = 120;
export const VISUAL_IMAGE_MAX_SCAN_COUNT = 32;

export type VisualImageRevealSegment = {x: number; y: number; width: number; height: number; startMs: number; endMs: number; reverse: boolean};
export type VisualImageRevealCue = {polygon: VisualImagePolygon; polygonIndex: number; textStartMs: number; textEndMs: number; revealStartMs: number; revealEndMs: number; revealSegments: VisualImageRevealSegment[]};
export type VisualImageSchedule = {cues: VisualImageRevealCue[]; stableStartMs: number; stableWindowMs: number};

type Interval = {left: number; right: number};
const scanlineIntervals = (points: VisualImagePolygon["points"], y: number): Interval[] => {
  const intersections: number[] = [];
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]!;
    if ((point.y <= y && next.y > y) || (next.y <= y && point.y > y)) intersections.push(point.x + ((y - point.y) * (next.x - point.x)) / (next.y - point.y));
  });
  intersections.sort((a, b) => a - b);
  const intervals: Interval[] = [];
  for (let index = 0; index + 1 < intersections.length; index += 2) if (intersections[index]! < intersections[index + 1]!) intervals.push({left: intersections[index]!, right: intersections[index + 1]!});
  return intervals;
};

const subtractIntervals = (source: Interval[], covered: Interval[]) => source.flatMap((interval) => {
  let pieces = [interval];
  covered.forEach((item) => { pieces = pieces.flatMap((piece) => piece.right <= item.left || item.right <= piece.left ? [piece] : [{left: piece.left, right: Math.min(piece.right, item.left)}, {left: Math.max(piece.left, item.right), right: piece.right}].filter((part) => part.left < part.right)); });
  return pieces;
});

const buildRevealSegments = (intervals: Array<Interval & {y: number; height: number}>, startMs: number, endMs: number): VisualImageRevealSegment[] => {
  const usableDuration = Math.max(0, endMs - startMs);
  if (!intervals.length || usableDuration <= 0) return [];
  const gapMs = intervals.length > 1 ? Math.min(50, Math.floor(usableDuration / (intervals.length * 3))) : 0;
  const totalLength = intervals.reduce((sum, item) => sum + item.right - item.left, 0);
  let cursor = startMs;
  return intervals.map((item, index) => {
    const duration = index === intervals.length - 1 ? Math.max(1, endMs - cursor) : Math.max(1, Math.round((usableDuration - (intervals.length - 1) * gapMs) * (item.right - item.left) / totalLength));
    const segment = {x: item.left, y: item.y, width: item.right - item.left, height: item.height, startMs: cursor, endMs: Math.min(endMs, cursor + duration), reverse: index % 2 === 1};
    cursor = Math.min(endMs, segment.endMs + gapMs);
    return segment;
  });
};

const normalizeTimedText = (value: string) => [...value.normalize("NFKC")].filter((character) => !/\s/u.test(character)).join("");
const visualImageError = (scene: Pick<VideoScene, "id">, message: string): never => { throw new Error(`镜头 ${scene.id} 的视觉要求图片：${message}`); };

export const parseVisualImageData = (scene: Pick<VideoScene, "id">, value: unknown): VisualImageData => {
  const parsed = visualImageDataSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]; const location = issue?.path.length ? `（${issue.path.join(".")}）` : "";
    throw new Error(`镜头 ${scene.id} 的视觉要求图片：图片尺寸或多边形无效${location}${issue?.message ? `：${issue.message}` : ""}`);
  }
  return parsed.data;
};

/** 多边形只声明“画哪里”，时间从本场景字级字幕推导，并按动态数量生成水平扫描路径。 */
export const buildVisualImageSchedule = ({scene, captions, data}: {scene: Pick<VideoScene, "id" | "startMs" | "endMs" | "speechStartMs" | "speechEndMs">; captions: Caption[]; data: unknown}): VisualImageSchedule => {
  const parsed = parseVisualImageData(scene, data);
  const speechStartMs = scene.speechStartMs ?? scene.startMs; const speechEndMs = scene.speechEndMs ?? scene.endMs; const speechDurationMs = speechEndMs - speechStartMs;
  const stableWindowMs = Math.max(VISUAL_IMAGE_MIN_STABLE_MS, Math.min(VISUAL_IMAGE_MAX_STABLE_MS, Math.round(speechDurationMs * 0.05)));
  const stableStartMs = speechEndMs - stableWindowMs;
  // 按所属语音区间匹配，不能借用上一场景的文字掩盖字幕归属错误。
  const characters = captions.filter((caption) => caption.startMs >= speechStartMs && caption.endMs <= speechEndMs).flatMap((caption) => [...caption.text.normalize("NFKC")].filter((character) => !/\s/u.test(character)).map((character) => ({character, startMs: caption.startMs, endMs: caption.endMs})));
  const captionText = characters.map((item) => item.character).join("");
  if (!parsed.polygons.length) return {cues: [], stableStartMs, stableWindowMs};
  const history: VisualImagePolygon[] = [];
  const cues = parsed.polygons.map((polygon, polygonIndex): VisualImageRevealCue => {
    const needle = normalizeTimedText(polygon.text); const position = captionText.indexOf(needle);
    if (position < 0) visualImageError(scene, `多边形 ${polygonIndex + 1} 的文字无法匹配口播：“${polygon.text}”`);
    const first = characters[position]; const last = characters[position + needle.length - 1];
    if (!first || !last) visualImageError(scene, `多边形 ${polygonIndex + 1} 的文字时间戳不完整：“${polygon.text}”`);
    const revealDurationMs = Math.min(VISUAL_IMAGE_MAX_REVEAL_MS, Math.round((last.endMs - first.startMs) * VISUAL_IMAGE_REVEAL_RATIO));
    let revealEndMs = first.startMs + revealDurationMs;
    if (polygonIndex === parsed.polygons.length - 1 && revealEndMs > stableStartMs) revealEndMs = stableStartMs;
    if (revealEndMs <= first.startMs) visualImageError(scene, `多边形 ${polygonIndex + 1} 没有足够时间在稳定窗口前完成扫掠`);
    const minY = Math.min(...polygon.points.map((point) => point.y)); const maxY = Math.max(...polygon.points.map((point) => point.y));
    const heightPx = (maxY - minY) * parsed.imageHeight;
    // 时间优先限制扫描次数；最小带高决定高度侧的上限，避免小区域被过度切碎。
    const heightBasedCount = Math.ceil(heightPx / VISUAL_IMAGE_MIN_BAND_HEIGHT_PX);
    const timeBasedCount = Math.floor((revealEndMs - first.startMs) / VISUAL_IMAGE_MIN_BAND_DURATION_MS);
    const rowCount = Math.max(1, Math.min(VISUAL_IMAGE_MAX_SCAN_COUNT, heightBasedCount, timeBasedCount));
    const rowHeight = (maxY - minY) / rowCount;
    const intervals = Array.from({length: rowCount}, (_, row) => {
      const y = minY + rowHeight * row; const current = scanlineIntervals(polygon.points, y + rowHeight / 2); const covered = history.flatMap((item) => scanlineIntervals(item.points, y + rowHeight / 2));
      return subtractIntervals(current, covered).map((interval) => ({...interval, y, height: rowHeight}));
    }).flat();
    const revealSegments = buildRevealSegments(intervals, first.startMs, revealEndMs); history.push(polygon);
    return {polygon, polygonIndex, textStartMs: first.startMs, textEndMs: last.endMs, revealStartMs: first.startMs, revealEndMs, revealSegments};
  });
  const finalCue = cues.at(-1)!;
  if (finalCue.revealEndMs > stableStartMs) visualImageError(scene, "最后一个多边形无法在稳定窗口前完成扫掠");
  return {cues, stableStartMs, stableWindowMs};
};

export const visualImageProgressAt = (timeMs: number, cue: VisualImageRevealCue) => timeMs <= cue.revealStartMs ? 0 : timeMs >= cue.revealEndMs ? 1 : (timeMs - cue.revealStartMs) / (cue.revealEndMs - cue.revealStartMs);
