import {SANS_FONT_FAMILY} from "../typography";
import type {CSSProperties, ReactNode} from "react";
import type {RelationGraphNode} from "./relation-graph-schema";
import {VIDEO_COLORS, VIDEO_SHADOW} from "../theme";
import {normalizeRelationGraphCardScale, normalizeRelationGraphIconAspectRatio, normalizeRelationGraphIconSize, normalizeRelationGraphTextColor, normalizeRelationGraphTextFontSize, normalizeRelationGraphTextStyle, relationGraphNodeContentScale, relationGraphNodeGeometry, relationGraphNodeLabelMaxWidth} from "./relation-graph";
import {graphPalettes, graphShapeInsets, graphShapePaths} from "./relation-graph-elements";

type NodeBodyProps = {node: RelationGraphNode; visibleText?: string; renderImage: (src: string, style: CSSProperties) => ReactNode};
/** 静态节点主体同源；媒体标签由编辑器和 Remotion 分别注入。 */
export const RelationGraphNodeBody = ({node, visibleText = node.data.text ?? node.data.label ?? "", renderImage}: NodeBodyProps) => {
  const box = relationGraphNodeGeometry(node);
  const icon = node.data.icon;
  const palette = node.data.palette ? graphPalettes[node.data.palette] : undefined;
  if (node.data.shape && node.type !== "frame" && node.type !== "text") return <ShapeNodeBody node={node} renderImage={renderImage} />;
  if (node.type === "frame") {
    const palette = node.data.palette ? graphPalettes[node.data.palette] : null;
    return <div style={{fontFamily: SANS_FONT_FAMILY, background: palette ? `${palette.fill}88` : "rgba(225, 238, 230, 0.28)", border: `3px dashed ${palette?.stroke ?? "#7DA894"}`, borderRadius: 16, boxSizing: "border-box", color: palette?.ink ?? "#4d6b5a", height: box.height, position: "relative", width: box.width}}><div style={{background: palette?.fill ?? "#edf7f1", borderRadius: 6, fontSize: normalizeRelationGraphTextFontSize(node.data.frameFontSize), fontWeight: 700, lineHeight: 1.2, padding: "4px 8px", position: "absolute", left: 12, top: -27}}>{node.data.label ?? "外框"}</div></div>;
  }
  const textNode = node.type === "text";
  const largeIcon = node.data.presentation === "large-icon";
  const cardScale = normalizeRelationGraphCardScale(node.data.cardScale);
  const hasLabel = Boolean(node.data.label);
  const iconOnlyCard = !largeIcon && Boolean(icon) && !hasLabel;
  const iconSize = normalizeRelationGraphIconSize(node.data.iconSize);
  const iconWidth = iconSize * normalizeRelationGraphIconAspectRatio(icon?.aspectRatio);
  const contentScale = relationGraphNodeContentScale(node, box);
  // 文本样式使用内联定义，离线渲染不再依赖工作台的全局 CSS。
  if (textNode) {
    const textStyle = normalizeRelationGraphTextStyle(node.data.textStyle);
    const plain = textStyle === "plain";
    const bubble = textStyle === "bubble-left" || textStyle === "bubble-right";
    return <div style={{fontFamily: SANS_FONT_FAMILY, position: "relative", isolation: "isolate", boxSizing: "border-box", width: box.width, height: box.height, color: normalizeRelationGraphTextColor(node.data.textColor), background: plain ? "transparent" : palette?.fill ?? "#fff", border: `2px solid ${plain ? "transparent" : "currentColor"}`, borderRadius: 16, boxShadow: plain ? "none" : VIDEO_SHADOW.card, display: "flex", alignItems: "center", justifyContent: plain ? "flex-start" : "center", padding: plain ? 0 : 16, textAlign: "left"}}>
      {bubble ? <span style={{background: palette?.fill ?? "#fff", border: "2px solid currentColor", borderRight: textStyle === "bubble-left" ? 0 : undefined, borderTop: textStyle === "bubble-left" ? 0 : undefined, borderBottom: textStyle === "bubble-right" ? 0 : undefined, borderLeft: textStyle === "bubble-right" ? 0 : undefined, position: "absolute", width: 16, height: 16, top: "25%", left: textStyle === "bubble-left" ? -9 : undefined, right: textStyle === "bubble-right" ? -9 : undefined, transform: "rotate(45deg)", zIndex: -1}} /> : null}
      <div style={{fontSize: normalizeRelationGraphTextFontSize(node.data.textFontSize) * contentScale, fontWeight: 650, lineHeight: 1.35, maxWidth: relationGraphNodeLabelMaxWidth(node, box), whiteSpace: "pre-wrap", overflowWrap: "anywhere"}}>{visibleText}</div>
    </div>;
  }
  // 漫画硬阴影不占布局尺寸，显式配色和既有节点几何保持不变。
  return <div style={{fontFamily: SANS_FONT_FAMILY, alignItems: "center", background: largeIcon ? "transparent" : node.type === "group" ? "rgba(225,238,230,.7)" : palette?.fill ?? VIDEO_COLORS.surface, border: largeIcon ? "0 solid transparent" : `2px ${node.type === "group" ? "dashed" : "solid"} ${palette?.stroke ?? VIDEO_COLORS.ink}`, borderRadius: largeIcon ? 0 : 12 * cardScale * contentScale, boxSizing: "border-box", boxShadow: largeIcon || node.type === "group" ? "none" : VIDEO_SHADOW.card, color: palette?.ink ?? VIDEO_COLORS.ink, display: "flex", flexDirection: largeIcon && node.data.labelPlacement === "top" ? "column-reverse" : "column", gap: largeIcon && hasLabel ? 10 * contentScale : 0, height: box.height, justifyContent: "center", overflow: "hidden", padding: largeIcon ? 0 : `${15 * cardScale * contentScale}px ${18 * cardScale * contentScale}px`, position: "relative", textAlign: "center", width: box.width}}>
    {icon ? renderImage(icon.src, {background: "transparent", display: "block", height: largeIcon ? iconSize * contentScale : 42 * cardScale * contentScale, objectFit: "contain", objectPosition: "center", padding: 0, position: largeIcon || iconOnlyCard ? "static" : "absolute", left: largeIcon || iconOnlyCard ? undefined : 12 * cardScale * contentScale, top: largeIcon || iconOnlyCard ? undefined : "50%", translate: largeIcon || iconOnlyCard ? undefined : "0 -50%", width: largeIcon ? iconWidth * contentScale : 42 * cardScale * contentScale}) : null}
    {hasLabel ? <div style={{fontSize: (largeIcon ? 15 : 15 * cardScale) * contentScale, fontWeight: 700, lineHeight: 1.25, maxWidth: relationGraphNodeLabelMaxWidth(node, box), whiteSpace: "pre-wrap"}}>{node.data.label}</div> : null}
  </div>;
};

