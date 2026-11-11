import assert from "node:assert/strict";
import {inspectDiagram, inspectDiagramGeometry} from "../lib/diagram/geometry";
import {diagramDataSchema, type DiagramData} from "../remotion/templates/auto-diagram-schema";

// 浏览器回归需显式执行：覆盖真实字体、evaluate 序列化和节点遮挡，不调用模型。
const safeArea = {x: 24, y: 24, width: 912, height: 752};
const diagram = (endX: number, endY = 280, circular = false) => diagramDataSchema.parse({
  type: "flowchart",
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 800"><defs><marker id="arrow" markerWidth="12" markerHeight="12" refX="12" refY="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L12 6L0 12Z" fill="#222"/></marker></defs><g id="opening"><rect x="24" y="24" width="8" height="8"/><text x="50" y="60" font-family="Studio Sans" font-size="28">独立标题</text></g><g id="edge"><path d="M300 280L${endX} ${endY}" fill="none" stroke="#222" marker-end="url(#arrow)"/></g><g id="first"><rect x="100" y="240" width="200" height="80"/><text x="120" y="280" font-family="Studio Sans" font-size="20" fill="#fff">第一步</text></g><g id="second">${circular ? '<circle cx="580" cy="280" r="80"/>' : '<rect x="500" y="240" width="200" height="80"/>'}<text x="530" y="280" font-family="Studio Sans" font-size="20" fill="#fff">第二步</text></g></svg>`,
  bindings: [{groupId: "first", name: "第一步", cueText: "先"}, {groupId: "second", name: "第二步", cueText: "再"}, {groupId: "edge", name: "推进", cueText: "再", kind: "edge", after: ["first", "second"]}],
});
// 使用真实 SVG 夹具区分实体节点和可重叠的图表角色，不模拟浏览器几何 API。
type Item = {id: string; kind: DiagramData["bindings"][number]["kind"]; svg: string; after?: string[]};
const figure = (type: DiagramData["type"], items: Item[]) => diagramDataSchema.parse({
  type,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 800">${items.map((item) => `<g id="${item.id}">${item.svg}</g>`).join("")}</svg>`,
  bindings: items.map(({id, kind, after}) => ({groupId: id, name: id, kind, after: after ?? [], cueText: "先"})),
});
const main = async () => {
  assert.deepEqual(await inspectDiagramGeometry(diagram(500), safeArea), []);
  // 终点距离目标仅 6px，但箭头沿边缘朝下时，不能误判为连接成功。
  const sideways = diagram(494, 300);
  sideways.svg = sideways.svg.replace('M300 280L494 300', 'M300 280L494 280L494 300');
  assert((await inspectDiagram(sideways, safeArea)).repairs.some((repair) => repair.code === "arrow_direction"));
  sideways.svg = sideways.svg.replace('M300 280L494 280L494 300', 'M300 280L480 280L480 300L500 300');
  assert.deepEqual(await inspectDiagramGeometry(sideways, safeArea), []);
  // 有向边可以终止于语义区域或数据标记，箭头仍须接触其边界。
  for (const kind of ["region", "mark"] as const) {
    const target = diagram(500);
    target.bindings[1]!.kind = kind;
    assert.deepEqual(await inspectDiagramGeometry(target, safeArea), []);
    const badTarget = diagram(600);
    badTarget.bindings[1]!.kind = kind;
    assert((await inspectDiagramGeometry(badTarget, safeArea)).some((error) => error.includes("未落在端点边界")));
  }
  const obscured = await inspectDiagramGeometry(diagram(600), safeArea);
  assert(obscured.some((error) => error.includes("内部") && error.includes("遮挡")));
  const small = diagram(500);
  small.svg = small.svg.replace('font-size="20"', 'font-size="11"');
  assert((await inspectDiagramGeometry(small, safeArea)).some((error) => error.includes("小于 12px")));
  // 圆形斜向边界不能被包围盒误报为内部。
  const corner = 80 / Math.sqrt(2);
  assert.deepEqual(await inspectDiagramGeometry(diagram(580 - corner, 280 - corner, true), safeArea), []);
  const venn = figure("venn", [
    {id: "left", kind: "region", svg: '<circle cx="280" cy="300" r="120"/>'},
    {id: "right", kind: "region", svg: '<circle cx="380" cy="300" r="120"/>'},
    {id: "overlap", kind: "label", svg: '<text x="300" y="300" font-size="20">交集</text>'},
  ]);
  assert.deepEqual(await inspectDiagramGeometry(venn, safeArea), []);
  // 同样的重叠若被误标为实体节点，仍应拒绝。
  const overlappingNodes = {...venn, bindings: venn.bindings.map((binding) => binding.kind === "region" ? {...binding, kind: "node" as const} : binding)};
  assert((await inspectDiagramGeometry(overlappingNodes, safeArea)).some((error) => error.includes("明显重叠")));
  assert.deepEqual(await inspectDiagramGeometry(figure("nested", [
    {id: "container", kind: "region", svg: '<rect x="100" y="140" width="500" height="400"/>'},
    {id: "child", kind: "node", svg: '<rect x="200" y="240" width="200" height="100"/>'},
  ]), safeArea), []);
  // 容器主框在安全区内，外置标题仍可能越界；反馈必须包含实际范围以便模型修复。
  const titledRegion = figure("nested", [{id: "map", kind: "region", svg: '<rect x="32" y="32" width="896" height="736"/><text x="56" y="22" font-size="20">语义地图</text>'}]);
  const titleErrors = await inspectDiagramGeometry(titledRegion, safeArea);
  assert(titleErrors.some((error) => error.includes("超出人物安全区") && error.includes("实际范围") && error.includes("安全范围")));
  // 指向容器内部的短箭头不构成与边界相接，不能通过更改 after 来掩盖。
  const internalArrow = diagram(500);
  internalArrow.bindings[1]!.kind = "region";
  internalArrow.svg = internalArrow.svg.replace('<rect x="500" y="240" width="200" height="80"/>', '<rect x="32" y="32" width="896" height="736"/>');
  const endpointErrors = await inspectDiagramGeometry(internalArrow, safeArea);
  assert(endpointErrors.some((error) => error.includes("未落在端点边界") && error.includes("second") && error.includes("width=896.0")));
  // 复现向量位于地图内部的悬空箭头：返回可执行建议，删去冗余关系后才通过。
  const containedVector = figure("nested", [
    {id: "relation", kind: "edge", after: ["map", "vector"], svg: '<path d="M156 364L156 380" fill="none" stroke="#222" marker-end="url(#arrow)"/>'},
    {id: "map", kind: "region", svg: '<rect x="32" y="40" width="896" height="728" fill="none" stroke="#222"/>'},
    {id: "vector", kind: "node", svg: '<rect x="56" y="320" width="200" height="44"/>'},
  ]);
  containedVector.svg = containedVector.svg.replace('<g id="relation">', '<defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0 0L6 3L0 6Z"/></marker></defs><g id="relation">');
  const vectorReport = await inspectDiagram(containedVector, safeArea);
  const repair = vectorReport.repairs.find((item) => item.groupId === "relation");
  assert(repair?.code === "endpoint_off_boundary");
  assert.deepEqual(repair.end, {x: 156, y: 380});
  assert.deepEqual(repair.containingRegions, ["map"]);
  assert.deepEqual(repair.candidates.find((item) => item.id === "map")?.nearestBoundaryPoint, {x: 32, y: 380});
  assert.match(repair.instruction, /删除该连线 SVG 组及对应 binding/);
  const withoutRelation = {...containedVector, svg: containedVector.svg.replace(/<g id="relation">.*?<\/g>/, ""), bindings: containedVector.bindings.filter((binding) => binding.groupId !== "relation")};
  assert.deepEqual(await inspectDiagramGeometry(withoutRelation, safeArea), []);
  const bar = figure("bar", [
    {id: "bars", kind: "mark", svg: '<rect x="200" y="300" width="80" height="180"/><rect x="320" y="250" width="80" height="230"/>'},
    {id: "value", kind: "label", svg: '<text x="200" y="280" font-size="20">数值</text>'},
  ]);
  assert.deepEqual(await inspectDiagramGeometry(bar, safeArea), []);
  // mark 允许柱外文字和相交的独立系列，不套用第一枚形状的文字包围盒。
  const labeledMark = figure("bar", [{id: "series", kind: "mark", svg: '<rect x="200" y="300" width="80" height="180"/><text x="200" y="280" font-size="20">数值</text>'}]);
  assert.deepEqual(await inspectDiagramGeometry(labeledMark, safeArea), []);
  const nodeLabel = {...labeledMark, bindings: labeledMark.bindings.map((binding) => ({...binding, kind: "node" as const}))};
  assert((await inspectDiagramGeometry(nodeLabel, safeArea)).some((error) => error.includes("超出所属节点")));
  assert.deepEqual(await inspectDiagramGeometry(figure("line", [
    {id: "rising", kind: "mark", svg: '<path d="M100 500L600 200" fill="none" stroke="#222"/>'},
    {id: "falling", kind: "mark", svg: '<path d="M100 200L600 500" fill="none" stroke="#555"/>'},
    {id: "flat", kind: "mark", svg: '<line x1="100" y1="350" x2="600" y2="350" stroke="#999"/>'},
  ]), safeArea), []);
  const undirected = figure("uml-class", [
    {id: "first", kind: "node", svg: '<rect x="100" y="240" width="200" height="80"/>'},
    {id: "second", kind: "node", svg: '<rect x="500" y="240" width="200" height="80"/>'},
    {id: "relation", kind: "connector", after: ["first", "second"], svg: '<line x1="300" y1="280" x2="500" y2="280" stroke="#222"/>'},
  ]);
  assert.deepEqual(await inspectDiagramGeometry(undirected, safeArea), []);
  const badConnector = {...undirected, svg: undirected.svg.replace('x1="300"', 'x1="350"')};
  assert((await inspectDiagramGeometry(badConnector, safeArea)).some((error) => error.includes("起点和终点")));
  const noArrow = diagram(500);
  noArrow.svg = noArrow.svg.replace(' marker-end="url(#arrow)"', "");
  assert((await inspectDiagramGeometry(noArrow, safeArea)).some((error) => error.includes("缺少 marker-end")));
  assert.deepEqual(await inspectDiagramGeometry(figure("exploded", [
    {id: "top", kind: "mark", svg: '<polygon points="200,200 350,140 500,200 350,260"/>'},
    {id: "base", kind: "mark", svg: '<polygon points="200,240 350,180 500,240 350,300"/>'},
  ]), safeArea), []);
  // 所有动画角色都不能借放宽重叠规则越过人物安全区或画布。
  for (const kind of ["node", "edge", "region", "mark", "label", "connector"] as const) {
    const outside = figure("architecture", [{id: "outside", kind, svg: '<line x1="4" y1="200" x2="100" y2="200" stroke="#222"/>'}]);
    assert((await inspectDiagramGeometry(outside, safeArea)).some((error) => error.includes("超出人物安全区")), kind);
    outside.svg = outside.svg.replace('x1="4"', 'x1="980"');
    assert((await inspectDiagramGeometry(outside, safeArea)).some((error) => error.includes("超出画布")), kind);
  }
  const tinyLabel = {...bar, svg: bar.svg.replace('font-size="20"', 'font-size="11"')};
  assert((await inspectDiagramGeometry(tinyLabel, safeArea)).some((error) => error.includes("小于 12px")));
  console.log("图表浏览器角色几何回归通过");
};
main().catch((error) => {console.error(error); process.exitCode = 1;});
