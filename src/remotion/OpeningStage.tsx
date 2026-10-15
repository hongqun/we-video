import {openingBodyText} from "./OpeningLayout";
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from "remotion";
import {OpeningEmphasis} from "./OpeningEmphasis";
import type {Caption, VideoScene} from "./schema";
import {VIDEO_COLORS} from "./theme";
import {SANS_FONT_FAMILY} from "./typography";
import {ComicBackdrop} from "./ComicChrome";
import {OpeningEditorialBackdrop, OpeningEditorialHeader, OpeningEditorialSummary, OpeningEditorialTitle, OpeningTopicIndex} from "./OpeningEditorial";

export type OpeningStageMotion = {
  title: {start: number; duration: number};
  subtitle: {start: number; duration: number} | null;
  keywords: Array<{start: number; duration: number}>;
  hold: {start: number; duration: number};
};
// 所有入场最迟两秒收稳；短镜头压缩同一节奏，并保留稳定阅读窗口。
export const getOpeningStageMotion = (durationInFrames: number, hasSubtitle: boolean, keywordCount: number): OpeningStageMotion => {
  const end = Math.min(60, Math.max(0, Math.floor(durationInFrames * .65)));
  const unit = end / 60;
  return {title: {start: 0, duration: 12 * unit}, subtitle: hasSubtitle ? {start: 12 * unit, duration: 24 * unit} : null,
    keywords: Array.from({length: Math.max(0, keywordCount)}, (_, index) => ({start: (36 + 14 * index / Math.max(1, keywordCount - 1)) * unit, duration: 10 * unit})),
    hold: {start: end, duration: Math.max(0, durationInFrames - end)}};
};
const reveal = (frame: number, timing: {start: number; duration: number}) => timing.duration <= 0 ? 1 : interpolate(frame, [timing.start, timing.start + timing.duration], [0, 1], {easing: Easing.bezier(.16, 1, .3, 1), extrapolateLeft: "clamp", extrapolateRight: "clamp"});

// 开场没有音效，主标题从进入舞台起就可读，人物由全片轨道唯一绘制。
export const OpeningStage: React.FC<{scene: VideoScene; durationInFrames: number; captions?: Caption[]}> = ({scene, durationInFrames, captions = []}) => {
  const frame = useCurrentFrame();
  const {title, text, subtitle, keywords} = scene.content;
  const supporting = text.trim() || subtitle.trim();
  const displayedText = openingBodyText(supporting, (scene.content.emphasisBindings ?? []).map((binding) => binding.text));
  const words = [...new Set(keywords.map((word) => word.trim()).filter(Boolean))];
  const hasPresenter = scene.presenterMode !== "hidden";
  const motion = getOpeningStageMotion(durationInFrames, Boolean(supporting && supporting !== title), words.length);
  const progress = reveal(frame, motion.title);
  const detailProgress = motion.subtitle ? reveal(frame, motion.subtitle) : 1;
  // 内容区入场后轻放大再还原；词级强调单独跟随用户配置和真实口播。
  const pulseStart = motion.subtitle?.start ?? 0;
  const pulseDuration = Math.max(1, Math.min(24, durationInFrames * .3));
  const contentPulse = interpolate(frame, [pulseStart, pulseStart + pulseDuration * .5, pulseStart + pulseDuration], [1, 1.035, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  return <AbsoluteFill style={{color: VIDEO_COLORS.ink, fontFamily: SANS_FONT_FAMILY}}>
    <ComicBackdrop />
    <OpeningEditorialBackdrop hasVisual={hasPresenter} />
    <OpeningEditorialHeader />
    <OpeningEditorialTitle title={title} preferredSize={72} style={{opacity: progress, translate: `${(1 - progress) * -8}px 0`}} />
    {/* 正文沿用封面的编辑摘要位置，重点词仍按独立口播绑定执行放大。 */}
    {motion.subtitle ? <OpeningEditorialSummary text={displayedText} hasVisual={hasPresenter} style={{opacity: detailProgress, scale: String(contentPulse), transformOrigin: "center left", translate: `0 ${(1 - detailProgress) * 10}px`}}><OpeningEmphasis text={displayedText} scene={scene} captions={captions} /></OpeningEditorialSummary> : null}
    <OpeningTopicIndex words={words} progresses={words.map((_, index) => reveal(frame, motion.keywords[index]!))} compact={!motion.subtitle && hasPresenter} />
  </AbsoluteFill>;
};
