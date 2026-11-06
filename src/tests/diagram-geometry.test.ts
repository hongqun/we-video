import assert from "node:assert/strict";
import {inspectDiagramGeometry} from "../lib/diagram/geometry";
import {validateDiagramMeaning} from "../lib/diagram/meaning";
import {diagramDataSchema} from "../remotion/templates/auto-diagram-schema";

// 浏览器回归需显式执行：覆盖真实字体、evaluate 序列化和节点遮挡，不调用模型。
const safeArea = {x: 24, y: 24, width: 912, height: 752};
const diagram = (endX: number, endY = 280, circular = false) => diagramDataSchema.parse({
  type: "flow",
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 800"><defs><marker id="arrow" markerWidth="12" markerHeight="12" refX="12" refY="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L12 6L0 12Z" fill="#222"/></marker></defs><g id="opening"><rect x="24" y="24" width="8" height="8"/><text x="50" y="60" font-family="Studio Sans" font-size="28">独立标题</text></g><g id="edge"><path d="M300 280L${endX} ${endY}" fill="none" stroke="#222" marker-end="url(#arrow)"/></g><g id="first"><rect x="100" y="240" width="200" height="80"/><text x="120" y="280" font-family="Studio Sans" font-size="20" fill="#fff">第一步</text></g><g id="second">${circular ? '<circle cx="580" cy="280" r="80"/>' : '<rect x="500" y="240" width="200" height="80"/>'}<text x="530" y="280" font-family="Studio Sans" font-size="20" fill="#fff">第二步</text></g></svg>`,
  bindings: [{groupId: "first", name: "第一步", cueText: "先"}, {groupId: "second", name: "第二步", cueText: "再"}, {groupId: "edge", name: "推进", cueText: "再", kind: "edge", after: ["first", "second"]}],
});
const main = async () => {
  assert.deepEqual(await inspectDiagramGeometry(diagram(500), safeArea), []);
  const obscured = await inspectDiagramGeometry(diagram(600), safeArea);
  assert(obscured.some((error) => error.includes("内部") && error.includes("遮挡")));
  const small = diagram(500);
  small.svg = small.svg.replace('font-size="20"', 'font-size="11"');
  assert((await inspectDiagramGeometry(small, safeArea)).some((error) => error.includes("小于 12px")));
  // 圆形斜向边界不能被包围盒误报为内部。
  const corner = 80 / Math.sqrt(2);
  assert.deepEqual(await inspectDiagramGeometry(diagram(580 - corner, 280 - corner, true), safeArea), []);
  const cycle = {...diagram(500), type: "cycle" as const};
  assert.throws(() => validateDiagramMeaning(cycle, "先投毒，再进入系统，整条攻击链环环相扣。", "环环相扣"));
  assert.throws(() => validateDiagramMeaning(cycle, "先投毒，再进入系统。", "结果反馈回到输入"));
  assert.doesNotThrow(() => validateDiagramMeaning(cycle, "结果反馈回到输入，开始下一轮。", "结果反馈回到输入"));
  console.log("图表浏览器几何与循环证据回归通过");
};
main().catch((error) => {console.error(error); process.exitCode = 1;});
