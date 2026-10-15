import type {VideoScene} from "../schema";

export type TemplateSceneTiming = {
  durationFrames: number;
  safeEndFrame: number;
  entryFrames: number;
};

/** 模板内部动画限制在真实场景时镴内，并在场景交接前留出稳定帧。 */
export const sceneTiming = (scene: VideoScene, fps: number): TemplateSceneTiming => {
  const durationFrames = Math.max(1, Math.round(((scene.endMs - scene.startMs) / 1000) * fps));
  const safeFrames = Math.min(
    Math.max(6, Math.round(fps * 0.3)),
    Math.max(1, Math.floor(durationFrames * 0.2)),
  );
  const safeEndFrame = Math.max(1, durationFrames - safeFrames);
  const entryFrames = Math.max(1, Math.min(safeEndFrame, Math.max(6, Math.min(22, Math.floor(safeEndFrame * 0.45)))));
  return {durationFrames, safeEndFrame, entryFrames};
};

export const cappedAnimationEnd = (timing: TemplateSceneTiming, preferredEndFrame: number) =>
  Math.max(1, Math.min(timing.safeEndFrame, preferredEndFrame));
