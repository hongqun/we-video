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
import {AutoDiagram} from "@/remotion/templates/AutoDiagram";
import {localModelFrame} from "@/remotion/templates/model-scene-camera";
import {sceneFrameSpan} from "@/remotion/timeline";
import type {VisualStyleId} from "@/remotion/visual-style";

const PREVIEW_TRANSITION = {kind: "fade" as const, durationMs: 315};
// 品牌数据与主 Player 同源，不让单镜预览退回硬编码文案。
const PreviewComposition: React.FC<{scene: VideoScene; captions: Caption[]; durationMs: number; durationInFrames: number; modelSource?: {scene: VideoScene; captions: Caption[]}; brand: RenderManifest["brand"]; presenter: NonNullable<RenderManifest["presenter"]>; visualStyle?: VisualStyleId; diagramOnly?: boolean}> = ({scene, captions, durationMs, durationInFrames, modelSource, presenter, brand, visualStyle, diagramOnly}) => diagramOnly ? <AbsoluteFill><Fonts><AutoDiagram scene={modelSource?.scene ?? scene} captions={modelSource?.captions ?? captions} /></Fonts></AbsoluteFill> : <BrandProvider value={brand}><VisualThemeProvider styleId={visualStyle}><AbsoluteFill>
    {/* 单镜预览与成片使用同一个全片主题背景。 */}
    <BackgroundTrack />
  <Fonts loadHandwriting={scene.templateId === "rve/text-reveal"}>
    <SceneContent scene={modelSource?.scene ?? scene} durationInFrames={durationInFrames} captions={modelSource?.captions ?? captions} />
    <PresenterTrack scenes={[scene]} presenter={presenter} />
  </Fonts>
  <Captions captions={captions} narrationDurationMs={durationMs} scenes={[scene]} />
</AbsoluteFill></VisualThemeProvider></BrandProvider>;

export const TemplatePreview: React.FC<{scene: VideoScene; brand: RenderManifest["brand"]; presenter: NonNullable<RenderManifest["presenter"]>; visualStyle?: VisualStyleId; playing?: boolean; audioRef?: React.RefObject<HTMLAudioElement | null>; playerRef?: React.RefObject<PlayerRef | null>; sceneStartMs?: number; sceneEndMs?: number; captions?: Caption[]; diagramOnly?: boolean}> = ({scene, presenter, brand, visualStyle, playing = false, audioRef, playerRef: controlledPlayerRef, sceneStartMs = 0, sceneEndMs = sceneStartMs + 8000, captions = [], diagramOnly = false}) => {
  const localPlayerRef = useRef<PlayerRef>(null);
  const playerRef = controlledPlayerRef ?? localPlayerRef;
  const durationMs = Math.max(1000, sceneEndMs - sceneStartMs);
  const isModel = scene.templateId === "rve/3d-model-scene";
  // 自动图表保留绝对字幕与帧边界，避免预览重定位改变触发时间。
  const isDiagram = scene.templateId === "rve/auto-diagram";
  // 手绘图层已按绝对帧边界编译，预览保留原镜头起点。
  const isExplainer = scene.templateId === "rve/handdraw-explainer";
  // 编辑时直接使用图表画布，避免成片版式把 SVG 再缩小一层。
  const focusDiagram = isDiagram && diagramOnly;
  const compositionWidth = focusDiagram ? 960 : 1080;
  const compositionHeight = focusDiagram ? 800 : 1260;
  const absoluteTiming = isModel || isDiagram || isExplainer;
  const durationInFrames = isExplainer && typeof scene.templateData?.durationInFrames === "number" ? scene.templateData.durationInFrames : absoluteTiming ? sceneFrameSpan(scene, 30).durationInFrames : Math.max(1, Math.ceil(durationMs / 1000 * 30));
  const previewCaptions = captions.filter((caption) => caption.endMs > sceneStartMs && caption.startMs < sceneEndMs).map((caption) => ({...caption, startMs: Math.max(0, caption.startMs - sceneStartMs), endMs: Math.min(durationMs, caption.endMs - sceneStartMs), timestampMs: caption.timestampMs === null ? null : Math.max(0, caption.timestampMs - sceneStartMs)})).filter((caption) => caption.endMs > caption.startMs);
  const previewScene: VideoScene = {...scene, id: `template-preview-${scene.templateId}`, startMs: 0, endMs: durationMs, speechStartMs: previewCaptions[0]?.startMs, speechEndMs: previewCaptions.at(-1)?.endMs, pauseAfterMs: undefined, transition: PREVIEW_TRANSITION};

  useEffect(() => {
    const handle = requestAnimationFrame(() => {
      const player = playerRef.current;
      if (!player) return;
      const relativeFrame = isModel ? localModelFrame((audioRef?.current?.currentTime ?? 0) * 1000, scene, 30) : isDiagram || isExplainer ? Math.round((audioRef?.current?.currentTime ?? 0) * 30) - sceneFrameSpan(scene, 30).from : Math.ceil((((audioRef?.current?.currentTime ?? 0) * 1000 - sceneStartMs) / 1000) * 30);
      player.seekTo(Math.max(0, Math.min(durationInFrames - 1, relativeFrame)));
      if (playing) void player.play(); else player.pause();
    });
    return () => cancelAnimationFrame(handle);
  }, [audioRef, durationInFrames, playerRef, playing, scene, sceneStartMs, isModel, isDiagram, isExplainer, focusDiagram]);

  return <div className="template-preview-player">
    {/* 第四步口播由外部 audio 播放；单镜 Player 固定独立音量，确保模板内音效不受全局静音记录影响。 */}
    <Player ref={playerRef} key={JSON.stringify({id: scene.templateId, content: scene.content, data: scene.templateData, presenter: scene.presenterMode, visualStyle, focusDiagram})} component={PreviewComposition} inputProps={{scene: previewScene, captions: previewCaptions, durationMs, durationInFrames, ...(absoluteTiming ? {modelSource: {scene, captions}} : {}), presenter, brand, visualStyle, diagramOnly: focusDiagram}} durationInFrames={durationInFrames} compositionWidth={compositionWidth} compositionHeight={compositionHeight} fps={30} controls={false} initiallyMuted={false} initialVolume={1} numberOfSharedAudioTags={1} audioLatencyHint="interactive" style={{aspectRatio: `${compositionWidth} / ${compositionHeight}`, width: "100%"}} />
  </div>;
};
