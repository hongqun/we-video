import {OPENING_PRESENTER_BOX, openingPresenterImageStyle, openingBodyText} from "./OpeningLayout";
import {AbsoluteFill, Img, staticFile} from "remotion";
import type {CoverConfig, RenderManifest} from "./schema";
import {SANS_FONT_FAMILY} from "./typography";
import {VIDEO_COLORS, useVisualTheme} from "./theme";
import {ComicBackdrop} from "./ComicChrome";
import {OpeningEditorialBackdrop, OpeningEditorialHeader, OpeningEditorialImage, OpeningEditorialSummary, OpeningEditorialTitle, OpeningTopicIndex} from "./OpeningEditorial";

const coverImageSource = (path: string) => /^(?:https?:\/\/|data:|\/)/u.test(path) ? path : staticFile(path);
// 封面只读取 visual-plan.cover，独立预览和成片首帧保持完全一致。
export const getCoverContent = (cover: CoverConfig) => ({title: cover.title.trim(), subtitle: cover.subtitle.trim(), keywords: [...new Set(cover.keywords.map((word) => word.trim()).filter(Boolean))]});
export const CoverOpening: React.FC<{brand: RenderManifest["brand"]; presenter?: RenderManifest["presenter"]; cover: CoverConfig}> = ({brand, presenter, cover}) => {
  const theme = useVisualTheme();
  const content = getCoverContent(cover);
  const pose = presenter?.poses.find((item) => item.id === cover.presenterPoseId) ?? presenter?.poses.find((item) => item.id === "neutral") ?? presenter?.poses[0];
  const hasVisual = Boolean(pose || cover.imagePath);
  return <AbsoluteFill style={{color: VIDEO_COLORS.ink, fontFamily: SANS_FONT_FAMILY}}>
    {/* 成片封面只占第 0 帧，背景必须直接呈现收稳状态。 */}
    <ComicBackdrop settled role="cover" />
    <OpeningEditorialBackdrop hasVisual={hasVisual} />
    <OpeningEditorialHeader brand={brand} />
    {/* 封面主标题与场景一统一使用 72px 基准字号。 */}
    <OpeningEditorialTitle title={content.title} preferredSize={72} />
    {/* 人物和主题配图共享右侧编辑分栏；有人物时配图缩为左侧编辑插图。 */}
    {/* 人物只渲染原始透明 PNG；不再叠加染色修正、外框或底部渐隐。 */}
    {pose ? <div style={{position: "absolute", ...OPENING_PRESENTER_BOX, overflow: "hidden"}}><Img src={staticFile(pose.src)} style={{...openingPresenterImageStyle(pose.id), filter: theme.id === "layered-mint" ? "drop-shadow(0 18px 22px rgba(30,77,46,.12))" : undefined}} /></div> : null}
    {content.subtitle ? <OpeningEditorialSummary text={openingBodyText(content.subtitle)} hasVisual={hasVisual} /> : null}
    {cover.imagePath ? <OpeningEditorialImage src={coverImageSource(cover.imagePath)} prominent={!pose} /> : null}
    <OpeningTopicIndex words={content.keywords} compact={!content.subtitle && hasVisual} />
  </AbsoluteFill>;
};
