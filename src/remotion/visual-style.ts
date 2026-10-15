// 三套新风格是任务级选择；legacy-comic 只用于兼容未保存 visualStyle 的历史任务。
export const VISUAL_STYLE_IDS = ["kinetic-lime", "layered-mint", "deep-signal"] as const;
export type VisualStyleId = (typeof VISUAL_STYLE_IDS)[number];
export type ResolvedVisualStyleId = VisualStyleId | "legacy-comic";

export type VideoTheme = {
  id: ResolvedVisualStyleId;
  scope: "scene" | "cover";
  label: string;
  description: string;
  colors: {
    canvas: string;
    ink: string;
    accent: string;
    surface: string;
    line: string;
    highlight: string;
    info: string;
    mutedInk: string;
    faintInk: string;
    softAccent: string;
    softInfo: string;
    surfaceStrong: string;
    surfaceGlass: string;
    inkStrong: string;
    onDarkMuted: string;
    onDarkLine: string;
    onDarkSoft: string;
    onDarkFaint: string;
  };
  radius: {small: number; card: number; feature: number};
  shadow: {card: string; feature: string; active: string};
};

// Tech123 Logo 的鲜绿是三套主题的共同色相锚点；背景通过明度和冷暖错开，避免 Logo 消失。
export const TECH123_BRAND_GREEN = "#20D34F";

const legacyColors = {
  canvas: "#FFF9ED", ink: "#182820", accent: "#20D34F", surface: "#FFFFFF", line: "#182820",
  highlight: "#FFE16A", info: "#4F6BFF", mutedInk: "rgba(16, 35, 27, 0.68)", faintInk: "rgba(16, 35, 27, 0.10)",
  softAccent: "rgba(32, 211, 79, 0.12)", softInfo: "rgba(79, 107, 255, 0.10)", surfaceStrong: "rgba(255, 255, 255, 0.92)",
  surfaceGlass: "rgba(255, 255, 255, 0.78)", inkStrong: "rgba(16, 35, 27, 0.94)", onDarkMuted: "rgba(255, 255, 255, 0.68)",
  onDarkLine: "rgba(255, 255, 255, 0.22)", onDarkSoft: "rgba(255, 255, 255, 0.16)", onDarkFaint: "rgba(255, 255, 255, 0.08)",
};

export const VIDEO_THEMES: Record<ResolvedVisualStyleId, VideoTheme> = {
  "legacy-comic": {
    id: "legacy-comic", scope: "scene", label: "旧版漫画", description: "仅兼容历史任务。", colors: legacyColors,
    radius: {small: 8, card: 14, feature: 22}, shadow: {card: "5px 6px 0 #182820", feature: "8px 9px 0 #182820", active: "5px 6px 0 #20D34F"},
  },
  "kinetic-lime": {
    id: "kinetic-lime", scope: "scene", label: "科技简报", description: "浅灰绿编辑画布、克制网格与品牌绿结构强调。",
    colors: {
      canvas: "#F4F8F1", ink: "#10231B", accent: TECH123_BRAND_GREEN, surface: "#FFFFFF", line: "#DCE6DF",
      highlight: "#B9FA79", info: "#4F6BFF", mutedInk: "rgba(16, 35, 27, 0.68)", faintInk: "rgba(16, 35, 27, 0.08)",
      softAccent: "rgba(32, 211, 79, 0.10)", softInfo: "rgba(79, 107, 255, 0.08)", surfaceStrong: "rgba(255, 255, 255, 0.94)",
      surfaceGlass: "rgba(255, 255, 255, 0.82)", inkStrong: "rgba(16, 35, 27, 0.94)", onDarkMuted: "rgba(244, 248, 241, 0.72)",
      onDarkLine: "rgba(244, 248, 241, 0.24)", onDarkSoft: "rgba(244, 248, 241, 0.16)", onDarkFaint: "rgba(244, 248, 241, 0.08)",
    },
    radius: {small: 14, card: 24, feature: 36}, shadow: {card: "0 16px 38px rgba(16,35,27,.09)", feature: "0 24px 58px rgba(16,35,27,.12)", active: "0 18px 42px rgba(16,35,27,.16)"},
  },
  "layered-mint": {
    id: "layered-mint", scope: "scene", label: "薄荷层域", description: "封面用透明色域表达层次，正文仅保留轻盈卡片。",
    colors: {
      canvas: "#F2F7F1", ink: "#183126", accent: TECH123_BRAND_GREEN, surface: "#FCFEFB", line: "#A9C2AE",
      highlight: "#DCEEB9", info: "#3A7550", mutedInk: "rgba(24, 49, 38, 0.62)", faintInk: "rgba(24, 49, 38, 0.07)",
      softAccent: "rgba(32, 211, 79, 0.09)", softInfo: "rgba(58, 117, 80, 0.08)", surfaceStrong: "rgba(252, 254, 251, 0.95)",
      surfaceGlass: "rgba(252, 254, 251, 0.78)", inkStrong: "rgba(18, 43, 31, 0.92)", onDarkMuted: "rgba(246, 255, 240, 0.70)",
      onDarkLine: "rgba(246, 255, 240, 0.24)", onDarkSoft: "rgba(246, 255, 240, 0.16)", onDarkFaint: "rgba(246, 255, 240, 0.08)",
    },
    radius: {small: 12, card: 24, feature: 38}, shadow: {card: "0 16px 42px rgba(27, 88, 45, .12)", feature: "0 24px 68px rgba(27, 88, 45, .14)", active: "0 14px 36px rgba(66, 213, 29, .24)"},
  },
  "deep-signal": {
    id: "deep-signal", scope: "scene", label: "深绿信号场", description: "封面用深绿与辉光营造纵深，正文使用浅色科技编辑感。",
    colors: {
      canvas: "#F1F5F0", ink: "#0B301A", accent: "#1EAD4A", surface: "#FFFFFF", line: "#90AA97",
      highlight: "#C6E99D", info: "#285C3A", mutedInk: "rgba(11, 48, 26, 0.66)", faintInk: "rgba(11, 48, 26, 0.08)",
      softAccent: "rgba(30, 173, 74, 0.10)", softInfo: "rgba(40, 92, 58, 0.08)", surfaceStrong: "rgba(255, 255, 255, 0.95)",
      surfaceGlass: "rgba(255, 255, 255, 0.82)", inkStrong: "rgba(5, 38, 18, 0.94)", onDarkMuted: "rgba(238, 255, 230, 0.68)",
      onDarkLine: "rgba(238, 255, 230, 0.22)", onDarkSoft: "rgba(238, 255, 230, 0.15)", onDarkFaint: "rgba(238, 255, 230, 0.07)",
    },
    radius: {small: 6, card: 14, feature: 24}, shadow: {card: "0 10px 28px rgba(12, 54, 28, .10)", feature: "0 18px 48px rgba(12, 54, 28, .13)", active: "0 0 0 3px rgba(30,173,74,.18)"},
  },
};

