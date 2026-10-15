import {graphElements, graphShapeAnchor, type GraphShape} from "./relation-graph-elements";
import type {Caption, VideoScene} from "../schema";
import {relationGraphArrowTypeSchema, relationGraphDataSchema, relationGraphEdgeTypeSchema, relationGraphStrokeColorOptions, relationGraphStrokeStyleSchema, relationGraphTextAnimationSchema, relationGraphTextColorOptions, relationGraphTextStyleSchema, type RelationGraphData, type RelationGraphHandleDirection, type RelationGraphNode} from "./relation-graph-schema";

export {relationGraphDataSchema};
export {relationGraphStrokeColorOptions};
export {relationGraphTextColorOptions};
export type {RelationGraphData, RelationGraphEdge, RelationGraphHandleDirection, RelationGraphNode} from "./relation-graph-schema";

type TimedCharacter = {character: string; startMs: number; endMs: number};
export type RelationGraphCue = {startMs: number; endMs: number};

export const RELATION_GRAPH_ICON_SIZE_MIN = 48;
export const RELATION_GRAPH_ICON_SIZE_MAX = 240;
export const RELATION_GRAPH_DEFAULT_ICON_SIZE = 120;
export const RELATION_GRAPH_CARD_SCALE_MIN = 0.7;
export const RELATION_GRAPH_CARD_SCALE_MAX = 2;
export const RELATION_GRAPH_DEFAULT_CARD_SCALE = 1;
export const RELATION_GRAPH_CARD_WIDTH = 180;
export const RELATION_GRAPH_CARD_HEIGHT = 68;
export const RELATION_GRAPH_GROUP_HEIGHT = 130;
export const RELATION_GRAPH_FRAME_WIDTH = 420;
export const RELATION_GRAPH_FRAME_HEIGHT = 260;
export const RELATION_GRAPH_TEXT_WIDTH = 280;
export const RELATION_GRAPH_TEXT_HEIGHT = 96;
export const RELATION_GRAPH_TEXT_FONT_SIZE_MIN = 12;
export const RELATION_GRAPH_TEXT_FONT_SIZE_MAX = 72;
export const RELATION_GRAPH_DEFAULT_TEXT_FONT_SIZE = 24;
// 编辑器与 Remotion 共用同一张关系图画布，避免 fitView 居中后保存位置发生视觉偏移。
export const RELATION_GRAPH_CANVAS_WIDTH = 1080;
export const RELATION_GRAPH_CANVAS_HEIGHT = 900;
// 外框尺寸不设上限；仅拒绝非正数，避免生成无效的 CSS 尺寸。
export const RELATION_GRAPH_NODE_SIZE_MIN = 1;
export const RELATION_GRAPH_DEFAULT_SOURCE_HANDLE: RelationGraphHandleDirection = "right";
export const RELATION_GRAPH_DEFAULT_TARGET_HANDLE: RelationGraphHandleDirection = "left";
export const RELATION_GRAPH_LABEL_FONT_SIZE_MIN = 12;
export const RELATION_GRAPH_LABEL_FONT_SIZE_MAX = 48;
export const RELATION_GRAPH_DEFAULT_LABEL_FONT_SIZE = 12;
// 标签框短文本按内容收窄，过长文本在统一上限内换行，避免撑开整张关系图。
export const RELATION_GRAPH_LABEL_MAX_CONTENT_WIDTH = 180;
export const RELATION_GRAPH_LABEL_HORIZONTAL_PADDING = 8;
export const RELATION_GRAPH_LABEL_VERTICAL_PADDING = 6;
// 新建连线默认深墨色；历史显式配色继续由归一化函数保留。
export const RELATION_GRAPH_DEFAULT_STROKE_COLOR = "#26372F" as const;
export const RELATION_GRAPH_DEFAULT_STROKE_STYLE = "dashed" as const;
export const RELATION_GRAPH_DEFAULT_STROKE_WIDTH = 3;
export const RELATION_GRAPH_DEFAULT_ARROW_TYPE = "none" as const;

