import {createGraphElement, graphElements} from "../remotion/templates/relation-graph-elements";
import {arrangeGraphNodes, cloneRelationGraphData} from "../remotion/templates/relation-graph";
import assert from "node:assert/strict";
import {buildRelationGraphFromKeywords, copyRelationGraphSelection, normalizeRelationGraphArrowType, normalizeRelationGraphCardScale, normalizeRelationGraphIconSize, normalizeRelationGraphLabelFontSize, normalizeRelationGraphNodeHeight, normalizeRelationGraphNodeWidth, normalizeRelationGraphStrokeColor, normalizeRelationGraphStrokeStyle, normalizeRelationGraphStrokeWidth, normalizeRelationGraphTextColor, normalizeRelationGraphTextFontSize, relationGraphHandlePoint, relationGraphNodeContentScale, relationGraphNodeDisplayName, relationGraphNodeGeometry, relationGraphNodeLabelMaxWidth, relationGraphStrokeColorOptions, relationGraphTextProgress, relationGraphVisibleText, resolveRelationGraphCue, type RelationGraphData} from "../remotion/templates/relation-graph";
import {relationGraphDataSchema} from "../remotion/templates/relation-graph-schema";

const graph = buildRelationGraphFromKeywords(["PostgreSQL", "PostgreSQL", "API"]);
assert.deepEqual(graph.nodes.map((node) => ({type: node.type, label: node.data.label, cueText: node.data.cueText})), [
  {type: "default", label: "PostgreSQL", cueText: "PostgreSQL"},
  {type: "default", label: "API", cueText: "API"},
]);
assert.equal(graph.edges.length, 0);
assert.equal(relationGraphDataSchema.safeParse(graph).success, true);
const copySource = relationGraphDataSchema.parse({kind: "relation-graph", nodes: [
  {id: "copy-a", type: "default", position: {x: 10, y: 20}, data: {label: "A", cueText: "口播A", cueOccurrence: 2, icon: {src: "data:image/svg+xml,a", name: "A"}}},
  {id: "copy-b", type: "text", position: {x: 100, y: 120}, data: {text: "B", cueText: "口播B"}},
  {id: "copy-frame", type: "frame", position: {x: 0, y: 0}, data: {label: "框", memberIds: ["copy-a", "copy-b"], cueText: "口播框", width: 300, height: 200}},
  {id: "outside", type: "default", position: {x: 500, y: 500}, data: {label: "外部节点"}},
], edges: [
  {id: "copy-inner", source: "copy-a", target: "copy-b", cueText: "连线口播"},
  {id: "copy-outer", source: "copy-a", target: "outside", cueText: "外部连线"},
]});
const copied = copyRelationGraphSelection(copySource, ["copy-a", "copy-b", "copy-frame"], ["node-copy-existing"], ["edge-copy-existing"], {x: 0, y: 0});
assert.equal(copied.nodes.length, 3);
assert.equal(copied.edges.length, 1);
assert.equal(copied.nodes.every((node) => !node.data.cueText && !node.data.cueOccurrence), true);
assert.equal(copied.edges[0]!.cueText, undefined);
assert.deepEqual(copied.nodes.find((node) => node.type === "frame")!.data.memberIds, copied.nodes.filter((node) => node.id !== copied.nodes.find((item) => item.type === "frame")!.id).map((node) => node.id));
assert.notEqual(copied.nodes[0], copySource.nodes[0]);
assert.notEqual(copied.nodes[0]!.data.icon, copySource.nodes[0]!.data.icon);
assert.deepEqual(copied.nodes[0]!.position, {x: 10, y: 20});
assert.equal(relationGraphDataSchema.safeParse(copied).success, true);
const legacyGraphWithoutMemberIds = {kind: "relation-graph", nodes: [{id: "legacy-copy", type: "default", position: {x: 0, y: 0}, data: {label: "旧节点"}}], edges: []} as unknown as RelationGraphData;
assert.equal(copyRelationGraphSelection(legacyGraphWithoutMemberIds, ["legacy-copy"], [], []).nodes[0]!.data.memberIds?.length, 0);
const legacy = relationGraphDataSchema.parse({kind: "relation-graph", nodes: [{id: "legacy", type: "default", position: {x: 0, y: 0}, data: {label: "旧节点"}}], edges: []});
assert.deepEqual(legacy.nodes[0]!.data, {label: "旧节点", presentation: "card", labelPlacement: "bottom", iconSize: 120, cardScale: 1, textAnimation: "direct", textStyle: "message", textColor: "#26372F", textFontSize: 24, frameFontSize: 24, memberIds: []});
const spacedLabel = relationGraphDataSchema.parse({kind: "relation-graph", nodes: [{id: "spaced", type: "default", position: {x: 0, y: 0}, data: {label: " Rest API "}}], edges: []});
assert.equal(spacedLabel.nodes[0]!.data.label, " Rest API ");
const iconOnly = relationGraphDataSchema.parse({kind: "relation-graph", nodes: [{id: "icon-only", type: "default", position: {x: 0, y: 0}, data: {icon: {src: "data:image/svg+xml,test", name: "图标"}}}], edges: []});
assert.equal(iconOnly.nodes[0]!.data.label, undefined);
assert.equal(relationGraphDataSchema.safeParse({kind: "relation-graph", nodes: [{id: "missing-label", type: "default", position: {x: 0, y: 0}, data: {}}], edges: []}).success, false);
assert.equal(relationGraphDataSchema.safeParse({kind: "relation-graph", nodes: [{id: "group", type: "group", position: {x: 0, y: 0}, data: {icon: {src: "data:image/svg+xml,test"}}}], edges: []}).success, false);
assert.equal(normalizeRelationGraphCardScale(3), 2);
assert.equal(normalizeRelationGraphNodeWidth(40), 40);
assert.equal(normalizeRelationGraphNodeWidth(700), 700);
assert.equal(normalizeRelationGraphNodeHeight(20), 20);
assert.equal(normalizeRelationGraphNodeHeight(500), 500);
const scaledCard = relationGraphDataSchema.parse({kind: "relation-graph", nodes: [{id: "scaled", type: "default", position: {x: 0, y: 0}, data: {label: "放大", cardScale: 1.5}}], edges: []});
assert.deepEqual(relationGraphNodeGeometry(scaledCard.nodes[0]!), {x: 0, y: 0, width: 270, height: 102});
const freelySizedCard = relationGraphDataSchema.parse({kind: "relation-graph", nodes: [{id: "free", type: "default", position: {x: 10, y: 20}, data: {label: "自由尺寸", cardScale: 1, width: 320, height: 52}}], edges: []});
assert.deepEqual(relationGraphNodeGeometry(freelySizedCard.nodes[0]!), {x: 10, y: 20, width: 320, height: 52});
const freelySizedGeometry = relationGraphNodeGeometry(freelySizedCard.nodes[0]!);
const freelySizedContentScale = Math.min(320 / 180, 52 / 68);
assert.equal(relationGraphNodeLabelMaxWidth(freelySizedCard.nodes[0]!, freelySizedGeometry), 320 - 36 * freelySizedContentScale);
assert.equal(relationGraphNodeContentScale(freelySizedCard.nodes[0]!, freelySizedGeometry), freelySizedContentScale);
const enlargedCard = relationGraphDataSchema.parse({kind: "relation-graph", nodes: [{id: "enlarged", type: "default", position: {x: 0, y: 0}, data: {label: "同步放大", width: 360, height: 136}}], edges: []});
assert.equal(relationGraphNodeContentScale(enlargedCard.nodes[0]!, relationGraphNodeGeometry(enlargedCard.nodes[0]!)), 2);
const largeIcon = relationGraphDataSchema.parse({kind: "relation-graph", nodes: [{id: "large", type: "default", position: {x: 0, y: 0}, data: {label: "大图标", presentation: "large-icon", labelPlacement: "top", iconSize: 320}}], edges: []});
assert.equal(normalizeRelationGraphIconSize(320), 240);
assert.equal(relationGraphNodeGeometry(largeIcon.nodes[0]!).height, 288);
assert.equal(relationGraphNodeGeometry(largeIcon.nodes[0]!).width, 272);
const wideLargeIcon = relationGraphDataSchema.parse({kind: "relation-graph", nodes: [{id: "wide-large", type: "default", position: {x: 0, y: 0}, data: {label: "宽图标", presentation: "large-icon", icon: {src: "data:image/svg+xml,test", aspectRatio: 2}, iconSize: 240}}], edges: []});
assert.equal(relationGraphNodeGeometry(wideLargeIcon.nodes[0]!).width, 512);

