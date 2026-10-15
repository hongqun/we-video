import type {CSSProperties} from "react";
import {AbsoluteFill, Easing, Img, Interactive, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import type {MathRenderManifest} from "./math-schema";
import type {MathOutroVariant} from "./math-outro-variants";
import {getMathTheme} from "./math-theme";

type MathOutroProps = {
  brand: MathRenderManifest["brand"];
  variant: MathOutroVariant;
  outroFrame?: number;
  outroFrames: number;
  canvasHeight: number;
};

type LockupProps = {
  brand: MathRenderManifest["brand"];
  variant: MathOutroVariant;
  canvasHeight: number;
  frame: number;
  delay?: number;
};

const LOCKUP_SETTLE_FRAMES = 42;
const DECORATION_EXIT_START_FRAME = 60;
const DECORATION_EXIT_END_FRAME = 68;

const clampFrame = (frame: number, duration: number) => Math.min(Math.max(0, frame), Math.max(0, duration));

const decorationOpacity = (frame: number) => interpolate(
  frame,
  [0, DECORATION_EXIT_START_FRAME, DECORATION_EXIT_END_FRAME],
  [1, 1, 0],
  {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.4, 0, 0.2, 1)},
);

const getLockup = (canvasHeight: number) => {
  const compact = canvasHeight === 1260;
  const logoTop = compact ? 185 : 430;
  const logoWidth = compact ? 330 : 380;
  const logoHeight = compact ? 372 : 428;
  const titleTop = logoTop + logoHeight + (compact ? 8 : 18);
  const subtitleTop = titleTop + (compact ? 100 : 112);
  return {logoTop, logoWidth, logoHeight, titleTop, subtitleTop, centerX: 540, logoCenterY: logoTop + logoHeight / 2};
};