export const normalizeRelationGraphIconSize = (value: number | undefined) => Math.min(RELATION_GRAPH_ICON_SIZE_MAX, Math.max(RELATION_GRAPH_ICON_SIZE_MIN, Number.isFinite(value) ? value! : RELATION_GRAPH_DEFAULT_ICON_SIZE));
export const normalizeRelationGraphIconAspectRatio = (value: number | undefined) => Number.isFinite(value) && value! > 0 ? value! : 1;
export const normalizeRelationGraphCardScale = (value: number | undefined) => Math.min(RELATION_GRAPH_CARD_SCALE_MAX, Math.max(RELATION_GRAPH_CARD_SCALE_MIN, Number.isFinite(value) ? value! : RELATION_GRAPH_DEFAULT_CARD_SCALE));
export const normalizeRelationGraphNodeWidth = (value: number | undefined, fallback = RELATION_GRAPH_CARD_WIDTH) => Number.isFinite(value) && value! >= RELATION_GRAPH_NODE_SIZE_MIN ? value! : fallback;
export const normalizeRelationGraphNodeHeight = (value: number | undefined, fallback = RELATION_GRAPH_CARD_HEIGHT) => Number.isFinite(value) && value! >= RELATION_GRAPH_NODE_SIZE_MIN ? value! : fallback;
export const normalizeRelationGraphLabelFontSize = (value: number | undefined) => Math.min(RELATION_GRAPH_LABEL_FONT_SIZE_MAX, Math.max(RELATION_GRAPH_LABEL_FONT_SIZE_MIN, Number.isFinite(value) ? value! : RELATION_GRAPH_DEFAULT_LABEL_FONT_SIZE));
const relationGraphLabelCharacterWidth = (character: string) => (character.codePointAt(0) ?? 0) <= 0xff ? 0.62 : /\s/u.test(character) ? 0.35 : 1;

/** 编辑器和成片共用标签分行结果，保证标签框的宽高与换行规则一致。 */
export const relationGraphLabelLayout = (label: string, fontSize: number | undefined) => {
  const size = normalizeRelationGraphLabelFontSize(fontSize);
  const maxContentWidth = RELATION_GRAPH_LABEL_MAX_CONTENT_WIDTH;
  const maxUnits = maxContentWidth / size;
  const lines: string[] = [];
  for (const sourceLine of label.split(/\r?\n/u)) {
    let line = "";
    let units = 0;
    for (const character of [...sourceLine]) {
      const characterUnits = relationGraphLabelCharacterWidth(character);
      if (line && units + characterUnits > maxUnits) {
        lines.push(line);
        line = "";
        units = 0;
      }
      line += character;
      units += characterUnits;
    }
    lines.push(line);
  }
  const safeLines = lines.length ? lines : [""];
  const longestLineUnits = Math.max(...safeLines.map((line) => [...line].reduce((sum, character) => sum + relationGraphLabelCharacterWidth(character), 0)));
  const contentWidth = Math.max(size * 1.5, Math.min(maxContentWidth, longestLineUnits * size));
  const lineHeight = size * 1.35;
  return {lines: safeLines, width: contentWidth + RELATION_GRAPH_LABEL_HORIZONTAL_PADDING * 2, height: safeLines.length * lineHeight + RELATION_GRAPH_LABEL_VERTICAL_PADDING * 2, lineHeight};
};
export const normalizeRelationGraphTextFontSize = (value: number | undefined) => Math.min(RELATION_GRAPH_TEXT_FONT_SIZE_MAX, Math.max(RELATION_GRAPH_TEXT_FONT_SIZE_MIN, Number.isFinite(value) ? value! : RELATION_GRAPH_DEFAULT_TEXT_FONT_SIZE));
export const normalizeRelationGraphTextAnimation = (value: string | undefined) => relationGraphTextAnimationSchema.safeParse(value).success ? value as "direct" | "typewriter" : "direct";
export const normalizeRelationGraphTextStyle = (value: string | undefined) => relationGraphTextStyleSchema.safeParse(value).success ? value as "bubble-left" | "bubble-right" | "message" | "plain" : "message";
export const normalizeRelationGraphTextColor = (value: string | undefined) => /^#[0-9a-f]{6}$/iu.test(value ?? "") ? value! : "#26372F";
export const normalizeRelationGraphStrokeWidth = (value: number | undefined) => Math.min(12, Math.max(1, Number.isFinite(value) ? value! : RELATION_GRAPH_DEFAULT_STROKE_WIDTH));
export const normalizeRelationGraphStrokeStyle = (value: string | undefined) => relationGraphStrokeStyleSchema.safeParse(value).success ? value as "solid" | "dashed" : RELATION_GRAPH_DEFAULT_STROKE_STYLE;
export const normalizeRelationGraphStrokeColor = (value: string | undefined) => relationGraphStrokeColorOptions.some((option) => option.value === value) ? value as (typeof relationGraphStrokeColorOptions)[number]["value"] : RELATION_GRAPH_DEFAULT_STROKE_COLOR;
export const normalizeRelationGraphArrowType = (value: string | undefined) => relationGraphArrowTypeSchema.safeParse(value).success ? value as "none" | "end" | "both" : RELATION_GRAPH_DEFAULT_ARROW_TYPE;
// 历史 default 边曾由编辑器使用默认贝塞尔、成片使用折线路径；统一归一化为旧版 smoothstep，避免两端继续分叉。
export const normalizeRelationGraphEdgeType = (value: string | undefined) => {
  if (!relationGraphEdgeTypeSchema.safeParse(value).success || value === "default") return "smoothstep" as const;
  return value as "straight" | "step" | "smoothstep" | "simplebezier";
};
export const relationGraphHandleId = (direction: RelationGraphHandleDirection, type: "source" | "target") => `${direction}-${type}`;
export const relationGraphDirectionFromHandleId = (value: string | null | undefined, fallback: RelationGraphHandleDirection) => {
  const direction = value?.replace(/-(?:source|target)$/u, "") as RelationGraphHandleDirection | undefined;
  return direction === "top" || direction === "right" || direction === "bottom" || direction === "left" ? direction : fallback;
};

