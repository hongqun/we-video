import type {FormulaDefinition, MathFormulaId, Point} from "../math/formulas";
import type {MathTheme} from "./math-theme";

export type MathEffectProfile = "cartesian" | "closed" | "parametric" | "polar" | "roulette" | "spiral";

const CARTESIAN_IDS = new Set<MathFormulaId>([
  "sine", "amplitude-modulated", "frequency-modulated", "beat-wave", "catenary", "witch-of-agnesi",
  "kampyle", "tschirnhausen-cubic", "dumbbell", "bullet-nose", "gaussian", "damped-sine", "sinc",
  "logistic", "bessel-j0", "sech-envelope", "wave-packet", "tangent-wave", "dual-sine", "crown",
  "multi-frequency",
]);

const SPIRAL_IDS = new Set<MathFormulaId>([
  "archimedean-spiral", "logarithmic-spiral", "euler-spiral", "fermat-spiral", "lituus",
  "hyperbolic-spiral", "poinsot-spiral", "sinusoidal-spiral", "cotes-spiral", "golden-spiral",
  "spiral-parabola", "spiral-astroid", "fresnel",
]);

const PARAMETRIC_IDS = new Set<MathFormulaId>([
  "lissajous", "harmonograph", "parametric-heart", "algebraic-heart", "parabolic-heart", "cubic-bezier",
  "elliptic-phase", "trefoil-projection", "figure-eight-projection", "bicuspid", "fish", "bow", "talbot",
]);

export const getMathEffectProfile = (definition: FormulaDefinition): MathEffectProfile => {
  if (CARTESIAN_IDS.has(definition.id)) return "cartesian";
  if (SPIRAL_IDS.has(definition.id)) return "spiral";
  if (PARAMETRIC_IDS.has(definition.id)) return "parametric";
  if (definition.category.includes("旋轮") || definition.id === "involute" || definition.id === "cycloid") return "roulette";
  if (definition.category.includes("极坐标") || definition.id === "polar") return "polar";
  return "closed";
};

type Bounds = {left: number; top: number; width: number; height: number};

type Props = {
  bounds: Bounds;
  origin: Point;
  point: Point;
  profile: MathEffectProfile;
  reveal: number;
  tangentAngle: number;
  theme: MathTheme;
  visualCenter: Point;
};

const radialSpokes = Array.from({length: 12}, (_, index) => index * Math.PI / 6);
const horizontalTicks = Array.from({length: 9}, (_, index) => index / 8);
const verticalTicks = Array.from({length: 7}, (_, index) => index / 6);

const formatCoordinate = (value: number) => {
  const magnitude = Math.abs(value);
  if (magnitude >= 10_000 || (magnitude > 0 && magnitude < 0.001)) return value.toExponential(2);
  return value.toFixed(2);
};

type CoordinateFrameProps = {
  bounds: Bounds;
  coordinate: Point;
  origin: Point;
  point: Point;
  progress: number;
  reveal: number;
  theme: MathTheme;
};

export const MathCoordinateFrame: React.FC<CoordinateFrameProps> = ({bounds, coordinate, origin, point, progress, reveal, theme}) => {
  const right = bounds.left + bounds.width;
  const bottom = bounds.top + bounds.height;
  const originVisible = origin.x >= bounds.left && origin.x <= right && origin.y >= bounds.top && origin.y <= bottom;
  const xLabelY = Math.min(bottom - 12, Math.max(bounds.top + 24, origin.y - 12));
  const yLabelX = Math.min(right - 24, Math.max(bounds.left + 12, origin.x + 12));

  return <g opacity={0.72 * reveal}>
    <rect x={bounds.left + 1} y={bounds.top + 1} width={bounds.width - 2} height={bounds.height - 2} rx={18} fill="none" stroke={theme.guide} strokeWidth={2} opacity={0.42} />
    {horizontalTicks.map((tick) => <g key={`frame-x-${tick}`} stroke={theme.guide} strokeWidth={1.5} opacity={0.58}>
      <line x1={bounds.left + bounds.width * tick} y1={bounds.top} x2={bounds.left + bounds.width * tick} y2={bounds.top + 10} />
      <line x1={bounds.left + bounds.width * tick} y1={bottom - 10} x2={bounds.left + bounds.width * tick} y2={bottom} />
    </g>)}
    {verticalTicks.map((tick) => <g key={`frame-y-${tick}`} stroke={theme.guide} strokeWidth={1.5} opacity={0.58}>
      <line x1={bounds.left} y1={bounds.top + bounds.height * tick} x2={bounds.left + 10} y2={bounds.top + bounds.height * tick} />
      <line x1={right - 10} y1={bounds.top + bounds.height * tick} x2={right} y2={bounds.top + bounds.height * tick} />
    </g>)}
    <line x1={bounds.left} y1={origin.y} x2={right} y2={origin.y} stroke={theme.axis} strokeWidth={2} strokeDasharray="12 16" opacity={0.78} />
    <line x1={origin.x} y1={bounds.top} x2={origin.x} y2={bottom} stroke={theme.axis} strokeWidth={2} strokeDasharray="12 16" opacity={0.78} />
    {originVisible ? <circle cx={origin.x} cy={origin.y} r={5} fill={theme.axis} /> : null}
    <text x={right - 24} y={xLabelY} fill={theme.axis} fontFamily="Georgia, serif" fontSize={22} fontStyle="italic">x</text>
    <text x={yLabelX} y={bounds.top + 24} fill={theme.axis} fontFamily="Georgia, serif" fontSize={22} fontStyle="italic">y</text>
    <g opacity={Math.min(1, reveal * 1.35)}>
      <rect x={bounds.left + 18} y={bounds.top + 18} width={310} height={70} rx={14} fill={theme.surface} stroke={theme.surfaceBorder} strokeWidth={1.5} />
      <circle cx={bounds.left + 38} cy={bounds.top + 40} r={5} fill={theme.traceHighlight} />
      <text x={bounds.left + 52} y={bounds.top + 47} fill={theme.muted} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize={18}>u = {progress.toFixed(3)}</text>
      <text x={bounds.left + 36} y={bounds.top + 74} fill={theme.formula} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize={18}>P(u) = ({formatCoordinate(coordinate.x)}, {formatCoordinate(coordinate.y)})</text>
    </g>
    <line x1={point.x} y1={point.y} x2={point.x} y2={origin.y} stroke={theme.trace} strokeWidth={1.5} strokeDasharray="4 10" opacity={0.38} />
    <line x1={point.x} y1={point.y} x2={origin.x} y2={point.y} stroke={theme.trace} strokeWidth={1.5} strokeDasharray="4 10" opacity={0.28} />
  </g>;
};

