import {Audio} from "@remotion/media";
import {AbsoluteFill, Html5Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import {Captions} from "./Captions";
import {CoverOpening} from "./CoverOpening";
import {Fonts} from "./Fonts";
import {OUTRO_LOGO_LAND_SECONDS} from "./ParticleBrandOutro";
import {Outro} from "./Outro";
import type {RenderManifest} from "./schema";
import {SceneContent} from "./scenes/SceneContent";
import {SceneTransition, sceneEntryTransitionFrames} from "./scenes/SceneTransition";
import {BrandProvider} from "./BrandContext";
import {VIDEO_COLORS, VisualThemeProvider} from "./theme";
import {PresenterTrack} from "./PresenterTrack";
import {BackgroundTrack} from "./BackgroundTrack";
import {assertNarrationFrameCoverage, narrationSceneFrameSpans} from "./timeline";
import {defaultCover} from "./cover";

export const ShortVideo: React.FC<RenderManifest> = (props) => {
  const {fps} = useVideoConfig();
  const frame = useCurrentFrame();
  const narrationFrames = Math.ceil((props.narration.durationMs / 1000) * fps);
  const outroFrames = Math.ceil((props.video.outroDurationMs / 1000) * fps);
  // 当前 Manifest 均由 visual-plan 生成 cover；仅为历史 Manifest 保留一次兼容补齐。
  const cover = props.cover ?? defaultCover(props.title, {content: props.scenes[0]!.content, presenter: {poseId: props.scenes[0]!.presenterPoseId}});
  const sceneSpans = narrationSceneFrameSpans(props.scenes, props.narration.durationMs, fps);
  assertNarrationFrameCoverage(sceneSpans, narrationFrames);
  return (
    <Fonts>
    <BrandProvider value={props.brand}>
    <VisualThemeProvider styleId={props.visualStyle}>
    <AbsoluteFill style={{backgroundColor: VIDEO_COLORS.canvas}}>
      <BackgroundTrack />
      {/* 长口播使用独立原生音频轨道，缓冲时同步暂停画面；片尾提示音不接管口播播放。 */}
      {props.narration.audioSrc ? <Html5Audio src={props.narration.audioSrc} pauseWhenBuffering useWebAudioApi={false} /> : null}
      {props.scenes.map((scene, index) => {
        const {from, durationInFrames} = sceneSpans[index]!;
        const nextScene = props.scenes[index + 1];
        const nextDurationInFrames = nextScene
          ? sceneSpans[index + 1]!.durationInFrames
          : 0;
        // 旧场延长到新场的入场窗口，让两侧位移和透明度互补，不在切点留空帧。
        const exitOverlapFrames = nextScene ? sceneEntryTransitionFrames(nextScene, scene, fps, nextDurationInFrames) : 0;
        return (
          <Sequence key={scene.id} from={from} durationInFrames={durationInFrames + exitOverlapFrames} name={scene.content.title}>
            <SceneTransition scene={scene} previousScene={props.scenes[index - 1]} durationInFrames={durationInFrames} exitOverlapFrames={exitOverlapFrames}>
              {/* 跨边界字幕也参与重点词匹配，组件内部按场景时间处理。 */}
              <SceneContent scene={scene} durationInFrames={durationInFrames} captions={props.captions.filter((caption) => caption.endMs > (scene.speechStartMs ?? scene.startMs) && caption.startMs < (scene.speechEndMs ?? scene.endMs))} />
            </SceneTransition>
          </Sequence>
        );
      })}
      {/* 人物覆盖层跨越全部口播场景，保证缩放、换边和姿态切换连续。 */}
      <Sequence durationInFrames={narrationFrames} name="数字 IP 人物轨道">
        <PresenterTrack scenes={props.scenes} presenter={props.presenter} />
      </Sequence>
      {/* 完整封面仅占首帧，不挪动口播和场景时间轴。 */}
      <Sequence durationInFrames={1} name="漫画知识封面">
        <VisualThemeProvider styleId={props.visualStyle} scope="cover">
          <CoverOpening brand={props.brand} presenter={props.presenter} cover={cover} />
        </VisualThemeProvider>
      </Sequence>
      {/* 首帧保持完整封面，字幕不移动时间轴。 */}
      {frame > 0 ? <Captions captions={props.captions} narrationDurationMs={props.narration.durationMs} scenes={props.scenes} style={props.captionStyle ?? "narration"} /> : null}
      <Sequence from={narrationFrames} durationInFrames={outroFrames} name="品牌片尾">
        {/* 原提示音对齐 Logo 落定点，不占用口播尾音。 */}
        <Sequence from={Math.round(OUTRO_LOGO_LAND_SECONDS * fps)} layout="none">
          <Audio src={staticFile("sfx/outro-ding.wav")} volume={0.42} />
        </Sequence>
        <Outro brand={props.brand} durationInFrames={outroFrames} />
      </Sequence>
    </AbsoluteFill>
    </VisualThemeProvider>
    </BrandProvider>
    </Fonts>
  );
};
