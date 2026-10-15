import {VIDEO_COLORS} from "../theme";
import {SANS_FONT_FAMILY} from "../typography";
import {getSimpleBezierPath, getSmoothStepPath, getStraightPath, type Position} from "@xyflow/react";
import {normalizeRelationGraphArrowType, normalizeRelationGraphLabelFontSize, relationGraphLabelLayout} from "./relation-graph";

// 标识只含 ASCII，避免 URL 片段转义导致箭头引用失效。
export const graphMarkerId = (prefix: string, id: string) => `${prefix}-${Array.from(id, (char) => char.codePointAt(0)!.toString(16)).join("-")}`;

// 同一条边的路径、箭头和标签在编辑器与成片中只维护一份定义。
export const graphEdgePath = (params: {sourceX: number; sourceY: number; targetX: number; targetY: number; sourcePosition: Position; targetPosition: Position}, type: string) => {
  if (type === "straight") return getStraightPath(params);
  if (type === "simplebezier") return getSimpleBezierPath(params);
  return getSmoothStepPath({...params, borderRadius: type === "step" ? 0 : 5, offset: 20});
};
export const graphEdgeMarkers = (id: string, arrowType: string | undefined) => {
  const type = normalizeRelationGraphArrowType(arrowType);
  return {markerStart: type === "both" ? `url(#${id})` : undefined, markerEnd: type === "both" || type === "end" ? `url(#${id})` : undefined};
};
export const GraphEdgeMarker = ({id, color}: {id: string; color: string}) => <defs><marker id={id} markerHeight="8" markerWidth="8" orient="auto-start-reverse" refX="7" refY="4"><path d="M0,0 L8,4 L0,8 Z" fill={color} /></marker></defs>;
// 标签只换描边和纸面颜色，布局宽高仍取共用测量结果。
export const GraphEdgeLabel = ({label, fontSize, showBox}: {label: string; fontSize?: number; showBox?: boolean}) => {
  const size = normalizeRelationGraphLabelFontSize(fontSize);
  const layout = relationGraphLabelLayout(label, size);
  return <g>
    <rect fill={showBox !== false ? VIDEO_COLORS.canvas : "transparent"} height={layout.height} rx={size * .25} stroke={showBox !== false ? VIDEO_COLORS.ink : "transparent"} strokeWidth={1} width={layout.width} x={-layout.width / 2} y={-layout.height / 2} />
    <text fontFamily={SANS_FONT_FAMILY} fill={VIDEO_COLORS.ink} fontSize={size} fontWeight={700} textAnchor="middle" dominantBaseline="central" style={{whiteSpace: "pre"}} y={-((layout.lines.length - 1) * layout.lineHeight) / 2}>{layout.lines.map((line, index) => <tspan key={index} x={0} dy={index === 0 ? 0 : layout.lineHeight}>{line}</tspan>)}</text>
  </g>;
};