const BrandLockup: React.FC<LockupProps> = ({brand, variant, canvasHeight, frame, delay = 18}) => {
  const {fps} = useVideoConfig();
  const lockup = getLockup(canvasHeight);
  const theme = getMathTheme(variant);
  const logoSpring = spring({frame: Math.min(Math.max(0, frame - delay), LOCKUP_SETTLE_FRAMES), fps, config: {damping: 18, stiffness: 110, mass: 0.72}});
  const logoOpacity = interpolate(frame, [delay, delay + 10], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const titleOpacity = interpolate(frame, [delay + 12, delay + 27], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const subtitleOpacity = interpolate(frame, [delay + 25, delay + 42], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const titleMotion = interpolate(frame, [delay + 12, delay + 27], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const subtitleMotion = interpolate(frame, [delay + 25, delay + 42], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const titleTracking = variant === "blueprint-grid" ? 9 : variant === "particle-reconstruct" ? 12 : 15;
  const accentColor = theme.lockupAccent;
  const accentWidth = variant === "blueprint-grid" ? 280 : variant === "particle-reconstruct" ? 220 : 190;
  const accentOpacity = interpolate(frame, [delay + 8, delay + 22, DECORATION_EXIT_START_FRAME, DECORATION_EXIT_END_FRAME], [0, 0.9, 0.9, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1)});
  const common: CSSProperties = {position: "absolute", left: "50%", textAlign: "center", translate: "-50% 0px", width: "calc(100% - 144px)"};

  return <>
    <Img
      src={staticFile(brand.logoSrc)}
      style={{
        ...common,
        top: lockup.logoTop,
        width: lockup.logoWidth,
        height: lockup.logoHeight,
        objectFit: "contain",
        opacity: logoOpacity,
        scale: interpolate(logoSpring, [0, 1], [0.72, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp", output: "perceptual-scale"}),
        filter: theme.logoShadow,
      }}
    />
    <Interactive.Div
      name="Math outro brand title"
      style={{...common, top: lockup.titleTop, color: theme.ink, fontFamily: "Studio Sans, Arial, sans-serif", fontSize: canvasHeight === 1260 ? 72 : 82, fontWeight: 820, letterSpacing: interpolate(titleMotion, [0, 1], [titleTracking, 1.5]), opacity: titleOpacity, textShadow: theme.titleShadow, scale: interpolate(titleMotion, [0, 1], [variant === "particle-reconstruct" ? 0.88 : 0.94, 1], {output: "perceptual-scale"}), translate: interpolate(titleMotion, [0, 1], ["-50% 14px", "-50% 0px"]),}}
    >
      {brand.title}
    </Interactive.Div>
    <Interactive.Div
      name="Math outro title accent"
      style={{position: "absolute", top: lockup.titleTop + (canvasHeight === 1260 ? 86 : 96), left: "50%", width: interpolate(frame, [delay + 8, delay + 22], [0, accentWidth], {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1)}), height: variant === "blueprint-grid" ? 2 : 3, translate: "-50% 0px", backgroundColor: accentColor, borderRadius: 99, boxShadow: theme.lockupAccentShadow, opacity: accentOpacity}}
    />
    <Interactive.Div
      name="Math outro brand subtitle"
      style={{...common, top: lockup.subtitleTop, color: theme.muted, fontFamily: "Studio Sans, Arial, sans-serif", fontSize: canvasHeight === 1260 ? 30 : 38, fontWeight: 500, letterSpacing: interpolate(subtitleMotion, [0, 1], [variant === "blueprint-grid" ? 13 : 11, 6]), opacity: subtitleOpacity, textShadow: variant === "blueprint-grid" ? theme.titleShadow : "none", translate: interpolate(subtitleMotion, [0, 1], ["-50% 10px", "-50% 0px"])}}
    >
      {brand.subtitle}
    </Interactive.Div>
  </>;
};

const OrbitTrace: React.FC<{canvasHeight: number; frame: number}> = ({canvasHeight, frame}) => {
  const lockup = getLockup(canvasHeight);
  const theme = getMathTheme("orbit-trace");
  const orbitProgress = interpolate(frame, [0, 68], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.22, 1, 0.36, 1)});
  const orbitEntry = interpolate(frame, [0, 12, 30], [0, 0.52, 0.8], {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1)});
  const orbitOpacity = orbitEntry * decorationOpacity(frame);
  const orbitScale = interpolate(orbitProgress, [0, 1], [0.88, 1.02]);
  const orbitDashOffset = interpolate(orbitProgress, [0, 1], [620, 0]);
  const beaconAngle = interpolate(orbitProgress, [0, 1], [-Math.PI / 2, Math.PI * 1.55]);
  const beaconRotation = -18 * Math.PI / 180;
  const beaconLocalX = Math.cos(beaconAngle) * 272;
  const beaconLocalY = Math.sin(beaconAngle) * 112;
  const beaconX = lockup.centerX + (beaconLocalX * Math.cos(beaconRotation) - beaconLocalY * Math.sin(beaconRotation)) * orbitScale;
  const beaconY = lockup.logoCenterY + (beaconLocalX * Math.sin(beaconRotation) + beaconLocalY * Math.cos(beaconRotation)) * orbitScale;

  return <svg width={1080} height={canvasHeight} viewBox={`0 0 1080 ${canvasHeight}`} style={{position: "absolute", inset: 0, overflow: "visible"}}>
    <defs>
      <filter id="math-outro-orbit-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="11" /></filter>
      <linearGradient id="math-outro-orbit-gradient" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={theme.traceHighlight} />
        <stop offset="58%" stopColor={theme.trace} />
        <stop offset="100%" stopColor={theme.traceHighlight} />
      </linearGradient>
    </defs>
    <g transform={`translate(${lockup.centerX} ${lockup.logoCenterY}) scale(${orbitScale}) rotate(-18)`} fill="none" strokeLinecap="round">
      <ellipse rx={272} ry={112} stroke={theme.traceHighlight} strokeWidth={14} opacity={orbitOpacity * 0.1} filter="url(#math-outro-orbit-glow)" />
      <ellipse rx={272} ry={112} stroke="url(#math-outro-orbit-gradient)" strokeWidth={3.5} opacity={orbitOpacity} strokeDasharray="360 1120" strokeDashoffset={orbitDashOffset} />
      <ellipse rx={214} ry={78} transform="rotate(58)" stroke={theme.traceHighlight} strokeWidth={2} opacity={orbitOpacity * 0.32} strokeDasharray="84 940" strokeDashoffset={-orbitDashOffset * 0.72} />
    </g>
    <circle cx={beaconX} cy={beaconY} r={interpolate(frame, [14, 28, 48], [4, 12, 5], {extrapolateLeft: "clamp", extrapolateRight: "clamp"})} fill={theme.accent} opacity={orbitOpacity} filter="url(#math-outro-orbit-glow)" />
  </svg>;
};

const BlueprintGrid: React.FC<{canvasHeight: number; frame: number}> = ({canvasHeight, frame}) => {
  const lockup = getLockup(canvasHeight);
  const theme = getMathTheme("blueprint-grid");
  const gridProgress = interpolate(frame, [0, 28], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1)});
  const frameBox = {left: 272, right: 808, top: lockup.logoTop - 64, bottom: lockup.logoTop + lockup.logoHeight + 64};
  const scanY = interpolate(frame, [6, 66], [frameBox.top - 24, frameBox.bottom + 24], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const lockProgress = interpolate(frame, [20, 64], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1)});
  const systemOpacity = decorationOpacity(frame);
  const gridX = Array.from({length: 13}, (_, index) => 40 + index * 84);
  const gridY = Array.from({length: Math.ceil(canvasHeight / 84) + 1}, (_, index) => index * 84);
  const cornerSize = 34;
  const bracketPath = `M${frameBox.left + cornerSize},${frameBox.top}H${frameBox.left}V${frameBox.top + cornerSize} M${frameBox.right - cornerSize},${frameBox.top}H${frameBox.right}V${frameBox.top + cornerSize} M${frameBox.left},${frameBox.bottom - cornerSize}V${frameBox.bottom}H${frameBox.left + cornerSize} M${frameBox.right - cornerSize},${frameBox.bottom}H${frameBox.right}V${frameBox.bottom - cornerSize}`;

  return <>
    <svg width={1080} height={canvasHeight} viewBox={`0 0 1080 ${canvasHeight}`} style={{position: "absolute", inset: 0, overflow: "visible"}}>
      <defs>
        <filter id="math-outro-blueprint-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="13" /></filter>
        <radialGradient id="math-outro-blueprint-halo">
          <stop offset="0%" stopColor={theme.accent} stopOpacity="0.18" />
          <stop offset="72%" stopColor={theme.accent} stopOpacity="0.04" />
          <stop offset="100%" stopColor={theme.accent} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="math-outro-blueprint-scan" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={theme.accent} stopOpacity="0" />
          <stop offset="50%" stopColor={theme.curveLight} stopOpacity="0.9" />
          <stop offset="100%" stopColor={theme.accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx={lockup.centerX} cy={lockup.logoCenterY} r={330} fill="url(#math-outro-blueprint-halo)" opacity={systemOpacity} />
      <g stroke={theme.grid} strokeWidth={1} opacity={0.12 * gridProgress * systemOpacity}>
        {gridX.map((x) => <line key={`x-${x}`} x1={x} y1={0} x2={x} y2={canvasHeight} />)}
        {gridY.map((y) => <line key={`y-${y}`} x1={0} y1={y} x2={1080} y2={y} />)}
      </g>
      <g fill="none" stroke={theme.accent} strokeWidth={2} opacity={0.48 * lockProgress * systemOpacity}>
        <line x1={lockup.centerX} y1={frameBox.top} x2={lockup.centerX} y2={frameBox.bottom} strokeDasharray="8 16" />
        <line x1={frameBox.left} y1={lockup.logoCenterY} x2={frameBox.right} y2={lockup.logoCenterY} strokeDasharray="8 16" />
        <circle cx={lockup.centerX} cy={lockup.logoCenterY} r={interpolate(frame, [20, 60], [90, 250], {extrapolateLeft: "clamp", extrapolateRight: "clamp"})} strokeDasharray="12 20" />
        <circle cx={lockup.centerX} cy={lockup.logoCenterY} r={interpolate(frame, [28, 66], [30, 190], {extrapolateLeft: "clamp", extrapolateRight: "clamp"})} opacity={0.52} />
        <path d={bracketPath} strokeWidth={4} strokeLinecap="square" />
      </g>
      <rect x={frameBox.left - 48} y={scanY} width={frameBox.right - frameBox.left + 96} height={5} fill="url(#math-outro-blueprint-scan)" opacity={0.75 * systemOpacity} filter="url(#math-outro-blueprint-glow)" />
    </svg>
  </>;
};

