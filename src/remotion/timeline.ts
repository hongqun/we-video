import type {VideoScene} from "./schema";

export type SceneFrameSpan = {from: number; to: number; durationInFrames: number};

/** 所有边界只换算一次；相邻场景复用同一帧，末场强制覆盖到音频向上取整帧。 */
export const narrationSceneFrameSpans = (
  scenes: Array<Pick<VideoScene, "startMs" | "endMs">>,
  narrationDurationMs: number,
  fps: number,
): SceneFrameSpan[] => {
  const narrationFrames = Math.ceil(narrationDurationMs / 1000 * fps);
  const boundaries = scenes.map((scene, index) => index === 0 ? 0 : Math.round(scene.startMs / 1000 * fps));
  boundaries.push(narrationFrames);
  return scenes.map((_, index) => {
    const from = boundaries[index]!;
    const to = boundaries[index + 1]!;
    if (to <= from) throw new Error(`场景 ${index + 1} 换算后的帧区间无效`);
    return {from, to, durationInFrames: to - from};
  });
};

export const assertNarrationFrameCoverage = (spans: SceneFrameSpan[], narrationFrames: number) => {
  if (!spans.length || spans[0]!.from !== 0 || spans.at(-1)!.to !== narrationFrames) throw new Error("场景未覆盖完整口播帧区间");
  spans.forEach((span, index) => {
    if (span.durationInFrames !== span.to - span.from || span.durationInFrames <= 0) throw new Error(`场景 ${index + 1} 帧区间无效`);
    if (index > 0 && spans[index - 1]!.to !== span.from) throw new Error(`场景 ${index}/${index + 1} 帧边界不连续`);
  });
};
