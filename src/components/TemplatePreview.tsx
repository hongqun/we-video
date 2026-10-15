"use client";

import {useEffect, useRef} from "react";
import {AbsoluteFill} from "remotion";
import {Player, type PlayerRef} from "@remotion/player";
import type {Caption, RenderManifest, VideoScene} from "@/remotion/schema";
import {BackgroundTrack} from "@/remotion/BackgroundTrack";
import {SceneContent} from "@/remotion/scenes/SceneContent";
import {PresenterTrack} from "@/remotion/PresenterTrack";
import {Captions} from "@/remotion/Captions";
import {BrandProvider} from "@/remotion/BrandContext";
import {Fonts} from "@/remotion/Fonts";
import {VisualThemeProvider} from "@/remotion/theme";
import type {VisualStyleId} from "@/remotion/visual-style";

const PREVIEW_TRANSITION = {kind: "fade" as const, durationMs: 315};
// 品牌数据与主 Player 同源，不让单镜预览退回硬编码文案。
const PreviewComposition: React.FC<{scene: VideoScene; captions: Caption[]; durationMs: number; brand: RenderManifest["brand"]; presenter: NonNullable<RenderManifest["presenter"]>; visualStyle?: VisualStyleId}> = ({scene, captions, durationMs, presenter, brand, visualStyle}) => <BrandProvider value={brand}><VisualThemeProvider styleId={visualStyle}><AbsoluteFill>
    {/* 单镜预览与成片使用同一个全片主题背景。 */}
    <BackgroundTrack />
  <Fonts loadHandwriting={scene.templateId === "rve/text-reveal"}>
    <SceneContent scene={scene} durationInFrames={Math.max(1, Math.ceil(durationMs / 1000 * 30))} captions={captions} />
    <PresenterTrack scenes={[scene]} presenter={presenter} />
  </Fonts>
  <Captions captions={captions} narrationDurationMs={durationMs} scenes={[scene]} />
</AbsoluteFill></VisualThemeProvider></BrandProvider>;

export const TemplatePreview: React.FC<{scene: VideoScene; brand: RenderManifest["brand"]; presenter: NonNullable<RenderManifest["presenter"]>; visualStyle?: VisualStyleId; playing?: boolean; audioRef?: React.RefObject<HTMLAudioElement | null>; playerRef?: React.RefObject<PlayerRef | null>; sceneStartMs?: number; sceneEndMs?: number; captions?: Caption[]}> = ({scene, presenter, brand, visualStyle, playing = false, audioRef, playerRef: controlledPlayerRef, sceneStartMs = 0, sceneEndMs = sceneStartMs + 8000, captions = []}) => {
  const localPlayerRef = useRef<PlayerRef>(null);
  const playerRef = controlledPlayerRef ?? localPlayerRef;
  const durationMs = Math.max(1000, sceneEndMs - sceneStartMs);
  const durationInFrames = Math.max(1, Math.ceil(durationMs / 1000 * 30));
  const previewCaptions = captions.filter((caption) => caption.endMs > sceneStartMs && caption.startMs < sceneEndMs).map((caption) => ({...caption, startMs: Math.max(0, caption.startMs - sceneStartMs), endMs: Math.min(durationMs, caption.endMs - sceneStartMs), timestampMs: caption.timestampMs === null ? null : Math.max(0, caption.timestampMs - sceneStartMs)})).filter((caption) => caption.endMs > caption.startMs);
  const previewScene: VideoScene = {...scene, id: `template-preview-${scene.templateId}`, startMs: 0, endMs: durationMs, speechStartMs: previewCaptions[0]?.startMs, speechEndMs: previewCaptions.at(-1)?.endMs, pauseAfterMs: undefined, transition: PREVIEW_TRANSITION};

  useEffect(() => {
    const handle = requestAnimationFrame(() => {
      const player = playerRef.current;
      if (!player) return;
      const relativeFrame = Math.ceil((((audioRef?.current?.currentTime ?? 0) * 1000 - sceneStartMs) / 1000) * 30);
      player.seekTo(Math.max(0, Math.min(durationInFrames - 1, relativeFrame)));
      if (playing) void player.play(); else player.pause();
    });
    return () => cancelAnimationFrame(handle);
  }, [audioRef, durationInFrames, playerRef, playing, scene.id, sceneStartMs]);

  return <div className="template-preview-player">
    {/* 第四步口播由外部 audio 播放；单镜 Player 固定独立音量，确保模板内音效不受全局静音记录影响。 */}
    <Player ref={playerRef} key={JSON.stringify({id: scene.templateId, content: scene.content, data: scene.templateData, presenter: scene.presenterMode, visualStyle})} component={PreviewComposition} inputProps={{scene: previewScene, captions: previewCaptions, durationMs, presenter, brand, visualStyle}} durationInFrames={durationInFrames} compositionWidth={1080} compositionHeight={1260} fps={30} controls={false} initiallyMuted={false} initialVolume={1} numberOfSharedAudioTags={1} audioLatencyHint="interactive" style={{aspectRatio: "1080 / 1260", width: "100%"}} />
  </div>;
};
