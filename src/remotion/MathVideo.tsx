import {Audio} from "@remotion/media";
import {AbsoluteFill, Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import katex from "katex";
import "katex/dist/katex.min.css";
import {addSpeedVariation, clampParameters, fitPoints, formatFormulaForDisplay, formulaCatalog, pathFromPoints} from "../math/formulas";
import type {MathRenderManifest} from "./math-schema";
import {MATH_COVER_FADE_FRAMES, getMathTiming} from "./math-timing";
import {MathOutro} from "./MathOutro";
import {getMathTheme} from "./math-theme";
import {getMathEffectProfile, MathCoordinateFrame, MathCurveGuides} from "./MathCurveGuides";

const pathRangeFromPoints = (points: {x: number; y: number}[], startProgress: number, endProgress: number) => {
  const startIndex = Math.max(0, Math.floor(points.length * Math.max(0, startProgress)));
  const endIndex = Math.max(startIndex + 2, Math.ceil(points.length * Math.min(1, endProgress)));
  return points.slice(startIndex, endIndex).map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
};

export const MathVideo: React.FC<MathRenderManifest> = (props) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const canvasHeight = props.video.height;
  const compactLayout = canvasHeight === 1260;
  const theme = getMathTheme(props.outroVariant);
  const definition = formulaCatalog[props.formula.id];
  const effectProfile = getMathEffectProfile(definition);
  const parameters = clampParameters(definition, props.formula.parameters);
  // 两种画布都保留顶部品牌区和底部片尾安全区；6:7 画布压缩纵向布局，不压缩曲线宽度。
  // 曲线整体下移，为可能自动换成两行的公式留出稳定的垂直间距。
  const bounds = compactLayout
    ? {left: 80, top: 390, width: 920, height: 520}
    : {left: 80, top: 570, width: 920, height: 870};
  const layout = compactLayout
    ? {gradientBottom: 40, gradientHeight: 210, brandTop: 70, brandHeight: 82, formulaTop: 180, labelBottom: 170, taglineBottom: 110}
    : {gradientBottom: 100, gradientHeight: 270, brandTop: 180, brandHeight: 96, formulaTop: 305, labelBottom: 245, taglineBottom: 165};
  const formulaPoints = definition.points(parameters);
  const fittedGeometry = fitPoints(formulaPoints, bounds);
  const points = fittedGeometry.points;
  const timing = getMathTiming(props.formula.plot.drawDurationMs, props.video.outroDurationMs, fps);
  const progress = interpolate(frame, [timing.drawStartFrame, timing.drawEndFrame], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.42, 0, 0.58, 1)});
  const animatedProgress = addSpeedVariation(progress, props.formula.id.length * 0.37);
  const path = pathFromPoints(points, animatedProgress);
  const trailPath = pathRangeFromPoints(points, animatedProgress - 0.065, animatedProgress);
  const coverPath = pathFromPoints(points, 1);
  const formula = definition.dynamicLatex(parameters, animatedProgress);
  const coverFormula = definition.dynamicLatex(parameters, 1);
  const coverOpacity = interpolate(frame, [Math.max(0, timing.coverFrames - MATH_COVER_FADE_FRAMES), timing.coverFrames], [1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const fade = interpolate(frame, [timing.coverFrames, timing.coverFrames + 18], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const graphFade = interpolate(frame, [Math.max(0, timing.coverFrames - MATH_COVER_FADE_FRAMES), timing.drawStartFrame], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const centerX = fittedGeometry.visualCenter.x;
  const centerY = fittedGeometry.visualCenter.y;
  const tipIndex = Math.min(points.length - 1, Math.max(0, Math.ceil(animatedProgress * points.length) - 1));
  const tipPoint = points[tipIndex];
  const tipCoordinate = formulaPoints[Math.min(formulaPoints.length - 1, tipIndex)] ?? formulaPoints[0];
  const tangentPoint = points[Math.min(points.length - 1, tipIndex + 4)] ?? tipPoint;
  const previousTangentPoint = points[Math.max(0, tipIndex - 4)] ?? tipPoint;
  const tangentAngle = Math.atan2(tangentPoint.y - previousTangentPoint.y, tangentPoint.x - previousTangentPoint.x);
  const tipOpacity = interpolate(frame, [timing.drawStartFrame - 5, timing.drawStartFrame, timing.drawEndFrame - 5, timing.drawEndFrame], [0, 1, 1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const completionPulse = interpolate(frame, [timing.drawEndFrame - 3, timing.drawEndFrame + 4, timing.outroTransitionStartFrame], [0, 1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const formulaHtml = katex.renderToString(formatFormulaForDisplay(formula), {throwOnError: false, displayMode: true});
  const coverFormulaHtml = katex.renderToString(formatFormulaForDisplay(coverFormula), {throwOnError: false, displayMode: true});
  const outroTransitionOpacity = interpolate(frame, [timing.outroTransitionStartFrame, timing.outroStartFrame], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const outroFrame = frame - timing.outroTransitionStartFrame;
  return <AbsoluteFill style={{backgroundColor: theme.background, color: theme.ink, fontFamily: "Studio Sans, Arial, sans-serif"}}>
    <Audio src={staticFile(props.musicSrc.replace(/^profile-assets\//, "profile-assets/"))} loop volume={0.12} />
    <svg width={1080} height={canvasHeight} viewBox={"0 0 1080 " + canvasHeight} style={{position: "absolute", inset: 0}}>
      <defs>
        <filter id={`math-glow-${props.formula.id}`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="13" /></filter>
        <clipPath id={`math-guides-clip-${props.formula.id}`}><rect x={bounds.left} y={bounds.top} width={bounds.width} height={bounds.height} /></clipPath>
        <pattern id={`math-grid-${props.formula.id}`} width="84" height="84" patternUnits="userSpaceOnUse">
          <path d="M 84 0 L 0 0 0 84" fill="none" stroke={theme.grid} strokeWidth="1" />
        </pattern>
        <radialGradient id={`math-halo-${props.formula.id}`} cx="50%" cy="50%" r="58%">
          <stop offset="0%" stopColor={theme.curveLight} stopOpacity={theme.isDark ? 0.1 : 0.08} />
          <stop offset="72%" stopColor={theme.curveLight} stopOpacity={theme.isDark ? 0.035 : 0.02} />
          <stop offset="100%" stopColor={theme.curveLight} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={1080} height={canvasHeight} fill={theme.background} />
      <rect width={1080} height={canvasHeight} fill={`url(#math-grid-${props.formula.id})`} opacity={theme.gridOpacity} />
      <ellipse cx={centerX} cy={centerY} rx={bounds.width * 0.7} ry={bounds.height * 0.66} fill={`url(#math-halo-${props.formula.id})`} />
      <g clipPath={`url(#math-guides-clip-${props.formula.id})`}>
        <MathCurveGuides bounds={bounds} origin={fittedGeometry.coordinateOrigin} point={points[0]} profile={effectProfile} reveal={coverOpacity} tangentAngle={tangentAngle} theme={theme} visualCenter={fittedGeometry.visualCenter} />
        <MathCurveGuides bounds={bounds} origin={fittedGeometry.coordinateOrigin} point={tipPoint} profile={effectProfile} reveal={fade * (1 - coverOpacity)} tangentAngle={tangentAngle} theme={theme} visualCenter={fittedGeometry.visualCenter} />
      </g>
      <circle cx={points[0].x} cy={points[0].y} r={16} fill={theme.accent} opacity={0.16 * coverOpacity} filter={`url(#math-glow-${props.formula.id})`} />
      <circle cx={points[0].x} cy={points[0].y} r={6} fill={theme.accent} opacity={coverOpacity} />
      <path d={coverPath} fill="none" stroke={theme.curve} strokeWidth={24} strokeLinecap="round" opacity={theme.curveGlowOpacity * coverOpacity} filter={`url(#math-glow-${props.formula.id})`} />
      <path d={coverPath} fill="none" stroke={theme.curve} strokeWidth={5} strokeLinecap="round" opacity={coverOpacity} />
      <path d={coverPath} fill="none" stroke={theme.trace} strokeWidth={3} strokeLinecap="round" opacity={0.13 * graphFade * (1 - coverOpacity)} strokeDasharray="5 12" />
      <path d={path} fill="none" stroke={theme.curve} strokeWidth={24} strokeLinecap="round" opacity={theme.curveGlowOpacity * graphFade * (1 - coverOpacity)} filter={`url(#math-glow-${props.formula.id})`} />
      <path d={path} fill="none" stroke={theme.curve} strokeWidth={5} strokeLinecap="round" opacity={graphFade * (1 - coverOpacity)} />
      <g clipPath={`url(#math-guides-clip-${props.formula.id})`}>
        <MathCoordinateFrame bounds={bounds} coordinate={tipCoordinate} origin={fittedGeometry.coordinateOrigin} point={tipPoint} progress={animatedProgress} reveal={Math.max(coverOpacity * 0.7, fade * (1 - coverOpacity))} theme={theme} />
      </g>
      <path d={trailPath} fill="none" stroke={theme.traceHighlight} strokeWidth={18} strokeLinecap="round" opacity={theme.curveGlowOpacity * 1.7 * tipOpacity} filter={`url(#math-glow-${props.formula.id})`} />
      <path d={trailPath} fill="none" stroke={theme.traceHighlight} strokeWidth={7} strokeLinecap="round" opacity={0.82 * tipOpacity} />
      <circle cx={tipPoint.x} cy={tipPoint.y} r={25} fill={theme.traceHighlight} opacity={0.22 * tipOpacity} filter={`url(#math-glow-${props.formula.id})`} />
      <circle cx={tipPoint.x} cy={tipPoint.y} r={8} fill={theme.traceHighlight} opacity={tipOpacity} />
      <circle cx={tipPoint.x} cy={tipPoint.y} r={9 + completionPulse * 34} fill="none" stroke={theme.traceHighlight} strokeWidth={3} opacity={completionPulse * 0.72} />
      <path d={coverPath} fill="none" stroke={theme.traceHighlight} strokeWidth={8 + completionPulse * 4} strokeLinecap="round" opacity={completionPulse * 0.52} filter={`url(#math-glow-${props.formula.id})`} />
    </svg>
    <div aria-hidden="true" style={{position: "absolute", left: 0, right: 0, bottom: layout.gradientBottom, height: layout.gradientHeight, background: `linear-gradient(180deg, transparent, ${theme.footerWash})`, borderTop: `1px solid ${theme.footerBorder}`, pointerEvents: "none"}} />
    <div style={{position: "absolute", top: layout.brandTop, left: 72, right: 72, height: layout.brandHeight, border: `1px solid ${theme.surfaceBorder}`, borderLeft: `8px solid ${theme.accent}`, borderRadius: 18, background: theme.surface, boxShadow: theme.surfaceShadow, display: "flex", alignItems: "center", justifyContent: "center", gap: compactLayout ? 12 : 16, color: theme.ink}}>
      <span style={{alignItems: "center", backgroundColor: theme.accent, borderRadius: 10, color: theme.accentText, display: "inline-flex", fontFamily: "Georgia, serif", fontSize: 33, fontWeight: 700, height: 52, justifyContent: "center", width: 52}}>∑</span>
      <span style={{fontSize: 34, fontWeight: 820, letterSpacing: .4}}>Tech123</span>
      <span style={{color: theme.accent, fontSize: 27}}>·</span>
      <span style={{color: theme.muted, fontSize: 31, fontWeight: 620, letterSpacing: 2}}>数学之美</span>
    </div>
    <div style={{position: "absolute", top: layout.formulaTop, left: 72, right: 72, textAlign: "center", color: theme.formula, fontSize: compactLayout ? 28 : 32, opacity: Math.max(0.72, fade) * (1 - coverOpacity)}} dangerouslySetInnerHTML={{__html: formulaHtml}} />
    <div style={{position: "absolute", top: layout.formulaTop, left: 72, right: 72, textAlign: "center", color: theme.formula, fontSize: compactLayout ? 28 : 32, opacity: coverOpacity}} dangerouslySetInnerHTML={{__html: coverFormulaHtml}} />
    <div style={{position: "absolute", left: 72, right: 72, bottom: layout.labelBottom, textAlign: "center", color: theme.muted, fontSize: compactLayout ? 21 : 24, letterSpacing: 3, textTransform: "uppercase"}}>{definition.name}</div>
    <div style={{position: "absolute", left: 72, right: 72, bottom: layout.taglineBottom, textAlign: "center", color: theme.tagline, fontSize: compactLayout ? 16 : 18}}>Math is beautiful</div>
    {frame >= timing.outroTransitionStartFrame ? <div style={{position: "absolute", inset: 0, zIndex: 9, opacity: outroTransitionOpacity}}>
      <MathOutro
        brand={props.brand}
        variant={props.outroVariant}
        outroFrame={outroFrame}
        outroFrames={timing.outroFrames}
        canvasHeight={canvasHeight}
      />
    </div> : null}
  </AbsoluteFill>;
};