const scene = {id: "scene-02", startMs: 0, endMs: 4000, speechStartMs: 0, speechEndMs: 4000};
const cue = resolveRelationGraphCue({scene, captions: [{text: "先连接 PostgreSQL，再调用 API", startMs: 0, endMs: 4000, timestampMs: null, confidence: null}], text: "PostgreSQL"});
assert.ok(cue);
assert.equal(cue!.startMs >= 0 && cue!.endMs <= 4000, true);
// 匹配只依赖场景时间范围，直接复用该范围验证大小写归一化。
const sceneFourCue = resolveRelationGraphCue({scene, captions: [{text: "先连接 PostgreSQL，再调用 API", startMs: 0, endMs: 4000, timestampMs: null, confidence: null}], text: "postgresql"});
assert.ok(sceneFourCue);
assert.equal(resolveRelationGraphCue({scene, captions: [], text: "不存在"}), null);
assert.equal(relationGraphDataSchema.safeParse({...graph, edges: [{id: "bad", source: "missing", target: graph.nodes[0]!.id}]}).success, false);
const directional = relationGraphDataSchema.parse({kind: "relation-graph", nodes: [{id: "a", type: "default", position: {x: 100, y: 100}, data: {label: "A"}}, {id: "b", type: "default", position: {x: 100, y: 300}, data: {label: "B"}}], edges: [{id: "vertical", source: "a", target: "b", sourceHandle: "bottom", targetHandle: "top"}]});
assert.equal(directional.edges[0]!.sourceHandle, "bottom");
assert.equal(directional.edges[0]!.targetHandle, "top");
assert.deepEqual(relationGraphHandlePoint(relationGraphNodeGeometry(directional.nodes[0]!), "bottom"), {x: 190, y: 168});
assert.deepEqual(relationGraphHandlePoint(relationGraphNodeGeometry(directional.nodes[1]!), "top"), {x: 190, y: 300});
assert.equal(relationGraphDataSchema.safeParse({...directional, edges: [{...directional.edges[0], sourceHandle: "diagonal"}]}).success, false);
const sizedEdge = relationGraphDataSchema.parse({kind: "relation-graph", nodes: [{id: "a", type: "default", position: {x: 0, y: 0}, data: {label: "A"}}, {id: "b", type: "default", position: {x: 240, y: 0}, data: {label: "B"}}], edges: [{id: "sized", source: "a", target: "b", label: "调用", labelFontSize: 20}]});
assert.equal(sizedEdge.edges[0]!.labelFontSize, 20);
assert.equal(sizedEdge.edges[0]!.showLabelBox, true);
assert.equal(relationGraphDataSchema.parse({kind: "relation-graph", nodes: [{id: "a", type: "default", position: {x: 0, y: 0}, data: {label: "A"}}, {id: "b", type: "default", position: {x: 240, y: 0}, data: {label: "B"}}], edges: [{id: "default-size", source: "a", target: "b", label: "调用"}]}).edges[0]!.labelFontSize, 12);
assert.equal(normalizeRelationGraphLabelFontSize(60), 48);
assert.equal(normalizeRelationGraphLabelFontSize(4), 12);
assert.equal(relationGraphDataSchema.parse({...sizedEdge, edges: [{...sizedEdge.edges[0], showLabelBox: false}]}).edges[0]!.showLabelBox, false);
assert.equal(relationGraphDataSchema.safeParse({kind: "relation-graph", nodes: [{id: "a", type: "default", position: {x: 0, y: 0}, data: {label: "A"}}, {id: "b", type: "default", position: {x: 240, y: 0}, data: {label: "B"}}], edges: [{id: "bad-size", source: "a", target: "b", labelFontSize: "large"}]}).success, false);
const defaultEdge = relationGraphDataSchema.parse({...sizedEdge, edges: [{id: "default-style", source: "a", target: "b"}]}).edges[0]!;
// 缺省连线使用深墨色，显式旧配色继续保留。
assert.equal(defaultEdge.strokeColor, "#26372F");
assert.equal(normalizeRelationGraphStrokeColor("#7DA894"), "#7DA894");
assert.equal(defaultEdge.strokeStyle, "dashed");
assert.equal(defaultEdge.strokeWidth, 3);
assert.equal(defaultEdge.arrowType, "none");
assert.equal(defaultEdge.type, "smoothstep");
assert.equal(relationGraphStrokeColorOptions.length, 8);
for (const option of relationGraphStrokeColorOptions) assert.equal(relationGraphDataSchema.safeParse({...sizedEdge, edges: [{id: "color", source: "a", target: "b", strokeColor: option.value}]}).success, true);
assert.equal(relationGraphDataSchema.safeParse({...sizedEdge, edges: [{id: "bad-color", source: "a", target: "b", strokeColor: "#FFFFFF"}]}).success, false);
const styledEdge = relationGraphDataSchema.parse({...sizedEdge, edges: [{id: "styled", source: "a", target: "b", type: "simplebezier", strokeStyle: "solid", strokeWidth: 10, strokeColor: "#4F6BFF", arrowType: "both"}]}).edges[0]!;
assert.equal(styledEdge.type, "simplebezier");
assert.equal(styledEdge.strokeStyle, "solid");
assert.equal(styledEdge.strokeWidth, 10);
assert.equal(styledEdge.strokeColor, "#4F6BFF");
assert.equal(styledEdge.arrowType, "both");
assert.equal(normalizeRelationGraphStrokeWidth(99), 12);
assert.equal(normalizeRelationGraphStrokeWidth(0), 1);
assert.equal(normalizeRelationGraphStrokeColor("#FFFFFF"), "#26372F");
assert.equal(normalizeRelationGraphStrokeStyle("solid"), "solid");
assert.equal(normalizeRelationGraphArrowType("both"), "both");
assert.equal(relationGraphNodeDisplayName(iconOnly.nodes[0]!), "图标");
const textNode = relationGraphDataSchema.parse({kind: "relation-graph", nodes: [{id: "text", type: "text", position: {x: 12, y: 18}, data: {label: "提示", text: "第一行\n Rest API ✅", textStyle: "bubble-left", textAnimation: "typewriter", textColor: "#4F6BFF", textFontSize: 32}}], edges: []});
assert.equal(textNode.nodes[0]!.data.textStyle, "bubble-left");
assert.equal(textNode.nodes[0]!.data.textAnimation, "typewriter");
assert.equal(textNode.nodes[0]!.data.textColor, "#4F6BFF");
assert.equal(textNode.nodes[0]!.data.textFontSize, 32);
assert.deepEqual(relationGraphNodeGeometry(textNode.nodes[0]!), {x: 12, y: 18, width: 280, height: 96});
assert.equal(relationGraphDataSchema.safeParse({kind: "relation-graph", nodes: [{id: "missing-text", type: "text", position: {x: 0, y: 0}, data: {}}], edges: []}).success, false);
assert.equal(relationGraphDataSchema.safeParse({...textNode, nodes: [{...textNode.nodes[0]!, data: {...textNode.nodes[0]!.data, textColor: "red"}}]}).success, false);
assert.equal(normalizeRelationGraphTextFontSize(100), 72);
assert.equal(normalizeRelationGraphTextFontSize(4), 12);
assert.equal(normalizeRelationGraphTextColor("invalid"), "#26372F");
const textCue = {startMs: 1000, endMs: 2000};
assert.equal(relationGraphTextProgress(999, textCue, "direct"), 0);
assert.equal(relationGraphVisibleText("你好✅", 1250, textCue, "typewriter"), "你");
assert.equal(relationGraphVisibleText("你好✅", 1500, textCue, "typewriter"), "你好");
assert.equal(relationGraphVisibleText("你好✅", 2000, textCue, "typewriter"), "你好✅");
assert.equal(relationGraphVisibleText("无绑定", 0, null, "typewriter"), "无绑定");
// 所有预设都能持久化，且不擅自绑定当前口播。
for (const element of graphElements) {
  const node = createGraphElement(element, element.id, {x: 10, y: 20});
  const saved = relationGraphDataSchema.parse(JSON.parse(JSON.stringify({kind: "relation-graph", nodes: [node], edges: []})));
  assert.equal(saved.nodes[0]!.data.shape, element.shape);
  assert.equal(saved.nodes[0]!.data.cueText, undefined);
  assert.equal(relationGraphNodeGeometry(saved.nodes[0]!).width, element.width);
  assert.equal(relationGraphNodeGeometry(saved.nodes[0]!).height, element.height);
}
const listElement = createGraphElement(graphElements.find((item) => item.id === "list")!, "list", {x: 0, y: 0});
const listGraph: RelationGraphData = {kind: "relation-graph", nodes: [listElement], edges: []};
const isolatedList = cloneRelationGraphData(listGraph);
isolatedList.nodes[0]!.data.items![0] = "已修改";
assert.equal(listElement.data.items![0], "第一项");
const copiedList = copyRelationGraphSelection(listGraph, ["list"]);
copiedList.nodes[0]!.data.items![0] = "复制后修改";
assert.equal(listElement.data.items![0], "第一项");
// 不等宽节点按可见边界等距，端点和未选中节点保持不动。
const arrangement = [0, 130, 400, 700].map((x, index) => ({...listElement, id: `arrange-${index}`, position: {x, y: index * 20}, data: {...listElement.data, width: 50 + index * 25, height: 80}}));
const distributed = arrangeGraphNodes(arrangement, arrangement.slice(0, 3).map((node) => node.id), "horizontal");
assert.equal(distributed[0]!.position.x, 0);
assert.equal(distributed[2]!.position.x, 400);
assert.equal(distributed[1]!.position.x, 187.5);
assert.equal(distributed[3], arrangement[3]);
assert.equal(distributed[1]!.data, arrangement[1]!.data);
const aligned = arrangeGraphNodes(arrangement, arrangement.slice(0, 3).map((node) => node.id), "right");
assert.deepEqual(aligned.slice(0, 3).map((node) => node.position.x + node.data.width!), [500, 500, 500]);
assert.equal(arrangeGraphNodes(arrangement, [arrangement[0]!.id], "left"), arrangement);
// 文档与堆叠的锚点跟随真实轮廓；缩放后仍使用同一比例。
assert.deepEqual(relationGraphHandlePoint({x: 10, y: 20, width: 200, height: 100, shape: "document"}, "bottom"), {x: 110, y: 110});
assert.deepEqual(relationGraphHandlePoint({x: 10, y: 20, width: 200, height: 100, shape: "stack"}, "right"), {x: 194, y: 66});
console.info("relation-graph.test 通过：节点结构、关键词生成和字幕匹配符合简化契约");