// 异形锚点由共享轮廓定义，编辑端和成片不得各自猜测连接位置。
export const relationGraphHandlePoint = (box: {x: number; y: number; width: number; height: number; shape?: GraphShape}, direction: RelationGraphHandleDirection) => {
  const point = graphShapeAnchor(box.shape, direction);
  return {x: box.x + box.width * point.x, y: box.y + box.height * point.y};
};

export const relationGraphNodeGeometry = (node: RelationGraphNode) => {
  if (node.data.shape && node.type !== "frame" && node.type !== "text") {
    const element = graphElements.find((item) => item.id === node.data.shape)!;
    return {x: node.position.x, y: node.position.y, width: normalizeRelationGraphNodeWidth(node.data.width, element.width), height: normalizeRelationGraphNodeHeight(node.data.height, element.height), shape: node.data.shape};
  }
  if (node.type === "group") return {x: node.position.x, y: node.position.y, width: RELATION_GRAPH_CARD_WIDTH, height: RELATION_GRAPH_GROUP_HEIGHT};
  if (node.type === "frame") return {x: node.position.x, y: node.position.y, width: normalizeRelationGraphNodeWidth(node.data.width, RELATION_GRAPH_FRAME_WIDTH), height: normalizeRelationGraphNodeHeight(node.data.height, RELATION_GRAPH_FRAME_HEIGHT)};
  if (node.type === "text") return {x: node.position.x, y: node.position.y, width: normalizeRelationGraphNodeWidth(node.data.width, RELATION_GRAPH_TEXT_WIDTH), height: normalizeRelationGraphNodeHeight(node.data.height, RELATION_GRAPH_TEXT_HEIGHT)};
  let width = RELATION_GRAPH_CARD_WIDTH;
  let height = RELATION_GRAPH_CARD_HEIGHT;
  if (node.data.presentation === "large-icon") {
    const iconSize = normalizeRelationGraphIconSize(node.data.iconSize);
    const iconWidth = node.data.icon ? iconSize * normalizeRelationGraphIconAspectRatio(node.data.icon.aspectRatio) : iconSize;
    const hasLabel = Boolean(node.data.label);
    width = hasLabel ? Math.max(RELATION_GRAPH_CARD_WIDTH, iconWidth + 32) : iconWidth;
    height = iconSize + (hasLabel ? 48 : 0);
  } else {
    const scale = normalizeRelationGraphCardScale(node.data.cardScale);
    width *= scale;
    height *= scale;
  }
  return {x: node.position.x, y: node.position.y, width: normalizeRelationGraphNodeWidth(node.data.width, width), height: normalizeRelationGraphNodeHeight(node.data.height, height)};
};

