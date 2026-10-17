import type {Caption, VideoScene} from "../schema";
import {compileCameraTrack, resolveModelTime, frameAtMs, msAtFrame} from "./model-scene-camera";
import {modelSceneDataSchema, type ModelSceneData} from "./model-scene-schema";

export type TimedModelAnnotation = ModelSceneData["annotations"][number] & {startMs: number; endMs: number};

// 编辑预览和导出只编译显式相机关键帧，口播绑定由最终字幕解析。
export const resolveModelSceneSchedule = (scene: VideoScene, captions: Caption[], value: unknown, fps = 30) => {
  const data = modelSceneDataSchema.parse(value);
  const track = compileCameraTrack(data, scene, captions, fps);
  const annotations: TimedModelAnnotation[] = data.annotations.map((annotation) => {
    const startMs = scene.startMs + resolveModelTime(annotation, scene, captions);
    const endMs = scene.startMs + annotation.endMs;
    if (startMs < scene.startMs || endMs > scene.endMs || endMs <= startMs) throw new Error("标注时间超出镜头范围或结束时间早于开始时间");
    const startFrame = frameAtMs(startMs, fps), endFrame = frameAtMs(endMs, fps);
    if (endFrame <= startFrame) throw new Error("标注显示区间至少需要一帧");
    return {...annotation, startMs: msAtFrame(startFrame, fps), endMs: msAtFrame(endFrame, fps)};
  });
  return {data, annotations, track};
};