export const MathCurveGuides: React.FC<Props> = ({bounds, origin, point, profile, reveal, tangentAngle, theme, visualCenter}) => {
  const tangentRadius = profile === "roulette" ? 86 : 58;
  const tangentX = Math.cos(tangentAngle) * tangentRadius;
  const tangentY = Math.sin(tangentAngle) * tangentRadius;
  const guideOpacity = 0.64 * reveal;

  if (profile === "cartesian") {
    return <g fill="none" stroke={theme.guide} opacity={guideOpacity}>
      <circle cx={point.x} cy={point.y} r={13} stroke={theme.trace} strokeWidth={2} strokeDasharray="4 7" opacity={0.82} />
    </g>;
  }

  if (profile === "polar") {
    return <g fill="none" opacity={guideOpacity}>
      {radialSpokes.map((angle) => <line key={angle} x1={origin.x} y1={origin.y} x2={origin.x + Math.cos(angle) * bounds.width * 0.48} y2={origin.y + Math.sin(angle) * bounds.height * 0.48} stroke={theme.guide} strokeWidth={1.5} strokeDasharray="4 14" opacity={0.42} />)}
      <circle cx={origin.x} cy={origin.y} r={Math.min(bounds.width, bounds.height) * 0.25} stroke={theme.guide} strokeWidth={2} strokeDasharray="8 14" opacity={0.7} />
      <line x1={origin.x} y1={origin.y} x2={point.x} y2={point.y} stroke={theme.trace} strokeWidth={2.5} strokeDasharray="7 9" />
      <circle cx={origin.x} cy={origin.y} r={5} fill={theme.axis} stroke="none" />
    </g>;
  }

  if (profile === "spiral") {
    return <g fill="none" opacity={guideOpacity}>
      {[0.14, 0.28, 0.42].map((ratio) => <ellipse key={ratio} cx={origin.x} cy={origin.y} rx={bounds.width * ratio} ry={bounds.height * ratio} stroke={theme.guide} strokeWidth={1.8} strokeDasharray="7 13" opacity={0.58} />)}
      <line x1={origin.x} y1={origin.y} x2={point.x} y2={point.y} stroke={theme.trace} strokeWidth={2.5} strokeDasharray="7 9" />
      <circle cx={origin.x} cy={origin.y} r={7} fill={theme.axis} stroke="none" />
    </g>;
  }

  if (profile === "roulette") {
    return <g fill="none" opacity={guideOpacity}>
      <circle cx={point.x} cy={point.y} r={42} stroke={theme.guide} strokeWidth={2} strokeDasharray="6 10" opacity={0.72} />
      <line x1={point.x - tangentX} y1={point.y - tangentY} x2={point.x + tangentX} y2={point.y + tangentY} stroke={theme.trace} strokeWidth={2.5} />
      <circle cx={point.x} cy={point.y} r={5} fill={theme.axis} stroke="none" />
    </g>;
  }

  if (profile === "parametric") {
    return <g fill="none" opacity={guideOpacity}>
      <ellipse cx={visualCenter.x} cy={visualCenter.y} rx={bounds.width * 0.45} ry={bounds.height * 0.45} stroke={theme.guide} strokeWidth={2} strokeDasharray="8 14" opacity={0.48} />
      <line x1={point.x - tangentX} y1={point.y - tangentY} x2={point.x + tangentX} y2={point.y + tangentY} stroke={theme.trace} strokeWidth={2.5} />
    </g>;
  }

  return <g fill="none" opacity={guideOpacity}>
    <ellipse cx={visualCenter.x} cy={visualCenter.y} rx={bounds.width * 0.34} ry={bounds.height * 0.34} stroke={theme.guide} strokeWidth={2} strokeDasharray="8 14" opacity={0.68} />
    <line x1={point.x - tangentX} y1={point.y - tangentY} x2={point.x + tangentX} y2={point.y + tangentY} stroke={theme.trace} strokeWidth={2.5} opacity={0.88} />
  </g>;
};