/** 节点外框可非等比调整，内部图标和文字按较小轴持续等比缩放，避免内容变形。 */
export const relationGraphNodeContentScale = (node: RelationGraphNode, box: {width: number; height: number}) => {
  const natural = relationGraphNodeGeometry({...node, data: {...node.data, width: undefined, height: undefined}});
  // 大图标节点需要随用户放大的外框持续放大，不能被固定的三倍上限截断。
  return Math.max(0.5, Math.min(box.width / natural.width, box.height / natural.height));
};

/** 卡片文字宽度跟随节点外框，避免自由拉宽后仍沿用旧的固定换行宽度。 */
export const relationGraphNodeLabelMaxWidth = (node: RelationGraphNode, box: {width: number}) => {
  if (node.type === "text") return Math.max(0, box.width - 32);
  if (node.data.presentation === "large-icon") return Math.max(0, box.width);
  const scale = normalizeRelationGraphCardScale(node.data.cardScale);
  const contentScale = relationGraphNodeContentScale(node, {...box, height: relationGraphNodeGeometry(node).height});
  return Math.max(0, box.width - (node.data.icon ? 72 : 36) * scale * contentScale);
};

/** 编辑器只接收关系图副本，避免 React Flow 的内部变更污染其他场景。 */
export const cloneRelationGraphData = (data: RelationGraphData): RelationGraphData => ({
  ...data,
  nodes: data.nodes.map((node) => ({...node, position: {...node.position}, data: {...node.data, memberIds: [...(node.data.memberIds ?? [])], ...(node.data.items ? {items: [...node.data.items]} : {}), ...(node.data.icon ? {icon: {...node.data.icon}} : {})}})),
  edges: data.edges.map((edge) => ({...edge})),
});

let relationGraphCopySequence = 0;

/** 复制选区时重建 ID 和外框成员关系，并主动移除口播绑定。 */
export const copyRelationGraphSelection = (data: RelationGraphData, selectedNodeIds: string[], existingNodeIds: string[] = [], existingEdgeIds: string[] = [], offset = {x: 24, y: 24}): RelationGraphData => {
  const selected = new Set(selectedNodeIds);
  const sourceNodes = data.nodes.filter((node) => selected.has(node.id));
  const sourceNodeIds = new Set(sourceNodes.map((node) => node.id));
  const nodeIds = new Set(existingNodeIds);
  const edgeIds = new Set(existingEdgeIds);
  const stamp = `${relationGraphCopySequence++}`;
  const nodeIdMap = new Map<string, string>();
  const nextId = (base: string, used: Set<string>) => {
    let id = base;
    let index = 1;
    while (used.has(id)) id = `${base}-${index++}`;
    used.add(id);
    return id;
  };
  sourceNodes.forEach((node, index) => nodeIdMap.set(node.id, nextId(`node-copy-${stamp}-${index + 1}`, nodeIds)));
  const nodes = sourceNodes.map((node) => {
    const restData = {...node.data};
    const memberIds = node.data.memberIds ?? [];
    delete restData.cueText;
    delete restData.cueOccurrence;
    return {
      ...node,
      id: nodeIdMap.get(node.id)!,
      position: {x: node.position.x + offset.x, y: node.position.y + offset.y},
      data: {...restData, ...(node.data.items ? {items: [...node.data.items]} : {}), ...(node.data.icon ? {icon: {...node.data.icon}} : {}), memberIds: node.type === "frame" ? memberIds.filter((memberId) => sourceNodeIds.has(memberId)).map((memberId) => nodeIdMap.get(memberId)!) : [...memberIds]},
    };
  });
  const edges = data.edges
    .filter((edge) => sourceNodeIds.has(edge.source) && sourceNodeIds.has(edge.target))
    .map((edge, index) => {
      const restEdge = {...edge};
      delete restEdge.cueText;
      delete restEdge.cueOccurrence;
      return {...restEdge, id: nextId(`edge-copy-${stamp}-${index + 1}`, edgeIds), source: nodeIdMap.get(edge.source)!, target: nodeIdMap.get(edge.target)!};
    });
  return {kind: "relation-graph", nodes, edges};
};

