import {Audio} from "@remotion/media";
import {AbsoluteFill, Sequence, staticFile, interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import type {VideoScene} from "./schema";
import {ProtectedText} from "./ProtectedText";
import {SANS_FONT_FAMILY} from "./typography";
import {VIDEO_COLORS, useVisualTheme} from "./theme";
import {VideoBrand} from "./VideoBrand";
import {ComicBackdrop, comicPaper, comicTag, comicTextSize} from "./ComicChrome";
import {useBrand} from "./BrandContext";

// 总结正文逐字显示并同步轻敲击声，保留完整占位，不播放独立入场提示音。
export const PresenterStage: React.FC<{scene: VideoScene; durationInFrames: number}> = ({scene, durationInFrames}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const theme = useVisualTheme();
  const brand = useBrand();
  const {title, subtitle, text, keywords} = scene.content;
  // 英文派生任务通过固定片尾配置标识语言；中文任务继续使用原有模板标签。
  const conclusionLabel = brand?.outro ? "Key Takeaway" : "核心结论";
  const supporting = text.trim() || subtitle.trim();
  const land = Math.max(1, Math.min(Math.round(.6 * fps), Math.floor(durationInFrames * .35)));
  const progress = interpolate(frame, [0, land], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  // 预留至少半秒读完整结论；极短镜头压缩打字过程，不吞最后几个字。
  const characters = Array.from(supporting.replaceAll("\\n", "\n"));
  const typingEnd = Math.max(1, Math.min(land + characters.length * 2, durationInFrames - Math.min(Math.round(fps * .5), Math.floor(durationInFrames * .25)) - 1));
  const typingStart = Math.min(land, Math.max(0, typingEnd - 1));
  const visibleCount = Math.floor(interpolate(frame, [typingStart, typingEnd], [0, characters.length], {extrapolateLeft: "clamp", extrapolateRight: "clamp"}));
  // 按旧版每三帧一次的敲击节奏预拼 30 秒音轨，避免预览和成片反复循环 120ms 短音频。
  const typingAudioDuration = Math.max(1, typingEnd - typingStart);
  const typingBedFrames = Math.round(fps * 30);
  const typingBedCount = Math.ceil(typingAudioDuration / typingBedFrames);
  const textWidth = theme.id === "kinetic-lime" ? 530 : theme.id === "deep-signal" ? 500 : 550;
  // 深绿结论用文字结构建立信号感，不再在人物背后铺大面积深色框。
  const conclusionPaper = theme.id === "deep-signal"
    ? {border: `1px solid ${theme.colors.line}`, borderLeft: `8px solid ${theme.colors.ink}`, boxShadow: theme.shadow.card}
    : theme.id === "kinetic-lime"
      ? {border: `1px solid ${theme.colors.line}`, borderLeft: `7px solid ${theme.colors.accent}`, boxShadow: theme.shadow.card}
      : {};
  return <AbsoluteFill style={{color: VIDEO_COLORS.ink, fontFamily: SANS_FONT_FAMILY}}>
    <ComicBackdrop />
    {supporting && supporting !== title ? Array.from({length: typingBedCount}, (_, index) => {
      const from = typingStart + index * typingBedFrames;
      // 超过单条素材长度时仅在 30 秒边界接下一段，不让长镜头的尾部静音。
      const duration = Math.min(typingBedFrames, typingEnd - from);
      return <Sequence key={`typing-sfx-${from}`} from={from} durationInFrames={duration} layout="none">
        <Audio src={staticFile("sfx/typing-bed.wav")} volume={.38} />
      </Sequence>;
    }) : null}
    <VideoBrand />
    <div style={{position: "absolute", left: 64, top: 224, width: textWidth}}>
      <div style={{...comicTag, display: "inline-block", padding: "9px 18px", fontSize: 22, marginBottom: 24, background: theme.id === "kinetic-lime" ? VIDEO_COLORS.ink : VIDEO_COLORS.accent, color: theme.id === "kinetic-lime" ? VIDEO_COLORS.canvas : VIDEO_COLORS.ink, borderColor: theme.id === "layered-mint" ? VIDEO_COLORS.accent : VIDEO_COLORS.ink}}>{conclusionLabel}</div>
      <div style={{fontSize: comicTextSize(title, 540, 200, 58), fontWeight: theme.id === "layered-mint" ? 760 : 900, letterSpacing: theme.id === "deep-signal" ? -.8 : -1.4, lineHeight: 1.2, whiteSpace: "pre-wrap", overflowWrap: "anywhere"}}><ProtectedText>{title}</ProtectedText></div>
    </div>
    {supporting && supporting !== title ? <div style={{...comicPaper, ...conclusionPaper, position: "absolute", left: 64, top: 520, width: textWidth, padding: 28, boxSizing: "border-box", fontSize: comicTextSize(supporting, textWidth - 62, 290, 38), fontWeight: theme.id === "layered-mint" ? 600 : 720, lineHeight: 1.24, whiteSpace: "pre-wrap", overflowWrap: "anywhere", opacity: progress, translate: `0 ${(1 - progress) * 18}px`}}><span>{characters.map((character, index) => <span key={index} style={{visibility: index < visibleCount ? "visible" : "hidden"}}>{character}</span>)}</span></div> : null}
    <div style={{position: "absolute", left: 64, top: 922, width: textWidth, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10}}>{keywords.map((word, index) => {const start = land + index * Math.min(4, land / Math.max(1, keywords.length)); const p = interpolate(frame, [start, start + Math.max(1, land / 2)], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"}); const editorial = theme.id === "kinetic-lime"; return <div key={`${word}-${index}`} style={{...comicTag, background: theme.id === "deep-signal" ? VIDEO_COLORS.ink : editorial ? (index === 0 ? VIDEO_COLORS.accent : VIDEO_COLORS.surface) : index === 0 ? VIDEO_COLORS.accent : VIDEO_COLORS.highlight, borderColor: editorial ? VIDEO_COLORS.line : undefined, color: theme.id === "deep-signal" ? VIDEO_COLORS.surface : VIDEO_COLORS.ink, boxShadow: theme.id === "deep-signal" ? "none" : editorial ? theme.shadow.card : comicTag.boxShadow, fontSize: comicTextSize(word, 235, Math.max(18, 150 / Math.max(1, Math.ceil(keywords.length / 2)) - 24), 24, 14), lineHeight: 1.2, padding: "6px 10px", maxWidth: "100%", overflowWrap: "anywhere", opacity: p}}>{word}</div>;})}</div>
  </AbsoluteFill>;
};
