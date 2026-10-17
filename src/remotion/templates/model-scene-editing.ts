import type {Caption, VideoScene} from "../schema";
import {modelScenePlanSchema, type CameraKeyframe, type CameraState, type ModelScenePlan} from "./model-scene-schema";
import {DEFAULT_CAMERA, compileCameraTrack, frameAtMs, getCameraState, msAtFrame, resolveModelTime, modelSceneLastFrame, localModelFrame} from "./model-scene-camera";

type SceneTiming = Pick<VideoScene, "startMs" | "endMs" | "segmentId">;
export const cameraKey = (state: CameraState, timeMs: number, id = `camera-${crypto.randomUUID()}`): CameraKeyframe => ({...structuredClone(state), id, timeMs, holdMs: 0, easing: "ease-in-out"});
// 新建与重置都显式生成首尾全景；一帧镜头共用同一个边界。
export const freshCameraPlan = (scene: SceneTiming, fps = 30): ModelScenePlan => {
  const last = modelSceneLastFrame(scene, fps);
  return {schemaVersion: "2.0", keyframes: [{...cameraKey(DEFAULT_CAMERA, 0), boundary: "start"}, ...(last > 0 ? [{...cameraKey(DEFAULT_CAMERA, msAtFrame(last, fps)), boundary: "end" as const}] : [])], annotations: []};
};
export const ensureCameraBoundaries = (input: ModelScenePlan, scene: SceneTiming, captions: Caption[], fps = 30): ModelScenePlan => {
  const plan = structuredClone(modelScenePlanSchema.parse(input));
  const last = modelSceneLastFrame(scene, fps);
  const resolved = plan.keyframes.map((key) => {
    // 无效绑定仍保留给编辑器报错修复，不覆盖用户的中间关键帧。
    let frame = frameAtMs(key.timeMs, fps);
    try {if (key.cueText?.trim()) frame = localModelFrame(scene.startMs + resolveModelTime(key, scene, captions), scene, fps);} catch { /* 编译阶段显示绑定错误。 */ }
    return {...key, frame, holdFrames: frameAtMs(key.holdMs, fps)};
  });
  const track = {fps, keys: resolved};
  const start = plan.keyframes.find((key) => key.boundary === "start") ?? plan.keyframes.find((_, i) => resolved[i]!.frame === 0);
  const end = plan.keyframes.find((key) => key.boundary === "end") ?? plan.keyframes.find((key, i) => key.id !== start?.id && resolved[i]!.frame === last);
  const startKey: CameraKeyframe = {...(start ?? cameraKey(getCameraState(0, track), 0)), boundary: "start", timeMs: 0, ...(last === 0 ? {holdMs: 0} : {}), cueText: undefined, cueOccurrence: undefined, offsetMs: undefined};
  const endKey: CameraKeyframe = {...(end ?? cameraKey(getCameraState(last, track), msAtFrame(last, fps))), boundary: "end", timeMs: msAtFrame(last, fps), holdMs: 0, cueText: undefined, cueOccurrence: undefined, offsetMs: undefined};
  const middle = plan.keyframes.filter((key) => key.id !== start?.id && key.id !== end?.id);
  return {...plan, keyframes: [startKey, ...middle, ...(last > 0 ? [endKey] : [])]};
};
// 替换模型清除空间坐标，保留文字、标签位置和样式供重新绑定。
export const resetModelPlan = (scene: SceneTiming, plan?: ModelScenePlan, fps = 30): ModelScenePlan => ({...freshCameraPlan(scene, fps), annotations: (plan?.annotations ?? []).map((a) => ({...a, anchor: undefined}))});
export const moveCameraKey = (key: CameraKeyframe, timeMs: number, scene: SceneTiming, captions: Caption[]): CameraKeyframe => {
  if (key.boundary) throw new Error("首尾关键帧时间固定，请调整中间关键帧");
  return {...key, timeMs, ...(key.cueText ? {offsetMs: (key.offsetMs ?? 0) + timeMs - resolveModelTime(key, scene, captions)} : {})};
};
export const splitModelPlan = (plan: ModelScenePlan, scene: SceneTiming, splitAtMs: number, captions: Caption[], fps: number): [ModelScenePlan, ModelScenePlan] => {
  const data = modelScenePlanSchema.parse(plan);
  const track = compileCameraTrack(data, scene, captions, fps);
  const cut = localModelFrame(splitAtMs, scene, fps);
  if (cut <= 0 || cut > modelSceneLastFrame(scene, fps)) throw new Error("拆分位置必须让两侧至少保留一帧");
  // 只补切点边界，保留原关键帧、口播绑定及被截断的缓动区间。
  const slice = (from: number, to: number, startMs: number, finishMs: number): ModelScenePlan => {
    const frames = [...new Set([from, ...track.keys.filter((k) => k.frame > from && k.frame < to).map((k) => k.frame), to])];
    const keys = frames.map((frame, index): CameraKeyframe => {
      const original = track.keys.find((k) => k.frame === frame);
      const key = original ? (() => {const {frame: _frame, holdFrames: _hold, ...saved} = original; void _frame; void _hold; return {...structuredClone(saved), timeMs: msAtFrame(frame - from, fps)};})() : cameraKey(getCameraState(frame, track), msAtFrame(frame - from, fps), `split-camera-${from}-${frame}`);
      key.boundary = index === 0 ? "start" : index === frames.length - 1 ? "end" : undefined;
      if (key.boundary) {key.cueText = undefined; key.cueOccurrence = undefined; key.offsetMs = undefined;}
      const nextFrame = frames[index + 1];
      const activeIndex = track.keys.reduce((found, k, i) => k.frame <= frame ? i : found, -1);
      const active = track.keys[activeIndex];
      const nextOriginal = track.keys[activeIndex + 1];
      key.holdMs = 0;
      if (active) key.holdMs = msAtFrame(Math.max(0, Math.min(nextFrame ?? to, active.frame + active.holdFrames) - frame), fps);
      if (nextFrame !== undefined && active && nextOriginal && nextFrame > active.frame + active.holdFrames) {
        const begin = active.frame + active.holdFrames;
        const span = Math.max(1, nextOriginal.frame - begin);
        const range = active.easingRange ?? {from: 0, to: 1};
        const phase = (f: number) => Math.max(0, Math.min(1, (f - begin) / span));
        const lower = range.from + (range.to - range.from) * phase(frame);
        const upper = range.from + (range.to - range.from) * phase(nextFrame);
        key.easing = active.easing;
        key.easingRange = upper > lower ? {from: lower, to: upper} : undefined;
      }
      return key;
    });
    return {schemaVersion: "2.0", keyframes: keys, annotations: data.annotations.flatMap((a) => {
      const begin = resolveModelTime(a, scene, captions);
      const finish = a.endMs;
      if (finish <= startMs || begin >= finishMs) return [];
      return [{...structuredClone(a), ...(begin < startMs ? {cueText: "", offsetMs: undefined} : {}), timeMs: Math.max(begin, startMs) - startMs, endMs: Math.min(finish, finishMs) - startMs}];
    })};
  };
  return [slice(0, cut - 1, 0, splitAtMs - scene.startMs), slice(cut, modelSceneLastFrame(scene, fps), splitAtMs - scene.startMs, scene.endMs - scene.startMs)];
};
