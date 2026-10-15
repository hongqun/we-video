import {mathOutroBackground, type MathOutroVariant} from "./math-outro-variants";

export type MathTheme = {
  background: string;
  isDark: boolean;
  ink: string;
  muted: string;
  formula: string;
  guide: string;
  axis: string;
  grid: string;
  gridOpacity: number;
  curve: string;
  curveDark: string;
  curveLight: string;
  trace: string;
  traceHighlight: string;
  curveGlowOpacity: number;
  accent: string;
  accentText: string;
  surface: string;
  surfaceBorder: string;
  surfaceShadow: string;
  tagline: string;
  footerBorder: string;
  footerWash: string;
  logoShadow: string;
  titleShadow: string;
  lockupAccent: string;
  lockupAccentShadow: string;
};

const LIGHT_THEME: MathTheme = {
  background: "#F4F8F1",
  isDark: false,
  ink: "#24322D",
  muted: "#6A756F",
  formula: "#2B5A4C",
  guide: "#94A9A0",
  axis: "#6F8E80",
  grid: "#6F8E80",
  gridOpacity: 0.09,
  curve: "#217A58",
  curveDark: "#175B42",
  curveLight: "#52C986",
  trace: "#4F9B70",
  traceHighlight: "#86CBA0",
  curveGlowOpacity: 0.18,
  accent: "#20D34F",
  accentText: "#10231B",
  surface: "rgba(255, 255, 255, .76)",
  surfaceBorder: "rgba(36, 50, 45, .16)",
  surfaceShadow: "0 16px 38px rgba(16, 35, 27, .09), inset 0 1px 0 rgba(255, 255, 255, .72)",
  tagline: "rgba(36, 50, 45, .46)",
  footerBorder: "rgba(36, 50, 45, .12)",
  footerWash: "rgba(36, 80, 62, .045)",
  logoShadow: "drop-shadow(0 20px 34px rgba(16, 35, 27, .12))",
  titleShadow: "0 10px 24px rgba(16, 35, 27, .1)",
  lockupAccent: "#8C9A92",
  lockupAccentShadow: "none",
};

const DARK_THEME: MathTheme = {
  background: "#081612",
  isDark: true,
  ink: "#F0F1EC",
  muted: "#AFBBB5",
  formula: "#B8F3C8",
  guide: "#B8F3C8",
  axis: "#20D34F",
  grid: "#B8F3C8",
  gridOpacity: 0.12,
  curve: "#7BF59A",
  curveDark: "#20D34F",
  curveLight: "#B8F3C8",
  trace: "#63D982",
  traceHighlight: "#B8F3C8",
  curveGlowOpacity: 0.28,
  accent: "#20D34F",
  accentText: "#081612",
  surface: "rgba(8, 22, 18, .84)",
  surfaceBorder: "rgba(184, 243, 200, .3)",
  surfaceShadow: "0 16px 38px rgba(0, 0, 0, .24), inset 0 1px 0 rgba(255, 255, 255, .08)",
  tagline: "rgba(240, 241, 236, .48)",
  footerBorder: "rgba(184, 243, 200, .16)",
  footerWash: "rgba(32, 211, 79, .07)",
  logoShadow: "drop-shadow(0 0 34px rgba(32, 211, 79, .42))",
  titleShadow: "0 0 22px rgba(240, 241, 236, .16)",
  lockupAccent: "#C2CCC6",
  lockupAccentShadow: "none",
};

export const getMathTheme = (variant: MathOutroVariant): MathTheme => (
  variant === "blueprint-grid" ? {...DARK_THEME, background: mathOutroBackground(variant)} : {...LIGHT_THEME, background: mathOutroBackground(variant)}
);
