import {AbsoluteFill, Easing, Img, interpolate, staticFile, useVideoConfig} from "remotion";
import {VIDEO_COLORS, useVisualTheme} from "./theme";
import {SANS_FONT_FAMILY} from "./typography";

type BrandIdentity = {logoSrc: string; title: string; subtitle: string; outro?: {title: string; subtitle: string; prompt: string}};
type ParticleBrandOutroProps = {brand: BrandIdentity; canvasHeight: number; frame: number; outroFrames: number; showPrompt?: boolean};
// 固定种子保证预览与渲染一致；片尾只使用少量信号点，避免形成持续运转的装饰系统。
const particles = Array.from({length: 14}, (_, index) => ({angle: index * 2.39996, radius: 210 + index % 4 * 31, delay: index % 5 * .025}));
export const OUTRO_LOGO_LAND_SECONDS = .65;

// 片尾前半段汇聚显形，后半段完全收退光效，留下稳定品牌画面。
export const ParticleBrandOutro: React.FC<ParticleBrandOutroProps> = ({brand, canvasHeight, frame, outroFrames, showPrompt = false}) => {
  const {fps} = useVideoConfig();
  const theme = useVisualTheme();
  const time = Math.max(0, frame) / fps;
  const pace = Math.min(1, Math.max(1 / fps, outroFrames / fps) / 3);
  const t = time / pace;
  const centerY = canvasHeight === 1260 ? 440 : 680;
  const progress = (from: number, to: number) => interpolate(t, [from, to], [0, 1], {easing: Easing.bezier(.16, 1, .3, 1), extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const logoScale = interpolate(t, [.25, .5, OUTRO_LOGO_LAND_SECONDS, .85], [.88, 1.04, 1, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const halo = progress(.25, .5) * (1 - progress(.8, 1.3));
  const effectsOut = 1 - progress(1.05, 1.45);
  const dark = theme.id === "deep-signal";
  const foreground = dark ? "#F2FFE8" : theme.colors.ink;
  const muted = dark ? "rgba(238,255,230,.68)" : theme.colors.mutedInk;
  const background = dark ? "#073B1B" : theme.colors.canvas;
  const scan = progress(.08, .55) * effectsOut;
  // 英文派生片尾使用专题固定文案；历史 Manifest 没有该字段时保持中文显示。
  const outroTitle = brand.outro?.title ?? brand.title;
  const outroSubtitle = brand.outro?.subtitle ?? brand.subtitle;
  const outroPrompt = brand.outro?.prompt ?? "欢迎留言交流";
  return <AbsoluteFill style={{background, color: foreground, fontFamily: SANS_FONT_FAMILY, overflow: "hidden"}}>
    {theme.id === "layered-mint" ? <>
      <div aria-hidden="true" style={{position: "absolute", left: 138, top: centerY - 250, width: 430, height: 430, borderRadius: "46% 54% 60% 40%", background: theme.colors.softAccent, opacity: .9}} />
      <div aria-hidden="true" style={{position: "absolute", left: 490, top: centerY - 180, width: 390, height: 390, borderRadius: "58% 42% 45% 55%", background: theme.colors.softInfo, opacity: .75}} />
    </> : null}
    <div aria-hidden="true" style={{position: "absolute", left: 290, top: centerY - 250, width: 500, height: 500, borderRadius: "50%", opacity: halo, background: `radial-gradient(circle, ${dark ? "rgba(98,237,53,.20)" : theme.colors.softAccent}, transparent 68%)`}} />
    <svg aria-hidden="true" width={1080} height={canvasHeight} style={{position: "absolute", inset: 0}}>
      {theme.id === "kinetic-lime" ? <line x1={160} x2={160 + 760 * progress(.08, .55)} y1={centerY} y2={centerY} stroke={theme.colors.accent} strokeWidth={3} opacity={scan} /> : null}
      {particles.map((particle, index) => {
        const p = progress(particle.delay, .5 + particle.delay);
        const angle = particle.angle + p * .35;
        const radius = particle.radius * (1 - p) + 92 * p;
        const opacity = progress(particle.delay, particle.delay + .1) * effectsOut;
        return <circle key={index} cx={540 + Math.cos(angle) * radius} cy={centerY + Math.sin(angle) * radius} r={index % 3 === 0 ? 3.5 : 2} fill={index % 7 === 0 ? theme.colors.info : theme.colors.accent} opacity={opacity} />;
      })}
      {dark ? <path d={`M 360 ${centerY + 210} C 470 ${centerY + 80}, 660 ${centerY + 45}, 820 ${centerY - 110}`} fill="none" stroke={theme.colors.accent} strokeWidth={2} opacity={.34 * effectsOut} /> : null}
    </svg>
    {/* Logo 始终使用原始透明背景，片尾不再添加底板或边框。 */}
    <div style={{position: "absolute", left: 350, top: centerY - 205, width: 380, height: 410, alignItems: "center", display: "flex", justifyContent: "center", opacity: progress(.25, .45), scale: String(logoScale)}}><Img src={staticFile(brand.logoSrc)} style={{width: 330, height: 360, objectFit: "contain", filter: dark ? "drop-shadow(0 0 12px rgba(98,237,53,.28))" : undefined}} /></div>
    <div style={{position: "absolute", left: 72, top: centerY + 250, width: 936, fontSize: 62, fontWeight: 850, textAlign: "center", opacity: progress(.7, 1), translate: `0 ${(1 - progress(.7, 1)) * 12}px`}}>{outroTitle}</div>
    <div style={{position: "absolute", left: 72, top: centerY + 342, width: 936, color: muted, fontSize: 28, letterSpacing: 4, textAlign: "center", opacity: progress(.95, 1.3)}}>{outroSubtitle}</div>
    {showPrompt ? <div style={{position: "absolute", left: 72, top: centerY + 452, width: 936, fontSize: 25, color: dark ? muted : VIDEO_COLORS.mutedInk, textAlign: "center", opacity: progress(1.3, 1.6)}}>{outroPrompt}</div> : null}
  </AbsoluteFill>;
};
