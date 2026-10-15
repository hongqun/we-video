import type {CSSProperties, ReactNode} from "react";
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from "remotion";
import type {VideoScene} from "../schema";

// 按 kind 计算入场转场 style（progress 0→1；全部为每帧数值，无 CSS animation，保证渲染纯函数）。
const entryStyle = (kind: string, progress: number): CSSProperties => {
  switch (kind) {
    case "none":
      return {opacity: 1};
    case "slide-left":
      return {opacity: progress, translate: `${(1 - progress) * 160}px 0px`};
    case "slide-up":
      return {opacity: progress, translate: `0px ${(1 - progress) * 120}px`};
    case "zoom-in":
      return {opacity: progress, scale: 1 + (1 - progress) * 0.08};
    case "wipe-right":
      return {clipPath: `inset(0px 0px 0px ${(1 - progress) * 100}%)`};
    default:
      return {opacity: progress};
  }
};

// 出场转场 style（progress 1→0）；none 保持原样，表示硬切。
const exitStyle = (kind: string, progress: number): CSSProperties => {
  switch (kind) {
    case "none":
      return {opacity: 1};
    case "slide-left":
      return {opacity: progress, translate: `${(progress - 1) * 160}px 0px`};
    case "slide-up":
      return {opacity: progress, translate: `0px ${(progress - 1) * 120}px`};
    case "zoom-in":
      return {opacity: progress, scale: 1 - (1 - progress) * 0.06};
    case "wipe-right":
      return {opacity: 0.4 + 0.6 * progress};
    default:
      return {opacity: progress};
  }
};

export const SceneTransition: React.FC<{
  scene: VideoScene;
  previousScene?: VideoScene;
  durationInFrames: number;
  exitOverlapFrames?: number;
  children: ReactNode;
}> = ({scene, previousScene, durationInFrames, exitOverlapFrames = 0, children}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const entryFrames = sceneEntryTransitionFrames(scene, previousScene, fps, durationInFrames);
  // scene N 的 transition 描述 N→N+1 边界：入场侧读上一场的 kind、出场侧读本场 kind，两侧保持同一转场。
  const entryKind = previousScene?.transition?.kind ?? "fade";
  const exitKind = scene.transition?.kind ?? "fade";

  return (
    <AbsoluteFill
      style={entryFrames > 0
        ? entryStyle(entryKind, sceneCrossfadeWeights(frame, entryFrames).incoming)
        : undefined}
    >
      <AbsoluteFill
        style={exitOverlapFrames > 0
          ? exitStyle(exitKind, sceneCrossfadeWeights(frame - durationInFrames, exitOverlapFrames).outgoing)
          : undefined}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** 同一切点的前后层权重严格互补，任一重叠帧都不会同时透明。 */
export const sceneCrossfadeWeights = (overlapFrame: number, overlapFrames: number) => {
  // 1 帧窗口也要区分“进入重叠前”和“交接帧”，否则旧场在整段时间内都会被算成全透明。
  if (overlapFrames <= 1) {
    return overlapFrame < 0
      ? {outgoing: 1, incoming: 0}
      : {outgoing: 0, incoming: 1};
  }
  const incoming = Math.max(0, Math.min(1, overlapFrame / (overlapFrames - 1)));
  return {outgoing: 1 - incoming, incoming};
};

// 转场在下一场的口播前窗口内交叉叠加；无停顿时保留 4 帧快速交接，避免两场各自消失造成空帧。
export const sceneEntryTransitionFrames = (
  scene: VideoScene,
  previousScene: VideoScene | undefined,
  fps: number,
  durationInFrames: number,
) => {
  if (!previousScene || previousScene.transition?.kind === "none") return 0;
  const transitionMs = previousScene.transition?.durationMs ?? scene.transition?.durationMs ?? 0;
  if (transitionMs <= 0) return 0;
  const entryAvailableMs = scene.speechStartMs !== undefined ? Math.max(0, scene.speechStartMs - scene.startMs) : 0;
  const frames = Math.round((Math.min(transitionMs / 2, entryAvailableMs) / 1000) * fps);
  const minimumFrames = 4;
  return frames || (durationInFrames > minimumFrames * 2 ? minimumFrames : 0);
};
