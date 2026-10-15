"use client";

import {AbsoluteFill, Sequence} from "remotion";
import {Player, type PlayerRef} from "@remotion/player";
import {useEffect, useRef, type RefObject} from "react";
import type {VideoScene} from "@/remotion/schema";
import {BackgroundTrack} from "@/remotion/BackgroundTrack";
import {SceneContent} from "@/remotion/scenes/SceneContent";

type DraftSceneInput = Omit<VideoScene, "startMs" | "endMs" | "speechStartMs" | "speechEndMs" | "pauseAfterMs" | "transition">;

type DraftScenesPreviewProps = {
  scenes: DraftSceneInput[];
  playerRef?: RefObject<PlayerRef | null>;
  onFrameChange?: (frame: number) => void;
  onSeek?: () => void;
  onPlaybackStateChange?: (playing: boolean) => void;
};

const SCENE_DURATION_FRAMES = 240;
const SCENE_DURATION_MS = 8_000;
const PREVIEW_TRANSITION = {kind: "fade" as const, durationMs: 315};

const PreviewComposition: React.FC<{scenes: VideoScene[]}> = ({scenes}) => (
  <AbsoluteFill>
    {/* 单镜预览也使用成片的漫画纸面。 */}
    <BackgroundTrack />
    {scenes.map((scene, index) => {
      return (
        <Sequence key={`${scene.id}-${index}`} from={index * SCENE_DURATION_FRAMES} durationInFrames={SCENE_DURATION_FRAMES} name={scene.id}>
          <SceneContent scene={scene} durationInFrames={SCENE_DURATION_FRAMES} />
        </Sequence>
      );
    })}
  </AbsoluteFill>
);

export const DraftScenesPreview: React.FC<DraftScenesPreviewProps> = ({scenes, playerRef, onFrameChange, onSeek, onPlaybackStateChange}) => {
  const internalRef = useRef<PlayerRef>(null);
  const ref = playerRef ?? internalRef;
  useEffect(() => {
    const player = ref.current;
    if (!player) return;
    const handleTimeUpdate = (event: {detail: {frame: number}}) => onFrameChange?.(event.detail.frame);
    const handleSeek = () => onSeek?.();
    const handlePlay = () => onPlaybackStateChange?.(true);
    const handlePause = () => onPlaybackStateChange?.(false);
    if (onFrameChange) player.addEventListener("timeupdate", handleTimeUpdate);
    if (onSeek) player.addEventListener("seeked", handleSeek);
    if (onPlaybackStateChange) {
      player.addEventListener("play", handlePlay);
      player.addEventListener("pause", handlePause);
      player.addEventListener("ended", handlePause);
    }
    return () => {
      if (onFrameChange) player.removeEventListener("timeupdate", handleTimeUpdate);
      if (onSeek) player.removeEventListener("seeked", handleSeek);
      if (onPlaybackStateChange) {
        player.removeEventListener("play", handlePlay);
        player.removeEventListener("pause", handlePause);
        player.removeEventListener("ended", handlePause);
      }
    };
  }, [onFrameChange, onPlaybackStateChange, onSeek, ref]);

  // 草稿预览仍使用临时完整时长，不参与第四步视觉时间轴保存。
  const previewScenes: VideoScene[] = scenes.map((scene, index): VideoScene => ({
    ...scene,
    id: `all-scenes-${scene.id}`,
    startMs: index * SCENE_DURATION_MS,
    endMs: (index + 1) * SCENE_DURATION_MS,
    speechStartMs: undefined,
    speechEndMs: undefined,
    pauseAfterMs: undefined,
    // This is manifest data, not a CSS transition.
    // eslint-disable-next-line @remotion/non-pure-animation
    transition: PREVIEW_TRANSITION,
  }));

  if (!previewScenes.length) return <div className="template-preview-empty">当前没有可预览的场景</div>;

  return (
    <Player
      ref={ref}
      key={previewScenes.map((scene) => `${scene.id}-${scene.templateId}`).join("|")}
      component={PreviewComposition}
      inputProps={{scenes: previewScenes}}
      durationInFrames={previewScenes.length * SCENE_DURATION_FRAMES}
      compositionWidth={1080}
      compositionHeight={1260}
      fps={30}
      controls
      showVolumeControls={false}
      initialVolume={1}
      style={{height: "100%", width: "100%"}}
    />
  );
};
