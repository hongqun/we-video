import {createContext, createElement, useContext, type CSSProperties, type ReactNode} from "react";
import {resolveVideoTheme, type VideoTheme, type VisualStyleId} from "./visual-style";

const VisualThemeContext = createContext<VideoTheme>(resolveVideoTheme());

// Provider 同时下发具体颜色与 CSS 变量，让静态样式对象和需要数值颜色的帧动画共享同一主题。
export const VisualThemeProvider = ({styleId, scope = "scene", children}: {styleId?: VisualStyleId; scope?: VideoTheme["scope"]; children: ReactNode}) => {
  const theme = resolveVideoTheme(styleId, scope);
  const variables = {
    "--video-canvas": theme.colors.canvas, "--video-ink": theme.colors.ink, "--video-accent": theme.colors.accent,
    "--video-surface": theme.colors.surface, "--video-line": theme.colors.line, "--video-highlight": theme.colors.highlight,
    "--video-info": theme.colors.info, "--video-muted-ink": theme.colors.mutedInk, "--video-faint-ink": theme.colors.faintInk,
    "--video-soft-accent": theme.colors.softAccent, "--video-soft-info": theme.colors.softInfo, "--video-surface-strong": theme.colors.surfaceStrong,
    "--video-surface-glass": theme.colors.surfaceGlass, "--video-ink-strong": theme.colors.inkStrong, "--video-on-dark-muted": theme.colors.onDarkMuted,
    "--video-on-dark-line": theme.colors.onDarkLine, "--video-on-dark-soft": theme.colors.onDarkSoft, "--video-on-dark-faint": theme.colors.onDarkFaint,
    "--video-radius-small": `${theme.radius.small}px`, "--video-radius-card": `${theme.radius.card}px`, "--video-radius-feature": `${theme.radius.feature}px`,
    "--video-shadow-card": theme.shadow.card, "--video-shadow-feature": theme.shadow.feature, "--video-shadow-active": theme.shadow.active,
  } as CSSProperties;
  return createElement(VisualThemeContext.Provider, {value: theme}, createElement("div", {"data-visual-style": theme.id, style: {position: "absolute", inset: 0, ...variables}}, children));
};

export const useVisualTheme = () => useContext(VisualThemeContext);

// 组件继续消费同一组语义令牌；具体值由上层任务风格注入。
export const VIDEO_COLORS = {
  canvas: "var(--video-canvas, #FFF9ED)", ink: "var(--video-ink, #182820)", accent: "var(--video-accent, #20D34F)",
  surface: "var(--video-surface, #FFFFFF)", line: "var(--video-line, #182820)", highlight: "var(--video-highlight, #FFE16A)",
  info: "var(--video-info, #4F6BFF)", mutedInk: "var(--video-muted-ink, rgba(16, 35, 27, 0.68))", faintInk: "var(--video-faint-ink, rgba(16, 35, 27, 0.10))",
  softAccent: "var(--video-soft-accent, rgba(32, 211, 79, 0.12))", softInfo: "var(--video-soft-info, rgba(79, 107, 255, 0.10))",
  surfaceStrong: "var(--video-surface-strong, rgba(255, 255, 255, 0.92))", surfaceGlass: "var(--video-surface-glass, rgba(255, 255, 255, 0.78))",
  inkStrong: "var(--video-ink-strong, rgba(16, 35, 27, 0.94))", onDarkMuted: "var(--video-on-dark-muted, rgba(255, 255, 255, 0.68))",
  onDarkLine: "var(--video-on-dark-line, rgba(255, 255, 255, 0.22))", onDarkSoft: "var(--video-on-dark-soft, rgba(255, 255, 255, 0.16))",
  onDarkFaint: "var(--video-on-dark-faint, rgba(255, 255, 255, 0.08))",
} as const;

// 卡片使用实色纸面，漫画层级由描边和硬阴影建立。
export const VIDEO_SURFACES = {
  feature: VIDEO_COLORS.surface,
  data: VIDEO_COLORS.canvas,
} as const;

export const VIDEO_TYPE = {
  brandLabel: 24,
  utility: 24,
  supportingCompact: 28,
  supporting: 32,
  // 字幕比画面标题克制，但通过底板和字重保持前景口播层级。
  caption: 34,
  cardCompact: 32,
  card: 38,
  headlineCompact: 56,
  displayCompact: 108,
  display: 168,
} as const;

export const VIDEO_RADIUS = {
  small: "var(--video-radius-small, 8px)",
  card: "var(--video-radius-card, 14px)",
  feature: "var(--video-radius-feature, 22px)",
  pill: 999,
} as const;

export const VIDEO_SHADOW = {
  card: "var(--video-shadow-card, 5px 6px 0 #182820)",
  feature: "var(--video-shadow-feature, 8px 9px 0 #182820)",
  active: "var(--video-shadow-active, 5px 6px 0 #20D34F)",
} as const;

// 所有场景共用固定标题字号，长标题只换行，不因字符数量改变视觉层级。
export const sceneHeadlineSize = (text: string) => {
  void text;
  return 42;
};

export const cardTextSize = (text: string) => text.length > 12 ? VIDEO_TYPE.cardCompact : VIDEO_TYPE.card;

export const displayNumberSize = (text: string) => text.length > 8 ? VIDEO_TYPE.displayCompact : VIDEO_TYPE.display;
