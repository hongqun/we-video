"use client";

import "@xyflow/react/dist/style.css";
import {createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties} from "react";
import {addEdge, Background, BaseEdge, EdgeLabelRenderer, Handle, NodeResizeControl, NodeToolbar, Position, ReactFlow, useUpdateNodeInternals, useEdgesState, useNodesState, type Connection, type Edge, type EdgeProps, type Node, type NodeProps, type ReactFlowInstance} from "@xyflow/react";
import {GraphEdgeLabel, GraphEdgeMarker, graphEdgeMarkers, graphEdgePath, graphMarkerId} from "@/remotion/templates/RelationGraphEdgeAppearance";
import {RelationGraphNodeBody} from "@/remotion/templates/RelationGraphNodeBody";
import {createGraphElement, graphElements, graphPalettes, graphShapeAnchor, graphShapeOptions, type GraphElement} from "@/remotion/templates/relation-graph-elements";
import {RELATION_GRAPH_DEFAULT_STROKE_COLOR, arrangeGraphNodes, type GraphArrange} from "@/remotion/templates/relation-graph";
import type {Caption, VideoScene} from "@/remotion/schema";
import {searchLocalIcons} from "@/lib/icon-catalog";
import {cloneRelationGraphData, copyRelationGraphSelection, normalizeRelationGraphArrowType, normalizeRelationGraphEdgeType, normalizeRelationGraphIconSize, normalizeRelationGraphLabelFontSize, normalizeRelationGraphNodeHeight, normalizeRelationGraphNodeWidth, normalizeRelationGraphStrokeColor, normalizeRelationGraphStrokeStyle, normalizeRelationGraphStrokeWidth, normalizeRelationGraphTextFontSize, relationGraphDirectionFromHandleId, relationGraphHandleId, relationGraphLabelLayout, relationGraphNodeCue, relationGraphNodeDisplayName, relationGraphNodeGeometry, relationGraphStrokeColorOptions, relationGraphTextColorOptions, RELATION_GRAPH_CANVAS_HEIGHT, RELATION_GRAPH_CANVAS_WIDTH, type RelationGraphData, type RelationGraphHandleDirection, type RelationGraphNode} from "@/remotion/templates/relation-graph";

type RelationNodeProps = NodeProps<Node<RelationGraphNode["data"], RelationGraphNode["type"]>>;
type RelationFlowNode = Node<RelationGraphNode["data"], RelationGraphNode["type"]>;
type RelationFlowEdge = Edge & {cueText?: string; cueOccurrence?: number; labelFontSize?: number; showLabelBox?: boolean; strokeStyle?: "solid" | "dashed"; strokeWidth?: number; strokeColor?: string; arrowType?: "none" | "end" | "both"};
type RelationEditorEdgeProps = EdgeProps<RelationFlowEdge> & {data?: RelationFlowEdge & {relationType?: string}};
const relationResizeCommitContext = createContext<((nodeId: string, width: number, height: number) => void) | null>(null);
// 页面内的关系图编辑器共享剪贴板，场景切换时仍可把结构粘贴到新实例。
let relationGraphClipboard: RelationGraphData | null = null;
const relationNodeTypes = {default: RelationNode, input: RelationNode, output: RelationNode, group: RelationNode, frame: RelationNode, text: RelationNode};
const relationEditorEdgeTypes = {relation: RelationEditorEdge};
// 编辑器拖动节点时按背景网格对齐；该交互配置只存在于 React Flow 编辑端。
const relationSnapGrid: [number, number] = [24, 24];
const relationHandleConfigs: Array<{direction: RelationGraphHandleDirection; position: Position}> = [{direction: "top", position: Position.Top}, {direction: "right", position: Position.Right}, {direction: "bottom", position: Position.Bottom}, {direction: "left", position: Position.Left}];
const relationResizePositions = ["top", "right", "bottom", "left", "top-left", "top-right", "bottom-left", "bottom-right"] as const;

