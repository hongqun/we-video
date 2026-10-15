import type {CSSProperties} from "react";
import {AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import {VIDEO_COLORS, VIDEO_RADIUS, VIDEO_SHADOW, useVisualTheme} from "./theme";

const signalDots = Array.from({length: 72}, (_, index) => {
  const lane = index % 4;
  const step = Math.floor(index / 4);
  const x = 470 + step * 42;
  const y = 860 - lane * 26 - Math.sin(step * .48 + lane) * (38 + lane * 9) - step * 7;
  return {x, y, radius: index % 9 === 0 ? 4 : 2};
});

// 背景只表达材质和空间，不绘制进度、百分比、按钮或任何会被误读为业务数据的元素。
export const ComicBackdrop = ({settled = false, role = "scene"}: {settled?: boolean; role?: "scene" | "cover"}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const theme = useVisualTheme();
  const enter = settled ? 1 : interpolate(frame, [0, 22], [0, 1], {easing: Easing.bezier(.16, 1, .3, 1), extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  if (theme.id === "legacy-comic") return <AbsoluteFill aria-hidden="true" style={{backgroundColor: theme.colors.canvas, pointerEvents: "none"}} />;
  // 科技简报正文只保留两个极淡环境光域，封面网格和结构图形不进入业务场景。
  if (role === "scene") return <AbsoluteFill aria-hidden="true" style={{background: theme.id === "kinetic-lime" ? `radial-gradient(circle at 94% 8%, ${theme.colors.softInfo}, transparent 18%), radial-gradient(circle at 7% 93%, ${theme.colors.softAccent}, transparent 22%), ${theme.colors.canvas}` : theme.colors.canvas, pointerEvents: "none"}} />;
  if (theme.id === "kinetic-lime") return <AbsoluteFill aria-hidden="true" style={{backgroundColor: theme.colors.canvas, overflow: "hidden", pointerEvents: "none"}}>
    <div style={{position: "absolute", inset: 0, opacity: .32 * enter, backgroundImage: `linear-gradient(${theme.colors.faintInk} 2px, transparent 2px), linear-gradient(90deg, ${theme.colors.faintInk} 2px, transparent 2px)`, backgroundSize: "72px 72px", maskImage: "linear-gradient(to bottom, black 0%, rgba(0,0,0,.5) 62%, transparent 88%)"}} />
    <div style={{position: "absolute", width: 430, height: 430, top: -138, right: -96, borderRadius: 118, backgroundColor: theme.colors.accent, rotate: "18deg", boxShadow: `0 30px 80px ${theme.colors.softAccent}`, opacity: enter}} />
    <div style={{position: "absolute", width: 236, height: 236, top: 54, right: 32, border: `3px solid ${theme.colors.inkStrong}`, borderRadius: "50%", boxShadow: `inset 0 0 0 22px ${theme.colors.surfaceGlass}`, opacity: enter}} />
  </AbsoluteFill>;
  if (theme.id === "layered-mint") return <AbsoluteFill aria-hidden="true" style={{backgroundColor: theme.colors.canvas, overflow: "hidden", pointerEvents: "none"}}>
    <svg width={width} height={height} style={{position: "absolute", inset: 0}}>
      <ellipse cx={830} cy={365} rx={295} ry={210} fill={theme.colors.accent} opacity={.14 * enter} />
      <ellipse cx={680} cy={510} rx={250} ry={330} fill={theme.colors.info} opacity={.09 * enter} />
      <ellipse cx={975} cy={650} rx={230} ry={285} fill={theme.colors.ink} opacity={.07 * enter} />
      <path d="M -60 900 C 250 690, 460 1090, 730 805 S 1160 570, 1210 690" fill="none" stroke={theme.colors.ink} strokeWidth={2} opacity={.28 * enter} />
      <path d="M -40 934 C 265 728, 470 1110, 742 832 S 1150 614, 1210 720" fill="none" stroke={theme.colors.accent} strokeDasharray="3 10" strokeWidth={2} opacity={.34 * enter} />
    </svg>
  </AbsoluteFill>;
  return <AbsoluteFill aria-hidden="true" style={{backgroundColor: theme.colors.canvas, overflow: "hidden", pointerEvents: "none"}}>
    {/* 深绿封面只用羽化光域托住人物，不绘制色块、人物框或仿星球轮廓。 */}
    <div style={{position: "absolute", left: 520, top: 310, width: 650, height: 780, borderRadius: "50%", background: "radial-gradient(ellipse at 50% 48%, rgba(220,255,214,.10), rgba(98,237,53,.04) 42%, transparent 70%)", opacity: enter}} />
    <svg width={width} height={height} style={{position: "absolute", inset: 0}}>
      <defs><filter id="signal-soft-glow"><feGaussianBlur stdDeviation="5" /></filter></defs>
      <path d="M 390 1040 C 585 815, 760 770, 1160 610" fill="none" stroke={theme.colors.accent} strokeWidth={18} opacity={.08 * enter} filter="url(#signal-soft-glow)" />
      <path d="M 390 1040 C 585 815, 760 770, 1160 610" fill="none" stroke={theme.colors.accent} strokeWidth={2} opacity={.46 * enter} />
      <path d="M 430 1090 C 620 880, 805 820, 1170 690" fill="none" stroke={theme.colors.info} strokeDasharray="2 13" strokeWidth={2} opacity={.42 * enter} />
      {signalDots.map((dot, index) => <circle key={index} cx={dot.x} cy={dot.y} r={dot.radius} fill={index % 7 === 0 ? theme.colors.info : theme.colors.accent} opacity={(index % 5 === 0 ? .72 : .38) * enter} />)}
    </svg>
  </AbsoluteFill>;
};

export const comicPaper: CSSProperties = {background: VIDEO_COLORS.surface, border: `3px solid ${VIDEO_COLORS.ink}`, borderRadius: VIDEO_RADIUS.feature, boxShadow: VIDEO_SHADOW.feature};
export const comicTag: CSSProperties = {background: VIDEO_COLORS.highlight, border: `2px solid ${VIDEO_COLORS.ink}`, borderRadius: VIDEO_RADIUS.small, boxShadow: "3px 3px 0 #182820", color: VIDEO_COLORS.ink, fontWeight: 800};

// 按实际换行和可用矩形保守估算字号，长正文不裁切为省略号。
export const comicTextSize = (text: string, width: number, height: number, preferred: number, minimum = 18) => {
  for (let size = preferred; size >= minimum; size -= 2) {
    const columns = Math.max(1, Math.floor(width / size));
    const lines = text.replaceAll("\\n", "\n").split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(Array.from(line).length / columns)), 0);
    if (lines * size * 1.24 <= height) return size;
  }
  return minimum;
};