// 口播绑定只关心文字内容；英文大小写差异不应导致场景节点或连线校验失败。
const normalizeCueText = (value: string) => [...value.normalize("NFKC")].filter((character) => !/[\s，。！？、；：,.!?;:]/u.test(character)).join("").toLowerCase();

const sceneCharacters = (scene: Pick<VideoScene, "startMs" | "endMs" | "speechStartMs" | "speechEndMs">, captions: Caption[]): TimedCharacter[] => {
  const start = scene.speechStartMs ?? scene.startMs;
  const end = scene.speechEndMs ?? scene.endMs;
  return captions
    .filter((caption) => caption.endMs > start && caption.startMs < end)
    .flatMap((caption) => {
      const captionStart = Math.max(start, caption.startMs);
      const captionEnd = Math.min(end, caption.endMs);
      const characters = [...caption.text.normalize("NFKC")].filter((character) => !/\s/u.test(character));
      return characters.map((character, index) => ({
        character,
        startMs: captionStart + Math.round((captionEnd - captionStart) * index / Math.max(1, characters.length)),
        endMs: captionStart + Math.round((captionEnd - captionStart) * (index + 1) / Math.max(1, characters.length)),
      }));
    });
};

export const resolveRelationGraphCue = ({scene, captions, text, occurrence = 1}: {scene: Pick<VideoScene, "startMs" | "endMs" | "speechStartMs" | "speechEndMs">; captions: Caption[]; text?: string; occurrence?: number}): RelationGraphCue | null => {
  if (!text?.trim()) return null;
  const characters = sceneCharacters(scene, captions);
  const needle = normalizeCueText(text);
  if (!needle) return null;
  const joined = characters.map((item) => normalizeCueText(item.character)).join("");
  let from = 0;
  let found = -1;
  for (let current = 0; current < occurrence; current += 1) {
    found = joined.indexOf(needle, from);
    if (found < 0) return null;
    from = found + needle.length;
  }
  const first = characters[found];
  const last = characters[found + needle.length - 1];
  return first && last ? {startMs: first.startMs, endMs: Math.max(first.endMs, last.endMs)} : null;
};

export const relationGraphNodeCue = (scene: Pick<VideoScene, "startMs" | "endMs" | "speechStartMs" | "speechEndMs">, captions: Caption[], node: RelationGraphNode) => resolveRelationGraphCue({scene, captions, text: node.data.cueText, occurrence: node.data.cueOccurrence});

// 图标节点可以没有 label；校验和编辑器提示必须使用稳定的可读名称，不能直接展示 undefined。
// 文本框只有一个用户内容字段；旧数据若仍有 label，也优先显示实际文本作为节点名称。
export const relationGraphNodeDisplayName = (node: RelationGraphNode) => node.type === "text" ? node.data.text?.trim() || node.data.label?.trim() || node.id : node.data.label?.trim() || node.data.icon?.name || node.id;

/** 文本框动画只在匹配到口播时逐字推进；未绑定口播时直接展示完整内容。 */
export const relationGraphTextProgress = (nowMs: number, cue: RelationGraphCue | null, animation: string | undefined) => {
  if (!cue || normalizeRelationGraphTextAnimation(animation) === "direct") return cue && nowMs < cue.startMs ? 0 : 1;
  const duration = Math.max(1, cue.endMs - cue.startMs);
  return Math.max(0, Math.min(1, (nowMs - cue.startMs) / duration));
};