// 编辑器标签使用共享 SVG，文字换行和箭头尺寸与成片完全同源。
function RelationEditorEdge({id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data, label}: RelationEditorEdgeProps) {
  const [path, labelX, labelY] = graphEdgePath({sourcePosition, sourceX, sourceY, targetPosition, targetX, targetY}, normalizeRelationGraphEdgeType(data?.relationType));
  const text = typeof label === "string" ? label : "";
  const layout = relationGraphLabelLayout(text, data?.labelFontSize);
  const markerId = graphMarkerId("editor-arrow", id);
  return <>
    <GraphEdgeMarker id={markerId} color={normalizeRelationGraphStrokeColor(data?.strokeColor)} />
    <BaseEdge id={id} path={path} {...graphEdgeMarkers(markerId, data?.arrowType)} style={style} />
    {text ? <EdgeLabelRenderer><svg width={layout.width} height={layout.height} style={{position: "absolute", overflow: "visible", pointerEvents: "none", transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`}}><g transform={`translate(${layout.width / 2} ${layout.height / 2})`}><GraphEdgeLabel label={text} fontSize={data?.labelFontSize} showBox={data?.showLabelBox} /></g></svg></EdgeLabelRenderer> : null}
  </>;
}

// React Flow 的外层节点也必须拿到业务尺寸，否则会退回默认 150px 宽并污染测量结果。
const toRelationFlowNode = (node: RelationGraphNode): RelationFlowNode => {
  const geometry = relationGraphNodeGeometry(node);
  return {...node, width: geometry.width, height: geometry.height, zIndex: node.type === "frame" ? -1 : undefined};
};

// 原生图片只用于编辑器，位置和比例由共享主体传入。
const renderEditorGraphImage = (src: string, style: CSSProperties) => (
  // eslint-disable-next-line @remotion/warn-native-media-tag -- 编辑器图片不参与离线渲染。
  <img src={/^(?:https?:\/\/|data:|\/)/u.test(src) ? src : `/${src}`} alt="" style={style} />
);

// 操作控件置于共享视觉主体之外，热点不会污染成片，也不被内容裁切。
const RelationHandles = ({node}: {node: RelationGraphNode}) => <>{relationHandleConfigs.flatMap(({direction, position}) => {
  const point = graphShapeAnchor(node.data.shape, direction);
  const style = {left: `${point.x * 100}%`, top: `${point.y * 100}%`, right: "auto", bottom: "auto", transform: "translate(-50%, -50%)"};
  return ["target", "source"].map((kind) => <Handle key={`${direction}-${kind}`} type={kind as "source" | "target"} id={relationGraphHandleId(direction, kind as "source" | "target")} position={position} style={style} className={`relation-graph-handle relation-graph-handle-${kind}`} />);
})}</>;

const relationNodeEditContext = createContext<{disabled: boolean; selectedCount: number; update: (id: string, patch: Partial<RelationGraphNode["data"]>) => void}>({disabled: true, selectedCount: 0, update: () => {}});
function RelationNode({id, data, type, selected}: RelationNodeProps) {
  const commitResize = useContext(relationResizeCommitContext);
  const edit = useContext(relationNodeEditContext);
  const updateNodeInternals = useUpdateNodeInternals();
  const node = {id, data, type, position: {x: 0, y: 0}} as RelationGraphNode;
  const geometry = relationGraphNodeGeometry(node);
  useEffect(() => {
    // 形状切换也会改变锚点，即使宽高相同也要重新测量。
    updateNodeInternals(id);
  }, [geometry.height, geometry.width, data.shape, data.presentation, id, updateNodeInternals]);
  return <div className="relation-flow-shell" style={{width: geometry.width, height: geometry.height, position: "relative"}}>
    <RelationGraphNodeBody node={node} renderImage={renderEditorGraphImage} />
    {type !== "frame" && <RelationHandles node={node} />}
    {selected && !edit.disabled && type !== "group" && relationResizePositions.map((position) => <NodeResizeControl key={position} position={position} style={position === "top" || position === "bottom" ? {left: "calc(50% + 24px)"} : position === "left" || position === "right" ? {top: "calc(50% + 24px)"} : undefined} keepAspectRatio={position.includes("-")} minWidth={1} minHeight={1} onResizeEnd={(_, {width, height}) => commitResize?.(id, width, height)} className="relation-graph-resize-control nodrag nopan" />)}
    <NodeToolbar isVisible={selected && !edit.disabled && edit.selectedCount === 1} position={Position.Top}>
      <div className="relation-shape-toolbar nodrag nopan">
        {type !== "text" && type !== "frame" && type !== "group" ? <select aria-label="形状" value={data.shape ?? (data.presentation === "large-icon" ? "icon" : "legacy")} onChange={(event) => {
          // 切换只改外观，显式保留当前几何与所有内容和绑定。
          const value = event.target.value;
          edit.update(id, {shape: value === "legacy" || value === "icon" ? undefined : value as RelationGraphNode["data"]["shape"], presentation: value === "icon" ? "large-icon" : "card", palette: value === "legacy" ? undefined : data.palette ?? "mint", width: geometry.width, height: geometry.height});
        }}><option value="legacy">原有卡片</option><option value="icon">大图标</option>{graphShapeOptions.map((item) => <option key={item.id} value={item.shape}>{item.label}</option>)}</select> : null}
        {Object.entries(graphPalettes).map(([key, palette]) => <button key={key} type="button" title={palette.label} aria-label={palette.label} aria-pressed={data.palette === key} style={{background: palette.fill, borderColor: palette.stroke}} onClick={() => edit.update(id, {palette: key as RelationGraphNode["data"]["palette"], ...(type === "text" ? {textColor: palette.ink} : {}), ...(type === "default" && !data.shape && data.presentation !== "large-icon" ? {shape: "card", width: geometry.width, height: geometry.height} : {})})} />)}
      </div>
    </NodeToolbar>
  </div>;
}

const toRelationGraph = (nextNodes: Node<RelationGraphNode["data"]>[], nextEdges: RelationFlowEdge[]): RelationGraphData => ({kind: "relation-graph", nodes: nextNodes.map((node) => ({id: node.id, type: node.type as RelationGraphNode["type"], position: node.position, data: node.data})), edges: nextEdges.map((edge) => ({id: edge.id, source: edge.source, target: edge.target, ...(edge.cueText ? {cueText: edge.cueText, cueOccurrence: edge.cueOccurrence} : {}), sourceHandle: relationGraphDirectionFromHandleId(edge.sourceHandle, "right"), targetHandle: relationGraphDirectionFromHandleId(edge.targetHandle, "left"), labelFontSize: normalizeRelationGraphLabelFontSize(typeof edge.labelFontSize === "number" ? edge.labelFontSize : undefined), showLabelBox: edge.showLabelBox !== false, type: normalizeRelationGraphEdgeType(edge.type), strokeStyle: normalizeRelationGraphStrokeStyle(edge.strokeStyle), strokeWidth: normalizeRelationGraphStrokeWidth(edge.strokeWidth), strokeColor: normalizeRelationGraphStrokeColor(edge.strokeColor), arrowType: normalizeRelationGraphArrowType(edge.arrowType), ...(typeof edge.label === "string" && edge.label.trim() ? {label: edge.label} : {})}))});

// 编辑态连线的样式完全来自业务字段，动画只影响显示，不写入关系图数据。
const relationEdgeStyle = (edge: Pick<RelationFlowEdge, "strokeColor" | "strokeStyle" | "strokeWidth">) => {
  const strokeColor = normalizeRelationGraphStrokeColor(edge.strokeColor);
  return {strokeLinecap: "round" as const, strokeLinejoin: "round" as const, opacity: .95, stroke: strokeColor, strokeDasharray: normalizeRelationGraphStrokeStyle(edge.strokeStyle) === "dashed" ? "10 10" : undefined, strokeWidth: normalizeRelationGraphStrokeWidth(edge.strokeWidth)};
};


export const RelationGraphEditor: React.FC<{scene: VideoScene; captions: Caption[]; value: RelationGraphData; onChange: (value: RelationGraphData) => void; currentTimeMs?: number; disabled?: boolean}> = ({scene, captions, value, onChange, currentTimeMs = scene.startMs, disabled = false}) => {
  // React Flow 可能在交互中更新节点对象；编辑器边界先复制，禁止污染父级或其他场景的 visualData。
  const isolatedValue = cloneRelationGraphData(value);
  const [nodes, setNodes, onNodesChange] = useNodesState<RelationFlowNode>(isolatedValue.nodes.map(toRelationFlowNode));
  const [edges, setEdges, onEdgesChange] = useEdgesState<RelationFlowEdge>(isolatedValue.edges as RelationFlowEdge[]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [nodeDialogId, setNodeDialogId] = useState<string | null>(null);
  const [edgeDialogId, setEdgeDialogId] = useState<string | null>(null);
  const [elementSearch, setElementSearch] = useState("");
  const [elementCategory, setElementCategory] = useState("全部");
  const [search, setSearch] = useState("");
  const [iconResults, setIconResults] = useState<ReturnType<typeof searchLocalIcons>>([]);
  const [contextMenu, setContextMenu] = useState<{x: number; y: number; flowPosition?: {x: number; y: number}} | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const flowInstanceRef = useRef<ReactFlowInstance<RelationFlowNode, Edge> | null>(null);
  const graphKeyRef = useRef(JSON.stringify(value));
  const nodeDialogNode = nodes.find((node) => node.id === nodeDialogId);
  const edgeDialogEdge = edges.find((edge) => edge.id === edgeDialogId);

  const syncGraphViewport = useCallback(() => {
    const instance = flowInstanceRef.current;
    const canvas = canvasRef.current;
    if (!instance || !canvas) return;
    const zoom = Math.min(canvas.clientWidth / RELATION_GRAPH_CANVAS_WIDTH, canvas.clientHeight / RELATION_GRAPH_CANVAS_HEIGHT);
    if (Number.isFinite(zoom) && zoom > 0) instance.setViewport({x: 0, y: 0, zoom}, {duration: 0});
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(syncGraphViewport);
    observer.observe(canvas);
    syncGraphViewport();
    return () => observer.disconnect();
  }, [syncGraphViewport]);

  useEffect(() => {
    if (!nodeDialogId && !edgeDialogId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setNodeDialogId(null);
      setEdgeDialogId(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [edgeDialogId, nodeDialogId]);

  useEffect(() => {
    const nextKey = JSON.stringify(value);
    // 父组件刚接收本编辑器提交的数据时，不再把同一份数据回灌一次，避免状态循环。
    if (nextKey === graphKeyRef.current) return;
    graphKeyRef.current = nextKey;
    const isolated = cloneRelationGraphData(value);
    setNodes(isolated.nodes.map(toRelationFlowNode));
    setEdges(isolated.edges as Edge[]);
  }, [setEdges, setNodes, value]);

  const handleNodesChange = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    // dimensions 是 React Flow 的测量状态，不等于用户调整；业务尺寸只在缩放结束时回写。
    onNodesChange(changes);
  }, [onNodesChange]);

  const commitNodeResize = useCallback((nodeId: string, width: number, height: number) => {
    // 仅在用户完成缩放时同步两层尺寸，避免 React Flow 的默认外框覆盖业务宽度。
    const nextWidth = normalizeRelationGraphNodeWidth(width);
    const nextHeight = normalizeRelationGraphNodeHeight(height);
    setNodes((current) => current.map((node) => node.id === nodeId ? {...node, width: nextWidth, height: nextHeight, data: {...node.data, width: nextWidth, height: nextHeight}} : node));
  }, [setNodes]);

  useEffect(() => {
    const next = toRelationGraph(nodes, edges);
    const nextKey = JSON.stringify(next);
    if (nextKey === graphKeyRef.current) return;
    graphKeyRef.current = nextKey;
    onChange(next);
  }, [edges, nodes, onChange]);

  const nodeCue = nodeDialogNode ? relationGraphNodeCue(scene, captions, nodeDialogNode as RelationGraphNode) : null;
  const updateNode = (nodeId: string, patch: Partial<RelationGraphNode["data"]>) => {
    if (disabled) return;
    setNodes((current) => current.map((node) => {
      if (node.id !== nodeId) return node;
      const data = {...node.data, ...patch};
      const geometry = relationGraphNodeGeometry({...node, data});
      return {...node, width: geometry.width, height: geometry.height, data};
    }));
  };
  const updateSelected = (patch: Partial<RelationGraphNode["data"]>) => { const id = nodeDialogId ?? selectedId; if (id) updateNode(id, patch); };
  const addNodeAt = (position?: {x: number; y: number}, textNode = false) => {
    const id = `node-${Date.now()}`;
    // 新节点直接写入完整默认样式，确保编辑器状态与关系图契约保持一致。
    const node = textNode
      ? {id, type: "text" as const, position: position ?? {x: 120, y: 120}, data: {text: "文本内容", textAnimation: "direct" as const, textStyle: "message" as const, textColor: "#26372F", textFontSize: 24, frameFontSize: 24, memberIds: [], presentation: "card" as const, labelPlacement: "bottom" as const, iconSize: 120, cardScale: 1}}
      : {id, type: "default" as const, position: position ?? {x: 120, y: 120}, data: {label: "新节点", presentation: "card" as const, labelPlacement: "bottom" as const, iconSize: 120, cardScale: 1, textAnimation: "direct" as const, textStyle: "message" as const, textColor: "#26372F", textFontSize: 24, frameFontSize: 24, memberIds: []}};
    // 新节点的业务几何同时作为 React Flow 外层尺寸，避免首次测量落回 150px 默认宽度。
    setNodes((current) => [...current, toRelationFlowNode(node)]);
    setSelectedId(id);
    setSelectedEdgeId(null);
    setContextMenu(null);
  };
  // 点击与拖入复用创建入口，坐标来自画布而非页面像素。
  const addElement = (element: GraphElement, position?: {x: number; y: number}) => {
    if (disabled) return;
    const id = `node-${crypto.randomUUID()}`;
    const node = createGraphElement(element, id, position ?? {x: (RELATION_GRAPH_CANVAS_WIDTH - element.width) / 2, y: (RELATION_GRAPH_CANVAS_HEIGHT - element.height) / 2});
    setNodes((current) => [...current.map((item) => ({...item, selected: false})), {...toRelationFlowNode(node), selected: true, zIndex: node.type === "frame" ? -1 : undefined}]);
    setSelectedId(id);
    setSelectedEdgeId(null);
  };
  const arrange = (action: GraphArrange) => {
    if (disabled) return;
    setNodes((current) => arrangeGraphNodes(current, current.filter((node) => node.selected).map((node) => node.id), action));
  };
  const deleteNode = (nodeId: string) => {
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setSelectedId((current) => current === nodeId ? null : current);
    setNodeDialogId((current) => current === nodeId ? null : current);
    setContextMenu(null);
  };
  const selectAllNodes = () => {
    // React Flow 会让同一选择集中的节点随当前拖动节点整体移动。
    setNodes((current) => current.map((node) => ({...node, selected: true})));
    setSelectedId(null);
    setSelectedEdgeId(null);
    setContextMenu(null);
  };
  const addFrame = () => {
    const members = nodes.filter((node) => node.selected && node.type !== "frame");
    if (!members.length) return;
    const boxes = members.map((node) => relationGraphNodeGeometry(node as RelationGraphNode));
    const padding = 36;
    const left = Math.min(...boxes.map((box) => box.x)) - padding;
    const top = Math.min(...boxes.map((box) => box.y)) - padding;
    const right = Math.max(...boxes.map((box) => box.x + box.width)) + padding;
    const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + padding;
    const id = `frame-${Date.now()}`;
    const frame = {id, type: "frame" as const, position: {x: Math.max(0, left), y: Math.max(0, top)}, data: {label: "分组外框", frameFontSize: 24, width: Math.max(1, right - left), height: Math.max(1, bottom - top), memberIds: members.map((node) => node.id), presentation: "card" as const, labelPlacement: "top" as const, iconSize: 120, cardScale: 1, textAnimation: "direct" as const, textStyle: "message" as const, textColor: "#26372F", textFontSize: 24}};
    // 外框只记录成员关系，不改变成员节点坐标，避免破坏已有连线锚点。
    setNodes((current) => [...current.map((node) => ({...node, selected: false})), {...frame, selected: true, zIndex: -1}]);
    setSelectedId(id);
    setSelectedEdgeId(null);
    setContextMenu(null);
  };
  const copySelected = () => {
    const selectedNodeIds = nodes.filter((node) => node.selected).map((node) => node.id);
    if (!selectedNodeIds.length) return;
    relationGraphClipboard = copyRelationGraphSelection(toRelationGraph(nodes, edges), selectedNodeIds);
    setContextMenu(null);
  };
  const pasteCopied = () => {
    if (!relationGraphClipboard) return;
    const sourceNodes = relationGraphClipboard.nodes;
    // 粘贴保留源场景坐标，确保相同关系图在不同场景中的布局一致。
    const pasted = copyRelationGraphSelection(relationGraphClipboard, sourceNodes.map((node) => node.id), nodes.map((node) => node.id), edges.map((edge) => edge.id), {x: 0, y: 0});
    // 粘贴后只选中新内容，方便用户继续移动或再次复制。
    setNodes((current) => [...current.map((node) => ({...node, selected: false})), ...pasted.nodes.map((node) => ({...toRelationFlowNode(node), selected: true, zIndex: node.type === "frame" ? -1 : undefined}))]);
    setEdges((current) => [...current.map((edge) => ({...edge, selected: false})), ...pasted.edges.map((edge) => ({...edge, selected: true}))]);
    setSelectedId(null);
    setSelectedEdgeId(null);
    setContextMenu(null);
  };
  const deleteEdge = (edgeId: string) => {
    setEdges((current) => current.filter((edge) => edge.id !== edgeId));
    setSelectedEdgeId((current) => current === edgeId ? null : current);
    setContextMenu(null);
  };
  const openPaneMenu = (event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    const target = event.target instanceof Element ? event.target : null;
    const rect = target?.closest(".relation-graph-canvas")?.getBoundingClientRect();
    if (!rect) return;
    setContextMenu({x: event.clientX - rect.left, y: event.clientY - rect.top, flowPosition: flowInstanceRef.current?.screenToFlowPosition({x: event.clientX, y: event.clientY})});
  };
  const openNodeMenu = (event: React.MouseEvent | MouseEvent, node: RelationFlowNode) => {
    event.preventDefault();
    setSelectedId(node.id);
    setSelectedEdgeId(null);
    setContextMenu(null);
    // 节点配置使用独立对话框，右键事件不再进入画布菜单或连线流程。
    setNodeDialogId(node.id);
  };
  const openEdgeMenu = (event: React.MouseEvent | MouseEvent, edge: Edge) => {
    event.preventDefault();
    setSelectedId(null);
    setSelectedEdgeId(edge.id);
    setContextMenu(null);
    // 连线设置与节点设置保持一致，右键直接打开独立配置对话框。
    setEdgeDialogId(edge.id);
  };
  // 新连线使用成片同源默认色，不重写既有连线配置。
  const onConnect = useCallback((connection: Connection) => setEdges((current) => addEdge({...connection, type: "smoothstep", strokeStyle: "dashed", strokeWidth: 3, strokeColor: RELATION_GRAPH_DEFAULT_STROKE_COLOR, arrowType: "none"}, current)), [setEdges]);
  const updateSelectedEdge = (label: string) => {
    if (!selectedEdgeId) return;
    setEdges((current) => current.map((edge) => edge.id === selectedEdgeId ? {...edge, label: label || undefined} : edge));
  };
  const runSearch = () => setIconResults(searchLocalIcons(search));
  const updateSelectedIcon = (icon: RelationGraphNode["data"]["icon"]) => {
    if (icon) updateSelected({icon});
  };
  const updateUploadedIcon = (src: string, name: string) => {
    // 上传图片先读取原始尺寸，保存比例后编辑器和成片可以使用同一套几何数据。
    const image = new Image();
    image.onload = () => updateSelected({icon: {src, name, aspectRatio: image.naturalWidth / Math.max(1, image.naturalHeight)}});
    image.onerror = () => updateSelected({icon: {src, name, aspectRatio: 1}});
    image.src = src;
  };
  const playheadMs = currentTimeMs;
  const renderEdges: RelationFlowEdge[] = edges.map((edge) => ({...edge, sourceHandle: relationGraphHandleId(relationGraphDirectionFromHandleId(edge.sourceHandle, "right"), "source"), targetHandle: relationGraphHandleId(relationGraphDirectionFromHandleId(edge.targetHandle, "left"), "target"), animated: true, data: {...edge, relationType: normalizeRelationGraphEdgeType(edge.type)}, type: "relation", style: relationEdgeStyle(edge)}));

  return <div className="relation-graph-editor" aria-label="关系图编辑器">
    <relationNodeEditContext.Provider value={{disabled, selectedCount: nodes.filter((node) => node.selected).length, update: updateNode}}>
    <relationResizeCommitContext.Provider value={commitNodeResize}>
    <aside className="relation-element-library" aria-label="元素库">
      <h3>元素</h3>
      <input aria-label="搜索元素" placeholder="搜索形状或用途" value={elementSearch} onChange={(event) => setElementSearch(event.target.value)} />
      <select aria-label="元素分类" value={elementCategory} onChange={(event) => setElementCategory(event.target.value)}>{["全部", ...new Set(graphElements.map((item) => item.category))].map((category) => <option key={category}>{category}</option>)}</select>
      <div className="relation-element-grid">{graphElements.filter((item) => (elementCategory === "全部" || item.category === elementCategory) && `${item.label} ${item.category} ${item.id} ${item.id === "cylinder" ? "数据库 资源 库存 知识库" : item.id === "document" ? "资料 文档" : item.id === "card" ? "人物 组织 服务 产品" : ""}`.toLowerCase().includes(elementSearch.trim().toLowerCase())).map((item) => {
        const thumbnail = createGraphElement(item, `thumbnail-${item.id}`, {x: 0, y: 0});
        const scale = Math.min(76 / item.width, 52 / item.height);
        return <button key={item.id} type="button" disabled={disabled} draggable={!disabled} title={`添加${item.label}`} onClick={() => addElement(item)} onDragStart={(event) => {event.dataTransfer.setData("application/x-relation-element", item.id); event.dataTransfer.effectAllowed = "copy";}}>
          <span className="relation-element-thumbnail"><span style={{display: "block", position: "absolute", left: (80 - item.width * scale) / 2, top: (60 - item.height * scale) / 2, width: item.width, height: item.height, transform: `scale(${scale})`, transformOrigin: "top left", pointerEvents: "none"}}><RelationGraphNodeBody node={thumbnail} renderImage={renderEditorGraphImage} /></span></span><span>{item.label}</span>
        </button>;
      })}</div>
      <small>拖入或点击添加。拖动节点的四向连接点创建连线。</small>
    </aside>
    <div ref={canvasRef} className="relation-graph-canvas" onDragOver={(event) => {if (!disabled && event.dataTransfer.types.includes("application/x-relation-element")) {event.preventDefault(); event.dataTransfer.dropEffect = "copy";}}} onDrop={(event) => {
      if (disabled) return;
      const element = graphElements.find((item) => item.id === event.dataTransfer.getData("application/x-relation-element"));
      if (!element || !flowInstanceRef.current) return;
      event.preventDefault();
      const center = flowInstanceRef.current.screenToFlowPosition({x: event.clientX, y: event.clientY});
      addElement(element, {x: center.x - element.width / 2, y: center.y - element.height / 2});
    }}>
      <div className="relation-graph-canvas-toolbar">
        <button type="button" disabled={disabled || !nodes.length} onClick={selectAllNodes}>整体移动</button>
        {([["left", "左对齐"], ["center", "水平居中"], ["right", "右对齐"], ["top", "顶对齐"], ["middle", "垂直居中"], ["bottom", "底对齐"], ["horizontal", "水平等距"], ["vertical", "垂直等距"]] as const).map(([action, label]) => <button key={action} type="button" disabled={disabled || nodes.filter((node) => node.selected).length < (action === "horizontal" || action === "vertical" ? 3 : 2)} onClick={() => arrange(action)}>{label}</button>)}
      </div>
      <ReactFlow nodes={nodes} edges={renderEdges} defaultEdgeOptions={{animated: true, type: "relation", style: relationEdgeStyle({})}} edgeTypes={relationEditorEdgeTypes} nodeTypes={relationNodeTypes} snapToGrid snapGrid={relationSnapGrid} multiSelectionKeyCode="Shift" selectNodesOnDrag onInit={(instance) => { flowInstanceRef.current = instance; requestAnimationFrame(syncGraphViewport); }} onNodesChange={handleNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodeContextMenu={openNodeMenu} onEdgeContextMenu={openEdgeMenu} onPaneContextMenu={openPaneMenu} onNodeClick={(_, node) => { setContextMenu(null); setSelectedId(node.id); setSelectedEdgeId(null); }} onEdgeClick={(_, edge) => { setContextMenu(null); setSelectedId(null); setSelectedEdgeId(edge.id); }} onPaneClick={() => { setContextMenu(null); setSelectedId(null); setSelectedEdgeId(null); }} deleteKeyCode={disabled ? null : ["Backspace", "Delete"]} nodesDraggable={!disabled} nodesConnectable={!disabled} elementsSelectable={!disabled} elevateNodesOnSelect={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false} minZoom={0.05} maxZoom={1}>
        <Background gap={24} color="#d5ddd7" />
      </ReactFlow>
      {contextMenu ? <div className="relation-graph-context-menu" style={{left: contextMenu.x, top: contextMenu.y}} onClick={(event) => event.stopPropagation()}>
        <button type="button" disabled={disabled || !nodes.some((node) => node.selected)} onClick={copySelected}>复制所选元素</button><button type="button" disabled={disabled || !relationGraphClipboard} onClick={pasteCopied}>粘贴元素</button><button type="button" disabled={disabled} onClick={selectAllNodes}>全选节点</button><button type="button" disabled={disabled || !nodes.some((node) => node.selected && node.type !== "frame")} onClick={addFrame}>给所选节点加外框</button><button type="button" disabled={disabled} onClick={() => addNodeAt(contextMenu.flowPosition)}>在此添加普通节点</button><button type="button" disabled={disabled} onClick={() => addNodeAt(contextMenu.flowPosition, true)}>在此添加文本框</button>
      </div> : null}
    </div>
    </relationResizeCommitContext.Provider>
    </relationNodeEditContext.Provider>
    {edgeDialogEdge ? <div className="relation-node-config-overlay" role="presentation" onPointerDown={() => setEdgeDialogId(null)}>
      <section className="relation-node-config-dialog" role="dialog" aria-modal="true" aria-labelledby="relation-edge-config-title" onPointerDown={(event) => event.stopPropagation()}>
        <div className="relation-node-config-heading"><div><p className="review-section-label">连线配置</p><h3 id="relation-edge-config-title">{edgeDialogEdge.label ?? "未设置标签"}</h3></div><button className="secondary" type="button" onClick={() => setEdgeDialogId(null)}>关闭</button></div>
        <div className="relation-node-config-form">
          {/* 连线的文字样式集中在右键配置中，避免编辑入口分散在画布和检查器两处。 */}
          <label>连线标签<input className="nodrag" value={typeof edgeDialogEdge.label === "string" ? edgeDialogEdge.label : ""} disabled={disabled} placeholder="例如：调用、连接、依赖" onChange={(event) => updateSelectedEdge(event.target.value)} /></label>
          <label>标签大小<input className="nodrag" type="range" min={12} max={48} step={1} value={normalizeRelationGraphLabelFontSize(typeof edgeDialogEdge.labelFontSize === "number" ? edgeDialogEdge.labelFontSize : undefined)} disabled={disabled} onChange={(event) => setEdges((current) => current.map((edge) => edge.id === edgeDialogEdge.id ? {...edge, labelFontSize: Number(event.target.value)} : edge))} /><small>{normalizeRelationGraphLabelFontSize(typeof edgeDialogEdge.labelFontSize === "number" ? edgeDialogEdge.labelFontSize : undefined)}px（12–48px）</small></label>
          <label className="relation-edge-border-toggle"><input className="nodrag" type="checkbox" checked={edgeDialogEdge.showLabelBox !== false} disabled={disabled} onChange={(event) => setEdges((current) => current.map((edge) => edge.id === edgeDialogEdge.id ? {...edge, showLabelBox: event.target.checked} : edge))} />显示标签框</label>
          <label>连接方式<select className="nodrag" value={normalizeRelationGraphEdgeType(edgeDialogEdge.type) === "straight" ? "straight" : normalizeRelationGraphEdgeType(edgeDialogEdge.type) === "simplebezier" ? "simplebezier" : "step"} disabled={disabled} onChange={(event) => setEdges((current) => current.map((edge) => edge.id === edgeDialogEdge.id ? {...edge, type: event.target.value} : edge))}><option value="straight">直线</option><option value="simplebezier">曲线</option><option value="step">折线</option></select></label>
          <label>线型<select className="nodrag" value={normalizeRelationGraphStrokeStyle(edgeDialogEdge.strokeStyle)} disabled={disabled} onChange={(event) => setEdges((current) => current.map((edge) => edge.id === edgeDialogEdge.id ? {...edge, strokeStyle: event.target.value as "solid" | "dashed"} : edge))}><option value="solid">实线</option><option value="dashed">虚线</option></select></label>
          <label>线宽<input className="nodrag" type="range" min={1} max={12} step={1} value={normalizeRelationGraphStrokeWidth(edgeDialogEdge.strokeWidth)} disabled={disabled} onChange={(event) => setEdges((current) => current.map((edge) => edge.id === edgeDialogEdge.id ? {...edge, strokeWidth: Number(event.target.value)} : edge))} /><small>{normalizeRelationGraphStrokeWidth(edgeDialogEdge.strokeWidth)}px（1–12px）</small></label>
          <label>线条颜色<select className="nodrag" value={normalizeRelationGraphStrokeColor(edgeDialogEdge.strokeColor)} disabled={disabled} onChange={(event) => setEdges((current) => current.map((edge) => edge.id === edgeDialogEdge.id ? {...edge, strokeColor: event.target.value} : edge))}>{relationGraphStrokeColorOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label>箭头<select className="nodrag" value={normalizeRelationGraphArrowType(edgeDialogEdge.arrowType)} disabled={disabled} onChange={(event) => setEdges((current) => current.map((edge) => edge.id === edgeDialogEdge.id ? {...edge, arrowType: event.target.value as "none" | "end" | "both"} : edge))}><option value="none">无箭头</option><option value="end">单箭头</option><option value="both">双箭头</option></select></label>
          <button className="relation-node-delete-button" type="button" disabled={disabled} onClick={() => { deleteEdge(edgeDialogEdge.id); setEdgeDialogId(null); }}>删除连线</button>
        </div>
      </section>
    </div> : null}
    {nodeDialogNode ? <div className="relation-node-config-overlay" role="presentation" onPointerDown={() => setNodeDialogId(null)}>
      <section className="relation-node-config-dialog" role="dialog" aria-modal="true" aria-labelledby="relation-node-config-title" onPointerDown={(event) => event.stopPropagation()}>
        <div className="relation-node-config-heading"><div><p className="review-section-label">节点配置</p><h3 id="relation-node-config-title">{relationGraphNodeDisplayName(nodeDialogNode as RelationGraphNode)}</h3></div><button className="secondary" type="button" onClick={() => setNodeDialogId(null)}>关闭</button></div>
        <div className="relation-node-config-form">
          {nodeDialogNode.type !== "text" ? <label>节点文字<input className="nodrag" value={nodeDialogNode.data.label ?? ""} disabled={disabled} placeholder={nodeDialogNode.data.icon ? "可留空（已有图标）" : "必须填写"} onChange={(event) => updateSelected({label: event.target.value.trim() ? event.target.value : undefined})} /></label> : null}
          <label>口播绑定<input className="nodrag" value={nodeDialogNode.data.cueText ?? ""} disabled={disabled} placeholder="留空则直接显示" onChange={(event) => updateSelected({cueText: event.target.value || undefined})} /></label>
          <label>匹配第几次出现<input className="nodrag" type="number" min={1} step={1} value={nodeDialogNode.data.cueOccurrence ?? 1} disabled={disabled} onChange={(event) => updateSelected({cueOccurrence: Math.max(1, Math.floor(Number(event.target.value) || 1))})} /></label>
          {nodeDialogNode.type !== "text" && nodeDialogNode.type !== "frame" && nodeDialogNode.type !== "group" ? <>
            <label>形状<select value={nodeDialogNode.data.shape ?? "legacy"} disabled={disabled} onChange={(event) => updateSelected({shape: event.target.value === "legacy" ? undefined : event.target.value as RelationGraphNode["data"]["shape"], presentation: "card", width: relationGraphNodeGeometry(nodeDialogNode).width, height: relationGraphNodeGeometry(nodeDialogNode).height})}><option value="legacy">原有外观</option>{graphShapeOptions.map((item) => <option key={item.id} value={item.shape}>{item.label}</option>)}</select></label>
            {(["info", "image-card", "list"] as string[]).includes(nodeDialogNode.data.shape ?? "") ? <label>正文<textarea rows={3} value={nodeDialogNode.data.text ?? ""} disabled={disabled} onChange={(event) => updateSelected({text: event.target.value || undefined})} /><small>标题正文卡、图文卡、列表卡显示正文；切换形状会保留内容。</small></label> : null}
            {nodeDialogNode.data.shape === "list" ? <label>列表内容<textarea rows={4} value={(nodeDialogNode.data.items ?? []).join("\n")} disabled={disabled} onChange={(event) => updateSelected({items: event.target.value.split("\n")})} /><small>每行一项，列表卡整体绑定口播。</small></label> : null}
          </> : null}
          <label>配色<select value={nodeDialogNode.data.palette ?? "legacy"} disabled={disabled} onChange={(event) => updateSelected({palette: event.target.value === "legacy" ? undefined : event.target.value as RelationGraphNode["data"]["palette"], ...(nodeDialogNode.type === "text" ? {textColor: event.target.value === "legacy" ? "#26372F" : graphPalettes[event.target.value as keyof typeof graphPalettes].ink} : {})})}><option value="legacy">原有配色</option>{Object.entries(graphPalettes).map(([key, palette]) => <option key={key} value={key}>{palette.label}</option>)}</select></label>
          {nodeDialogNode.type === "text" ? <>
            <label>文本内容<textarea className="nodrag" rows={4} value={nodeDialogNode.data.text ?? ""} disabled={disabled} placeholder="输入要显示的文字" onChange={(event) => updateSelected({text: event.target.value || undefined})} /></label>
            <label>显示效果<select className="nodrag" value={nodeDialogNode.data.textAnimation ?? "direct"} disabled={disabled} onChange={(event) => updateSelected({textAnimation: event.target.value as RelationGraphNode["data"]["textAnimation"]})}><option value="direct">直接显示</option><option value="typewriter">打字机显示</option></select></label>
            <label>文本框样式<select className="nodrag" value={nodeDialogNode.data.textStyle ?? "message"} disabled={disabled} onChange={(event) => updateSelected({textStyle: event.target.value as RelationGraphNode["data"]["textStyle"]})}><option value="bubble-left">左向气泡</option><option value="bubble-right">右向气泡</option><option value="message">圆角消息</option><option value="plain">无框文字</option></select></label>
            <div className="relation-text-style-fields"><label>字体颜色<select className="nodrag" value={relationGraphTextColorOptions.some((option) => option.value === nodeDialogNode.data.textColor) ? nodeDialogNode.data.textColor : "#26372F"} disabled={disabled} onChange={(event) => updateSelected({textColor: event.target.value})}>{relationGraphTextColorOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label>字体大小<input className="nodrag" type="number" min={12} max={72} step={1} value={normalizeRelationGraphTextFontSize(nodeDialogNode.data.textFontSize)} disabled={disabled} onChange={(event) => updateSelected({textFontSize: Number(event.target.value)})} /><small>12–72px</small></label></div>
          </> : null}
          {nodeDialogNode.type === "frame" ? <label>外框文字大小<input className="nodrag" type="number" min={12} max={72} step={1} value={normalizeRelationGraphTextFontSize(nodeDialogNode.data.frameFontSize)} disabled={disabled} onChange={(event) => updateSelected({frameFontSize: Number(event.target.value)})} /><small>12–72px</small></label> : null}
          {nodeDialogNode.type !== "text" ? <>
          <label>节点样式<select className="nodrag" value={nodeDialogNode.data.presentation ?? "card"} disabled={disabled} onChange={(event) => updateSelected({presentation: event.target.value as RelationGraphNode["data"]["presentation"], shape: undefined, width: relationGraphNodeGeometry(nodeDialogNode).width, height: relationGraphNodeGeometry(nodeDialogNode).height})}><option value="card">卡片节点</option><option value="large-icon">大图标节点</option></select></label>
          <div className="relation-node-size-fields">
            <label>节点宽度<input className="nodrag" type="number" min={1} step={1} value={Math.round(relationGraphNodeGeometry(nodeDialogNode as RelationGraphNode).width)} disabled={disabled} onChange={(event) => updateSelected({width: normalizeRelationGraphNodeWidth(Number(event.target.value))})} /><small>用户自定义</small></label>
            <label>节点高度<input className="nodrag" type="number" min={1} step={1} value={Math.round(relationGraphNodeGeometry(nodeDialogNode as RelationGraphNode).height)} disabled={disabled} onChange={(event) => updateSelected({height: normalizeRelationGraphNodeHeight(Number(event.target.value))})} /><small>用户自定义</small></label>
          </div>
          {nodeDialogNode.data.presentation === "large-icon" ? <>
            <label>标签位置<select className="nodrag" value={nodeDialogNode.data.labelPlacement ?? "bottom"} disabled={disabled} onChange={(event) => updateSelected({labelPlacement: event.target.value as RelationGraphNode["data"]["labelPlacement"]})}><option value="top">图标上方</option><option value="bottom">图标下方</option></select></label>
            <label>图标尺寸<input className="nodrag" type="range" min={48} max={240} step={1} value={normalizeRelationGraphIconSize(nodeDialogNode.data.iconSize)} disabled={disabled} onChange={(event) => updateSelected({iconSize: Number(event.target.value)})} /><small>{Math.round(normalizeRelationGraphIconSize(nodeDialogNode.data.iconSize))}px（48–240px）</small></label>
          </> : null}
          {nodeDialogNode.data.icon ? <button type="button" disabled={disabled} onClick={() => updateSelected({icon: undefined})}>移除图标</button> : null}
          <label>图标搜索<div className="relation-icon-search"><input className="nodrag" value={search} disabled={disabled} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => {if (event.key === "Enter") runSearch();}} /><button className="nodrag" type="button" disabled={disabled || !search.trim()} onClick={runSearch}>搜索</button></div></label>
          <div className="relation-icon-results">{iconResults.map((icon) => <button className="nodrag" type="button" key={icon.name} disabled={disabled} title={icon.name} onClick={() => updateSelectedIcon(icon)}>
            {/* eslint-disable-next-line @remotion/warn-native-media-tag -- 编辑器图标不参与最终 Remotion 渲染。 */}
            <img src={icon.src} alt={icon.name} />
          </button>)}</div>
          <label>上传图片<input className="nodrag" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" disabled={disabled} onChange={(event) => {const file = event.target.files?.[0]; if (file) {const reader = new FileReader(); reader.onload = () => updateUploadedIcon(String(reader.result), file.name); reader.readAsDataURL(file);} event.currentTarget.value = "";}} /></label>
          </> : null}
          <p className={nodeCue ? "relation-cue-ok" : "relation-cue-warning"}>{nodeCue ? `${playheadMs >= nodeCue.startMs && playheadMs <= nodeCue.endMs ? "当前激活 · " : ""}匹配 ${Math.round(nodeCue.startMs)}ms` : nodeDialogNode.data.cueText ? `口播绑定“${nodeDialogNode.data.cueText}”未匹配当前场景，请修改或清空` : "未设置口播绑定"}</p>
          {nodeDialogNode.type === "text" && !nodeDialogNode.data.text?.trim() ? <p className="relation-cue-warning">文本框内容不能为空，当前关系图无法保存。</p> : null}
          {nodeDialogNode.type !== "text" && !nodeDialogNode.data.label && !nodeDialogNode.data.icon ? <p className="relation-cue-warning">没有图标时必须填写节点文字，当前关系图无法保存。</p> : null}
          <button className="relation-node-delete-button" type="button" disabled={disabled} onClick={() => deleteNode(nodeDialogNode.id)}>删除节点</button>
        </div>
      </section>
    </div> : null}
    <aside className="relation-graph-inspector">
      <p className="relation-graph-empty-inspector">右键节点可编辑节点配置；右键连线可编辑连线标签。</p>
      <small>当前场景：{scene.startMs}–{scene.endMs}ms；播放头 {playheadMs}ms</small>
    </aside>
  </div>;
};
