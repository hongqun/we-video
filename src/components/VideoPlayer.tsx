"use client";

import {Player} from "@remotion/player";
import type {PlayerRef} from "@remotion/player";
import {memo, useEffect, useRef, type RefObject} from "react";
import type {ArtifactManifest} from "@/remotion/schema";
import {ShortVideo} from "@/remotion/ShortVideo";
import {MathVideo} from "@/remotion/MathVideo";
import {mathDurationInFrames} from "@/remotion/math-timing";

type VideoPlayerProps = {
  manifest: ArtifactManifest;
  playerRef?: RefObject<PlayerRef | null>;
  onFrameChange?: (frame: number) => void;
  onSeek?: () => void;
  onPlaybackStateChange?: (playing: boolean) => void;
};

export const VideoPlayer = memo(function VideoPlayer({manifest, playerRef, onFrameChange, onSeek, onPlaybackStateChange}: VideoPlayerProps) {
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

  if (manifest.contentMode === "math") {
    const durationInFrames = mathDurationInFrames(manifest.formula.plot.drawDurationMs, manifest.video.outroDurationMs, manifest.video.fps);
    return <Player
      ref={ref}
      className="math-player"
      component={MathVideo}
      inputProps={manifest}
      durationInFrames={durationInFrames}
      compositionWidth={manifest.video.width}
      compositionHeight={manifest.video.height}
      fps={manifest.video.fps}
      controls
      showVolumeControls={false}
      initialVolume={1}
      style={{aspectRatio: `${manifest.video.width} / ${manifest.video.height}`, maxHeight: 720, width: "100%"}}
    />;
  }
  const durationInFrames = Math.ceil(
    ((manifest.narration.durationMs + manifest.video.outroDurationMs) / 1000) * manifest.video.fps,
  );
  return (
    <Player
      ref={ref}
      component={ShortVideo}
      inputProps={manifest}
      durationInFrames={durationInFrames}
      compositionWidth={1080}
      compositionHeight={1260}
      fps={30}
      controls
      showVolumeControls={false}
      initialVolume={1}
      style={{height: "100%", maxHeight: "none", width: "100%"}}
    />
  );
});