const PARTICLE_SEEDS = Array.from({length: 36}, (_, index) => {
  const angle = (index / 36) * Math.PI * 2 - Math.PI / 2;
  const radius = 360 + (index % 5) * 32;
  return {x: 540 + Math.cos(angle) * radius, y: Math.sin(angle) * radius};
});

const ParticleReconstruct: React.FC<{canvasHeight: number; frame: number}> = ({canvasHeight, frame}) => {
  const lockup = getLockup(canvasHeight);
  const theme = getMathTheme("particle-reconstruct");
  const systemOpacity = decorationOpacity(frame);
  const haloOpacity = interpolate(frame, [0, 22, 44], [0, 0.72, 0.72], {extrapolateLeft: "clamp", extrapolateRight: "clamp"}) * systemOpacity;

  return <svg width={1080} height={canvasHeight} viewBox={`0 0 1080 ${canvasHeight}`} style={{position: "absolute", inset: 0, overflow: "visible"}}>
    <defs>
      <filter id="math-outro-particle-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="6" /></filter>
      <radialGradient id="math-outro-particle-halo">
        <stop offset="0%" stopColor={theme.accent} stopOpacity="0.32" />
        <stop offset="70%" stopColor={theme.accent} stopOpacity="0.08" />
        <stop offset="100%" stopColor={theme.accent} stopOpacity="0" />
      </radialGradient>
    </defs>
    <circle cx={lockup.centerX} cy={lockup.logoCenterY} r={interpolate(frame, [24, 52], [80, 280], {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1)})} fill="url(#math-outro-particle-halo)" opacity={haloOpacity} />
    <circle cx={lockup.centerX} cy={lockup.logoCenterY} r={interpolate(frame, [28, 54], [72, 224], {extrapolateLeft: "clamp", extrapolateRight: "clamp"})} fill="none" stroke={theme.accent} strokeWidth={2} strokeDasharray="4 14" opacity={haloOpacity} />
    {PARTICLE_SEEDS.map((point, index) => {
      const angle = (index / PARTICLE_SEEDS.length) * Math.PI * 2 - Math.PI / 2;
      const radius = 174 + (index % 3) * 18;
      const target = {x: lockup.centerX + Math.cos(angle) * radius, y: lockup.logoCenterY + Math.sin(angle) * radius};
      const delay = (index % 6) * 2;
      const progress = interpolate(frame, [6 + delay, 58 + delay], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1)});
      const opacity = interpolate(frame, [delay, 12 + delay], [0, 0.9], {extrapolateLeft: "clamp", extrapolateRight: "clamp"}) * systemOpacity;
      return <circle key={`particle-${index}`} cx={interpolate(progress, [0, 1], [point.x, target.x])} cy={interpolate(progress, [0, 1], [point.y, target.y])} r={index % 4 === 0 ? 6 : 4} fill={theme.accent} opacity={opacity} filter="url(#math-outro-particle-glow)" />;
    })}
  </svg>;
};

export const MathOutro: React.FC<MathOutroProps> = ({brand, variant, outroFrame, outroFrames, canvasHeight}) => {
  const currentFrame = useCurrentFrame();
  const frame = clampFrame(outroFrame ?? currentFrame, outroFrames);
  const theme = getMathTheme(variant);
  return <AbsoluteFill style={{backgroundColor: theme.background, color: theme.ink, overflow: "hidden"}}>
    {variant === "orbit-trace" ? <OrbitTrace canvasHeight={canvasHeight} frame={frame} /> : null}
    {variant === "blueprint-grid" ? <BlueprintGrid canvasHeight={canvasHeight} frame={frame} /> : null}
    {variant === "particle-reconstruct" ? <ParticleReconstruct canvasHeight={canvasHeight} frame={frame} /> : null}
    <BrandLockup brand={brand} variant={variant} canvasHeight={canvasHeight} frame={frame} delay={22} />
  </AbsoluteFill>;
};
