// 漫画内容纸面沿用原揭示与口播绑定，只替换视觉外观。
import {comicTextSize} from "../ComicChrome";
import {Easing, Interactive, interpolate, useCurrentFrame} from "remotion";
import type {VideoScene} from "../schema";
import {ProtectedText} from "../ProtectedText";
import {VIDEO_COLORS, VIDEO_RADIUS, VIDEO_SHADOW, VIDEO_SURFACES, useVisualTheme} from "../theme";

/** 通用内容卡只承载规划文字，不根据口播臆造图表、流程或关系结构。 */
export const GenericContent: React.FC<{scene: VideoScene}> = ({scene}) => {
  const frame = useCurrentFrame();
  const theme = useVisualTheme();
  const progress = interpolate(frame, [0, 16], [0, 1], {easing: Easing.bezier(0.16, 1, 0.3, 1), extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const keywords = scene.content.keywords.filter(Boolean);
  return <Interactive.Div name="Generic content" style={{background: VIDEO_COLORS.surface, border: `${theme.id === "deep-signal" ? 1 : theme.id === "layered-mint" ? 2 : 3}px solid ${VIDEO_COLORS.line}`, borderTop: theme.id === "deep-signal" ? `8px solid ${VIDEO_COLORS.ink}` : undefined, borderRadius: VIDEO_RADIUS.feature, boxShadow: VIDEO_SHADOW.card, color: VIDEO_COLORS.ink, minHeight: 360, opacity: progress, padding: 42}}>
    {scene.content.subtitle.trim() ? <Interactive.Div name="Content subtitle" style={{color: VIDEO_COLORS.info, fontSize: 30, fontWeight: 760, lineHeight: 1.3, marginBottom: 20}}><ProtectedText>{scene.content.subtitle}</ProtectedText></Interactive.Div> : null}
    {scene.content.text.trim() ? <Interactive.Div name="Content body" style={{color: VIDEO_COLORS.mutedInk, fontSize: comicTextSize(scene.content.text, 820, 330, 30), fontWeight: 520, lineHeight: 1.24, marginBottom: 28}}><ProtectedText>{scene.content.text}</ProtectedText></Interactive.Div> : null}
    {keywords.length ? <div style={{display: "flex", flexWrap: "wrap", gap: 14}}>{keywords.map((keyword) => <Interactive.Div key={keyword} name={`Keyword ${keyword}`} style={{backgroundColor: theme.id === "deep-signal" ? VIDEO_COLORS.ink : VIDEO_SURFACES.feature, border: `2px solid ${VIDEO_COLORS.ink}`, borderRadius: VIDEO_RADIUS.card, color: theme.id === "deep-signal" ? VIDEO_COLORS.surface : VIDEO_COLORS.ink, fontSize: comicTextSize(keyword, 790, 60, 26), fontWeight: 700, padding: "12px 18px", maxWidth: "100%", overflowWrap: "anywhere"}}><ProtectedText>{keyword}</ProtectedText></Interactive.Div>)}</div> : null}
  </Interactive.Div>;
};