export const resolveVisualStyle = (style?: VisualStyleId): ResolvedVisualStyleId => style ?? "legacy-comic";
const COVER_THEME_OVERRIDES: Partial<Record<VisualStyleId, {colors: Partial<VideoTheme["colors"]>; radius?: VideoTheme["radius"]; shadow?: VideoTheme["shadow"]}>> = {
  "kinetic-lime": {colors: {canvas: "#F4F8F1", ink: "#10231B", surface: "#FFFFFF", line: "#DCE6DF", highlight: "#B9FA79", mutedInk: "rgba(16,35,27,.68)", faintInk: "rgba(16,35,27,.08)", surfaceStrong: "rgba(255,255,255,.94)", surfaceGlass: "rgba(255,255,255,.82)"}},
  "layered-mint": {colors: {canvas: "#DFFFD1", ink: "#10291B", surface: "#F6FFF0", line: "#87B68B", highlight: "#A9EF76", info: "#19783A", softAccent: "rgba(66,213,29,.18)"}},
  "deep-signal": {colors: {canvas: "#073B1B", ink: "#F2FFE8", accent: "#62ED35", surface: "#104C29", line: "#73A87C", highlight: "#A5FF70", info: "#8ED6B0", mutedInk: "rgba(238,255,230,.68)", faintInk: "rgba(238,255,230,.10)", softAccent: "rgba(98,237,53,.15)", softInfo: "rgba(142,214,176,.12)", surfaceStrong: "rgba(12,74,37,.94)", surfaceGlass: "rgba(12,74,37,.78)"}, shadow: {card: "0 12px 34px rgba(0,0,0,.24)", feature: "0 22px 64px rgba(0,0,0,.30)", active: "0 0 30px rgba(98,237,53,.28)"}},
};

// 参考图的高强度视觉只用于封面；正文使用独立的低刺激调色板。
export const resolveVideoTheme = (style?: VisualStyleId, scope: VideoTheme["scope"] = "scene") => {
  const base = VIDEO_THEMES[resolveVisualStyle(style)];
  const override = scope === "cover" && base.id !== "legacy-comic" ? COVER_THEME_OVERRIDES[base.id] : undefined;
  return {...base, scope, colors: {...base.colors, ...override?.colors}, radius: override?.radius ?? base.radius, shadow: override?.shadow ?? base.shadow};
};
export const VISUAL_STYLE_OPTIONS = VISUAL_STYLE_IDS.map((id) => VIDEO_THEMES[id]);
