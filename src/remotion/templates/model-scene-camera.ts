import type {Caption, VideoScene} from "../schema";
import {sceneFrameSpan} from "../timeline";
import {resolveRelationGraphCue} from "./relation-graph";
import type {CameraKeyframe, CameraState, ModelScenePlan} from "./model-scene-schema";

export const DEFAULT_CAMERA: CameraState = {position: {x: 0, y: 0.84, z: 4.2}, target: {x: 0, y: 0, z: 0}, fov: 40};
export const frameAtMs = (ms: number, fps: number) => Math.round(ms * fps / 1000);
export const msAtFrame = (frame: number, fps: number) => frame * 1000 / fps;
export const modelSceneFrameCount = (scene: Pick<VideoScene, "startMs" | "endMs">, fps: number) => sceneFrameSpan(scene, fps).durationInFrames;
export const modelSceneLastFrame = (scene: Pick<VideoScene, "startMs" | "endMs">, fps: number) => modelSceneFrameCount(scene, fps) - 1;
export const localModelFrame = (absoluteMs: number, scene: Pick<VideoScene, "startMs">, fps: number) => frameAtMs(absoluteMs, fps) - frameAtMs(scene.startMs, fps);
export type CameraTrack = {fps: number; keys: Array<CameraKeyframe & {frame: number; holdFrames: number}>};

// 绑定只在编译时解析；播放、跳帧与导出不依赖先前访问顺序。
export const resolveModelTime = (item: {timeMs: number; cueText?: string; cueOccurrence?: number; offsetMs?: number}, scene: Pick<VideoScene, "startMs" | "endMs" | "segmentId">, captions: Caption[]) => {
  if (!item.cueText?.trim()) return item.timeMs;
  const cue = resolveRelationGraphCue({scene: scene as VideoScene, captions, text: item.cueText, occurrence: item.cueOccurrence ?? 1});
  if (!cue) throw new Error(`口播绑定“${item.cueText}”未匹配到当前镜头`);
  return cue.startMs - scene.startMs + (item.offsetMs ?? 0);
};
export const sameCameraState = (a: CameraState, b: CameraState) => Math.abs(a.fov - b.fov) < 1e-9 && (["position", "target"] as const).every((field) => (["x", "y", "z"] as const).every((axis) => Math.abs(a[field][axis] - b[field][axis]) < 1e-9));
export const compileCameraTrack = (plan: ModelScenePlan, scene: Pick<VideoScene, "startMs" | "endMs" | "segmentId">, captions: Caption[], fps: number): CameraTrack => {
  if (plan.schemaVersion !== "2.0" || !Array.isArray(plan.keyframes)) throw new Error("仅支持相机关键帧编排，请重新创建 3D 镜头");
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("FPS 无效");
  const duration = modelSceneLastFrame(scene, fps);
  const keys = plan.keyframes.map((key) => ({...key, frame: key.cueText?.trim() ? localModelFrame(scene.startMs + resolveModelTime(key, scene, captions), scene, fps) : frameAtMs(key.timeMs, fps), holdFrames: frameAtMs(key.holdMs, fps)}));
  if (!keys.length) throw new Error("请至少记录一个相机关键帧");
  keys.forEach((key, index) => {
    if (!Number.isFinite(key.frame) || !Number.isFinite(key.holdFrames) || key.holdFrames < 0) throw new Error("关键帧时间无效");
    if (key.frame < 0 || key.frame > duration) throw new Error("相机关键帧超出镜头范围，请调整时间或口播绑定");
    if (key.boundary && (key.cueText?.trim() || key.frame !== (key.boundary === "start" ? 0 : duration) || (key.boundary === "end" && key.holdFrames !== 0))) throw new Error("首尾关键帧时间固定，结尾不能设置停留或口播绑定");
    const next = keys[index + 1];
    if (next && (next.frame <= key.frame || (key.frame + key.holdFrames > next.frame || (key.frame + key.holdFrames === next.frame && !sameCameraState(key, next))))) throw new Error("关键帧时间或停留区间冲突，请调整");
    if (key.frame + key.holdFrames > duration) throw new Error("停留时间超出镜头范围");
    if (![key.position.x, key.position.y, key.position.z, key.target.x, key.target.y, key.target.z, key.fov].every(Number.isFinite) || key.fov < 10 || key.fov > 100) throw new Error("相机参数无效");
    if (Math.hypot(key.position.x - key.target.x, key.position.y - key.target.y, key.position.z - key.target.z) < 0.01) throw new Error("相机位置不能与观察目标重合");
  });
  return {fps, keys};
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const point = (a: CameraState["position"], b: CameraState["position"], t: number) => ({x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), z: mix(a.z, b.z, t)});
export const easeCamera = (t: number, easing: CameraKeyframe["easing"]) => easing === "linear" ? t : easing === "ease-in" ? t * t : easing === "ease-out" ? 1 - (1 - t) ** 2 : t * t * (3 - 2 * t);
export const getCameraState = (frame: number, track: CameraTrack): CameraState => {
  const first = track.keys[0];
  if (!first) throw new Error("缺少相机关键帧");
  for (let i = 0; i < track.keys.length - 1; i++) {
    const a = track.keys[i]!;
    const b = track.keys[i + 1]!;
    if (frame >= b.frame) continue;
    const start = a.frame + a.holdFrames;
    const progress = Math.max(0, Math.min(1, (frame - start) / Math.max(1, b.frame - start)));
    const range = a.easingRange ?? {from: 0, to: 1};
    const lower = easeCamera(range.from, a.easing), upper = easeCamera(range.to, a.easing);
    const t = upper > lower ? (easeCamera(range.from + (range.to - range.from) * progress, a.easing) - lower) / (upper - lower) : progress;
    if (t <= 0) return {position: {...a.position}, target: {...a.target}, fov: a.fov};
    const target = point(a.target, b.target, t);
    // 围绕观察目标插值方位角和俯仰，避免对面视角直线穿过模型中心。
    const orbit = (key: CameraState) => {
      const x = key.position.x - key.target.x, y = key.position.y - key.target.y, z = key.position.z - key.target.z;
      const radius = Math.hypot(x, y, z);
      return {radius, azimuth: Math.atan2(x, z), polar: Math.acos(Math.max(-1, Math.min(1, y / radius)))};
    };
    const from = orbit(a), to = orbit(b);
    const turn = Math.atan2(Math.sin(to.azimuth - from.azimuth), Math.cos(to.azimuth - from.azimuth));
    const azimuth = from.azimuth + turn * t, polar = mix(from.polar, to.polar, t), radius = mix(from.radius, to.radius, t);
    return {position: {x: target.x + radius * Math.sin(polar) * Math.sin(azimuth), y: target.y + radius * Math.cos(polar), z: target.z + radius * Math.sin(polar) * Math.cos(azimuth)}, target, fov: mix(a.fov, b.fov, t)};
  }
  const last = track.keys.at(-1)!;
  return {position: {...last.position}, target: {...last.target}, fov: last.fov};
};