/** SVG 背景独立于内容层，非等比缩放只改变轮廓，文字与图标保持比例。 */
const ShapeNodeBody = ({node, renderImage}: NodeBodyProps) => {
  const shape = node.data.shape!;
  const box = relationGraphNodeGeometry(node);
  const scale = relationGraphNodeContentScale(node, box);
  // 已配置的调色板原样保留；仅未配置节点使用漫画默认纸面。
  const palette = node.data.palette ? graphPalettes[node.data.palette] : {fill: VIDEO_COLORS.surface, stroke: VIDEO_COLORS.ink, ink: VIDEO_COLORS.ink};
  const insets = graphShapeInsets(shape);
  const paths = graphShapePaths(shape);
  const rich = shape === "info" || shape === "image-card" || shape === "list";
  const imageCard = shape === "image-card";
  const padX = box.width * insets.x, padY = box.height * insets.y;
  return <div style={{fontFamily: SANS_FONT_FAMILY, position: "relative", width: box.width, height: box.height, color: palette.ink, boxSizing: "border-box"}}>
    <svg aria-hidden="true" width={box.width} height={box.height} viewBox="0 0 100 100" preserveAspectRatio="none" style={{position: "absolute", inset: 0, overflow: "visible", filter: "drop-shadow(3px 3px 0 rgba(24,40,32,.55))"}}>
      {paths.length ? paths.map((path, index) => <path key={index} d={path} fill={shape === "cylinder" && index === 1 ? "none" : palette.fill} stroke={palette.stroke} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />) : <rect x="0" y="0" width="100" height="100" rx={(shape === "pill" ? Math.min(box.width, box.height) / 2 : shape === "rectangle" ? 2 : 14 * scale) / box.width * 100} ry={(shape === "pill" ? Math.min(box.width, box.height) / 2 : shape === "rectangle" ? 2 : 14 * scale) / box.height * 100} fill={palette.fill} stroke={palette.stroke} strokeWidth={2} vectorEffect="non-scaling-stroke" />}
    </svg>
    <div style={{position: "absolute", inset: `${padY}px ${padX}px`, display: "flex", flexDirection: "column", alignItems: rich ? "stretch" : "center", justifyContent: "center", gap: 10 * scale, overflow: "hidden", textAlign: rich ? "left" : "center", whiteSpace: "pre-wrap", overflowWrap: "anywhere"}}>
      {node.data.icon ? renderImage(node.data.icon.src, {display: "block", position: "static", transform: "none", padding: 0, background: "transparent", objectFit: "contain", width: imageCard ? "100%" : 40 * scale, height: (imageCard ? 72 : 40) * scale, flexShrink: 0, alignSelf: imageCard ? "stretch" : "center"}) : null}
      {node.data.label ? <div style={{fontSize: 24 * scale, fontWeight: 750, lineHeight: 1.25}}>{node.data.label}</div> : null}
      {rich && node.data.text ? <div style={{fontSize: 18 * scale, lineHeight: 1.45}}>{node.data.text}</div> : null}
      {shape === "list" ? <div style={{display: "grid", gap: 8 * scale, fontSize: 18 * scale, lineHeight: 1.35}}>{(node.data.items ?? []).map((item, index) => <div key={index} style={{display: "flex", gap: 10 * scale}}><span style={{color: palette.stroke}}>•</span><span>{item}</span></div>)}</div> : null}
    </div>
  </div>;
};
