import type {CSSProperties, ReactNode} from "react";
import {Img} from "remotion";
import {ProtectedText} from "./ProtectedText";
import {SERIF_FONT_FAMILY} from "./typography";
import {VIDEO_COLORS, useVisualTheme} from "./theme";
import {comicTextSize} from "./ComicChrome";
import {OPENING_SUMMARY_LEFT, OPENING_SUMMARY_TOP, OPENING_SUMMARY_WIDTH, OPENING_TITLE_HEIGHT, OPENING_TITLE_LEFT, OPENING_TITLE_TOP, OPENING_TITLE_WIDTH} from "./OpeningLayout";
import {VideoBrand} from "./VideoBrand";
import type {RenderManifest} from "./schema";

// 右侧色域建立封面分栏，其余层级交给文字和留白，避免多条分割线互相争夺注意力。
export const OpeningEditorialBackdrop = ({hasVisual}: {hasVisual: boolean}) => {
  const theme = useVisualTheme();
  if (!hasVisual) return null;
  const cover = theme.scope === "cover";
  const panelStyle: CSSProperties = theme.id === "kinetic-lime"
    ? cover
      ? {display: "none"}
      : {background: theme.colors.softAccent, clipPath: "polygon(10% 0, 100% 0, 100% 86%, 0 100%, 0 8%)"}
    : theme.id === "layered-mint"
      ? cover
        ? {background: `radial-gradient(ellipse at 54% 48%, ${theme.colors.surfaceGlass}, transparent 72%)`, borderRadius: "50%"}
        : {background: `radial-gradient(ellipse at 58% 48%, ${theme.colors.softAccent}, transparent 68%)`, borderRadius: "50%"}
      : theme.id === "deep-signal"
        ? cover
          ? {display: "none"}
          : {background: `linear-gradient(90deg, ${theme.colors.softAccent}, transparent 82%)`, borderLeft: `5px solid ${theme.colors.ink}`}
        : {backgroundColor: "#EAF3E8"};
  return <div aria-hidden="true" style={{position: "absolute", left: 660, top: 132, width: 356, height: 900, ...panelStyle}} />;
};

export const OpeningEditorialHeader = ({brand}: {brand?: RenderManifest["brand"]}) => <VideoBrand brand={brand} />;

// 显式换行时只标记最后一行；自动换行保持纯文字，避免强调色切过未知换行位置。
export const OpeningEditorialTitle = ({title, preferredSize, style}: {title: string; preferredSize: number; style?: CSSProperties}) => {
  const theme = useVisualTheme();
  const normalized = title.replaceAll("\\n", "\n");
  const lines = normalized.split("\n");
  const explicitLines = lines.length > 1;
  return <div style={{position: "absolute", left: OPENING_TITLE_LEFT, top: OPENING_TITLE_TOP, width: OPENING_TITLE_WIDTH, height: OPENING_TITLE_HEIGHT, fontSize: comicTextSize(normalized, OPENING_TITLE_WIDTH, OPENING_TITLE_HEIGHT, preferredSize, 54), fontWeight: theme.id === "layered-mint" ? 760 : 900, letterSpacing: theme.id === "deep-signal" ? -1.2 : -2.2, lineHeight: 1.1, whiteSpace: "pre-wrap", textWrap: "balance", overflowWrap: "anywhere", ...style}}>
    {explicitLines ? lines.map((line, index) => <span key={`${line}-${index}`} style={{display: "block", position: "relative", width: "fit-content", maxWidth: "100%"}}>
      {index === lines.length - 1 ? <span aria-hidden="true" style={{position: "absolute", left: -3, right: -8, bottom: 5, height: ".2em", backgroundColor: VIDEO_COLORS.highlight}} /> : null}
      <span style={{position: "relative"}}><ProtectedText>{line}</ProtectedText></span>
    </span>) : <ProtectedText>{normalized}</ProtectedText>}
  </div>;
};

export const OpeningEditorialSummary = ({text, hasVisual, children, style}: {text: string; hasVisual: boolean; children?: ReactNode; style?: CSSProperties}) => {
  const theme = useVisualTheme();
  return <div style={{position: "absolute", left: OPENING_SUMMARY_LEFT, top: OPENING_SUMMARY_TOP, width: hasVisual ? OPENING_SUMMARY_WIDTH : 820, borderLeft: `7px solid ${VIDEO_COLORS.accent}`, paddingLeft: 22, boxSizing: "border-box", color: VIDEO_COLORS.ink, fontFamily: theme.id === "kinetic-lime" ? undefined : SERIF_FONT_FAMILY, fontSize: comicTextSize(text, hasVisual ? OPENING_SUMMARY_WIDTH - 30 : 790, 270, 44, 25), fontWeight: theme.id === "layered-mint" ? 620 : 720, lineHeight: 1.34, whiteSpace: "pre-wrap", overflowWrap: "anywhere", ...style}}>{children ?? <ProtectedText>{text}</ProtectedText>}</div>;
};

export const OpeningEditorialImage = ({src, prominent = false}: {src: string; prominent?: boolean}) => <Img src={src} style={{position: "absolute", left: prominent ? 692 : 92, top: prominent ? 414 : 748, width: prominent ? 292 : 142, height: prominent ? 430 : 142, objectFit: "contain"}} />;

// 关键词是主题索引而非按钮；5 个以上自动分两行，最后一项使用品牌绿强调。
export const OpeningTopicIndex = ({words, progresses, compact = false}: {words: string[]; progresses?: number[]; compact?: boolean}) => {
  const theme = useVisualTheme();
  if (!words.length) return null;
  // 关键词贴近摘要落位，避免封面下半区出现过大的空白。
  const top = compact ? (words.length > 4 ? 590 : 620) : (words.length > 4 ? 820 : 790);
  return <div style={{position: "absolute", left: 64, top, width: compact ? 470 : 760, zIndex: 2}}>
    {/* 关键词按内容宽度紧凑排列，避免等分列把短词拉得过开。 */}
    <div style={{display: "flex", flexWrap: "wrap", alignItems: "flex-start", columnGap: 24, rowGap: 12}}>{words.map((word, index) => {
      const last = index === words.length - 1;
      return <div key={`${word}-${index}`} style={{display: "flex", alignItems: "center", gap: 7, maxWidth: compact ? 210 : 220, minWidth: 0, opacity: progresses?.[index] ?? 1}}>
        <span aria-hidden="true" style={{width: 10, height: 10, flex: "0 0 auto", borderRadius: theme.id === "layered-mint" ? "50%" : 1, backgroundColor: last ? VIDEO_COLORS.accent : VIDEO_COLORS.ink}} />
        <span style={{fontSize: comicTextSize(word, 180, 38, 23, 15), fontWeight: last ? 850 : 680, color: last ? VIDEO_COLORS.accent : VIDEO_COLORS.ink, lineHeight: 1.15, overflowWrap: "anywhere"}}>{word}</span>
      </div>;
    })}</div>
  </div>;
};