export const relationGraphVisibleText = (text: string, nowMs: number, cue: RelationGraphCue | null, animation: string | undefined) => {
  const progress = relationGraphTextProgress(nowMs, cue, animation);
  if (normalizeRelationGraphTextAnimation(animation) !== "typewriter" || !cue) return progress > 0 ? text : "";
  return [...text].slice(0, Math.ceil([...text].length * progress)).join("");
};

/** 关键词只生成节点；关系线必须由用户在 React Flow 中明确创建。 */
export const buildRelationGraphFromKeywords = (keywords: string[]): RelationGraphData => {
  const unique = [...new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean))];
  return {
    kind: "relation-graph",
    nodes: unique.map((keyword, index) => ({
      id: `keyword-${String(index + 1).padStart(2, "0")}`,
      type: "default" as const,
      position: {x: 80 + (index % 3) * 300, y: 80 + Math.floor(index / 3) * 180},
      data: {label: keyword, cueText: keyword, presentation: "card", labelPlacement: "bottom", iconSize: RELATION_GRAPH_DEFAULT_ICON_SIZE, cardScale: RELATION_GRAPH_DEFAULT_CARD_SCALE, textAnimation: "direct", textStyle: "message", textColor: "#26372F", textFontSize: RELATION_GRAPH_DEFAULT_TEXT_FONT_SIZE, frameFontSize: RELATION_GRAPH_DEFAULT_TEXT_FONT_SIZE, memberIds: []},
    })),
    edges: [],
  };
};

export const parseRelationGraphData = (scene: Pick<VideoScene, "id">, value: unknown) => {
  const parsed = relationGraphDataSchema.safeParse(value);
  if (!parsed.success) throw new Error(`镜头 ${scene.id} 的关系图数据无效：${parsed.error.issues[0]?.message ?? "未知错误"}`);
  return parsed.data;
};

export type GraphArrange = "left" | "center" | "right" | "top" | "middle" | "bottom" | "horizontal" | "vertical";
/** 只调整选中节点的位置；等距分布固定首尾，外框不隐式带动成员。 */
export const arrangeGraphNodes = <T extends RelationGraphNode>(nodes: T[], ids: string[], action: GraphArrange): T[] => {
  const selected = new Set(ids);
  const boxes = nodes.filter((node) => selected.has(node.id)).map((node) => ({id: node.id, ...relationGraphNodeGeometry(node)}));
  const distribute = action === "horizontal" || action === "vertical";
  if (boxes.length < (distribute ? 3 : 2)) return nodes;
  const left = Math.min(...boxes.map((b) => b.x)), right = Math.max(...boxes.map((b) => b.x + b.width));
  const top = Math.min(...boxes.map((b) => b.y)), bottom = Math.max(...boxes.map((b) => b.y + b.height));
  const positions = new Map<string, {x: number; y: number}>();
  if (distribute) {
    const horizontal = action === "horizontal";
    boxes.sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y) || a.id.localeCompare(b.id));
    const first = boxes[0], last = boxes[boxes.length - 1];
    const extent = horizontal ? last.x + last.width - first.x : last.y + last.height - first.y;
    const gap = (extent - boxes.reduce((sum, b) => sum + (horizontal ? b.width : b.height), 0)) / (boxes.length - 1);
    let cursor = horizontal ? first.x : first.y;
    boxes.forEach((box, index) => {
      positions.set(box.id, index === 0 || index === boxes.length - 1 ? {x: box.x, y: box.y} : horizontal ? {x: cursor, y: box.y} : {x: box.x, y: cursor});
      cursor += (horizontal ? box.width : box.height) + gap;
    });
  } else boxes.forEach((box) => positions.set(box.id, {
    x: action === "left" ? left : action === "right" ? right - box.width : action === "center" ? (left + right - box.width) / 2 : box.x,
    y: action === "top" ? top : action === "bottom" ? bottom - box.height : action === "middle" ? (top + bottom - box.height) / 2 : box.y,
  }));
  return nodes.map((node) => positions.has(node.id) ? {...node, position: positions.get(node.id)!} : node);
};
