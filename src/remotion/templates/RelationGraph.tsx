import {GraphEdgeLabel, GraphEdgeMarker, graphEdgeMarkers, graphEdgePath, graphMarkerId} from "./RelationGraphEdgeAppearance";
import {RelationGraphNodeBody} from "./RelationGraphNodeBody";
import {Img, Interactive, interpolate, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import {Position} from "@xyflow/react";
import type {Caption, VideoScene} from "../schema";

import {normalizeRelationGraphEdgeType, normalizeRelationGraphStrokeColor, normalizeRelationGraphStrokeStyle, normalizeRelationGraphStrokeWidth, parseRelationGraphData, relationGraphHandlePoint, relationGraphNodeCue, relationGraphNodeGeometry, relationGraphVisibleText, RELATION_GRAPH_CANVAS_HEIGHT, RELATION_GRAPH_CANVAS_WIDTH, resolveRelationGraphCue, type RelationGraphHandleDirection} from "./relation-graph";

// 渲染端复用关系图共享几何计算，避免编辑器与成片的节点尺寸、连线锚点分叉。
const GRAPH_WIDTH = RELATION_GRAPH_CANVAS_WIDTH;
const GRAPH_HEIGHT = RELATION_GRAPH_CANVAS_HEIGHT;
const entranceDurationMs = 360;

const resolveIconSource = (source: string) => /^(?:https?:\/\/|data:|\/)/u.test(source) ? source : staticFile(source);

const nodeProgress = (nowMs: number, cue: ReturnType<typeof relationGraphNodeCue>) => {
  if (!cue) return 1;
  return interpolate(nowMs, [cue.startMs, cue.startMs + entranceDurationMs], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
};

const positionForDirection = (direction: RelationGraphHandleDirection) => direction === "top" ? Position.Top : direction === "right" ? Position.Right : direction === "bottom" ? Position.Bottom : Position.Left;

const relationEdgePath = (source: {x: number; y: number; width: number; height: number}, target: {x: number; y: number; width: number; height: number}, sourceHandle: RelationGraphHandleDirection, targetHandle: RelationGraphHandleDirection, type: string) => {
  // 成片复用 React Flow 的路径算法，确保三种连接方式与编辑器一致。
  const sourcePoint = relationGraphHandlePoint(source, sourceHandle);
  const targetPoint = relationGraphHandlePoint(target, targetHandle);
  const params = {sourcePosition: positionForDirection(sourceHandle), sourceX: sourcePoint.x, sourceY: sourcePoint.y, targetPosition: positionForDirection(targetHandle), targetX: targetPoint.x, targetY: targetPoint.y};
  const [path, labelX, labelY] = graphEdgePath(params, type);
  return {path, labelX, labelY};
};

/** 关系图只读取标准化节点数据；React Flow 仅用于编辑，最终画面由 Remotion 独立绘制。 */
export const RelationGraph: React.FC<{scene: VideoScene; captions: Caption[]}> = ({scene, captions}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const data = parseRelationGraphData(scene, scene.templateData);
  const nowMs = scene.startMs + frame / fps * 1000;
  const progressById = new Map(data.nodes.map((node) => [node.id, nodeProgress(nowMs, relationGraphNodeCue(scene, captions, node))]));
  const nodeById = new Map(data.nodes.map((node) => [node.id, node]));
  const frameNodes = data.nodes.filter((node) => node.type === "frame");
  // 节点位置保存于 1080×900 画布；连接层不能再随外层可用宽度单独缩放。
  return <Interactive.Div name="Relation graph" style={{height: GRAPH_HEIGHT, position: "relative", width: GRAPH_WIDTH}}>
    {/* 外框先于连线和节点绘制，成员节点仍使用原坐标，保证外框只是视觉分组。 */}
    {frameNodes.map((node) => {
      const box = relationGraphNodeGeometry(node);
      // 旧外框保持常显；新预设外框可随自己的口播出现，成员仍独立计时。
      const opacity = node.data.palette ? progressById.get(node.id) ?? 1 : 1;
      return <Interactive.Div key={node.id} name={`Relation frame ${node.data.label ?? node.id}`} style={{height: box.height, left: box.x, position: "absolute", top: box.y, width: box.width, zIndex: 0, opacity}}><RelationGraphNodeBody node={node} renderImage={(src, style) => <Img src={resolveIconSource(src)} style={style} />} /></Interactive.Div>;
    })}
    <svg aria-hidden="true" height={GRAPH_HEIGHT} preserveAspectRatio="none" style={{height: GRAPH_HEIGHT, left: 0, overflow: "visible", position: "absolute", top: 0, width: GRAPH_WIDTH}} viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} width={GRAPH_WIDTH}>
      {data.edges.map((edge) => {
        const source = nodeById.get(edge.source); const target = nodeById.get(edge.target);
        if (!source || !target) return null;
        const sourceGeometry = relationGraphNodeGeometry(source); const targetGeometry = relationGraphNodeGeometry(target);
        const sourceProgress = progressById.get(source.id) ?? 1; const targetProgress = progressById.get(target.id) ?? 1;
        // 入场位移也参与端点计算，连接线始终跟随正在出现的节点。
        const sourceBox = {...sourceGeometry, y: sourceGeometry.y + (source.type === "frame" ? 0 : (1 - sourceProgress) * 28)};
        const targetBox = {...targetGeometry, y: targetGeometry.y + (target.type === "frame" ? 0 : (1 - targetProgress) * 28)};
        const visible = sourceProgress > 0 && targetProgress > 0;
        const length = Math.max(1, Math.hypot(targetGeometry.x - sourceGeometry.x, targetGeometry.y - sourceGeometry.y));
        const edgeCue = resolveRelationGraphCue({scene, captions, text: edge.cueText, occurrence: edge.cueOccurrence});
        const lineStartMs = edgeCue?.startMs ?? scene.startMs;
        const lineProgress = interpolate(nowMs, [lineStartMs, lineStartMs + Math.max(1, length * 1.5)], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
        const sourceHandle = edge.sourceHandle;
        const targetHandle = edge.targetHandle;
        const edgePath = relationEdgePath(sourceBox, targetBox, sourceHandle, targetHandle, normalizeRelationGraphEdgeType(edge.type));
        const strokeColor = normalizeRelationGraphStrokeColor(edge.strokeColor);
        const strokeStyle = normalizeRelationGraphStrokeStyle(edge.strokeStyle);
        const markerId = graphMarkerId("render-arrow", `${scene.id}:${edge.id}`);
        return <g key={edge.id} opacity={visible ? lineProgress : 0}>
          <GraphEdgeMarker id={markerId} color={strokeColor} />
          <path d={edgePath.path} fill="none" {...graphEdgeMarkers(markerId, edge.arrowType)} stroke={strokeColor} strokeDasharray={strokeStyle === "dashed" ? "10 10" : undefined} strokeDashoffset={strokeStyle === "dashed" && visible ? -frame * 1.5 : 0} strokeLinecap="round" strokeLinejoin="round" strokeWidth={normalizeRelationGraphStrokeWidth(edge.strokeWidth)} opacity={0.95} />
          {edge.label ? <g transform={`translate(${edgePath.labelX} ${edgePath.labelY})`}>
            <GraphEdgeLabel label={edge.label} fontSize={edge.labelFontSize} showBox={edge.showLabelBox} />
          </g> : null}
        </g>;
      })}
    </svg>
    {data.nodes.filter((node) => node.type !== "frame").map((node) => {
      const box = relationGraphNodeGeometry(node);
      const progress = progressById.get(node.id) ?? 1;
      const visibleText = relationGraphVisibleText(node.data.text ?? node.data.label ?? "", nowMs, relationGraphNodeCue(scene, captions, node), node.data.textAnimation);
      return <Interactive.Div key={node.id} name={`Relation node ${node.data.label ?? node.id}`} style={{position: "absolute", left: box.x, top: box.y, width: box.width, height: box.height, opacity: progress, translate: `0px ${(1 - progress) * 28}px`}}>
        <RelationGraphNodeBody node={node} visibleText={visibleText} renderImage={(src, style) => <Img src={resolveIconSource(src)} style={style} />} />
      </Interactive.Div>;
    })}
  </Interactive.Div>;
};
