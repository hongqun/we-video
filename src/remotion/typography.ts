// "Studio Sans" / "Studio Serif" are the vendored Noto Sans/Serif SC woff2 fonts
// embedded by Fonts.tsx. They lead the stack so the render is identical on every
// box (incl. the Ubuntu VPS, which has none of the OS CJK families); the OS stack
// behind them is a fallback in case the web font fails to load.
export const SANS_FONT_FAMILY = '"Studio Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
export const SERIF_FONT_FAMILY = '"Studio Serif", ui-serif, "Songti SC", STSong, SimSun, serif';
