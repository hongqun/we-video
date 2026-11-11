import assert from "node:assert/strict";
import {XMLSerializer} from "@xmldom/xmldom";
import {DiagramSaveBudget, diagramCandidateHash, diagramPatchSchema, patchDiagram} from "../lib/diagram/candidate";
import {compactDiagramReport, validateDiagramCandidate} from "../lib/diagram/validation";
import {parseDiagramSvg} from "../remotion/templates/auto-diagram-schema";
import {containedVectorDiagram, diagramFixtureArea, diagramFixtureCaptions, diagramFixtureScene, diagramFixtureSpoken, failingRetrievalDiagram} from "./fixtures/diagram-reliability";

// 显式运行时使用真实字体与浏览器；不依赖 jobs 中的私人文件，也不调用模型。
const context = {scene: diagramFixtureScene, captions: diagramFixtureCaptions, spokenText: diagramFixtureSpoken, safeArea: diagramFixtureArea};
const group = (data: ReturnType<typeof failingRetrievalDiagram>, id: string) => new XMLSerializer().serializeToString(parseDiagramSvg(data).doc.getElementById(id)!);
const main = async () => {
  const initial = failingRetrievalDiagram();
  const initialHash = diagramCandidateHash(initial);
  const report = await validateDiagramCandidate(initial, context);
  assert(!report.valid);
  for (const code of ["cue_before_dependency", "text_overflow", "edge_crosses_node"]) assert(report.repairs.some((repair) => repair.code === code), code);
  const conflict = report.repairs.find((repair) => repair.code === "cue_before_dependency");
  assert(conflict?.code === "cue_before_dependency");
  assert(conflict.cueStartMs! < conflict.dependencyStartMs!);
  assert.equal(conflict.dependencyId, "b-bridge");
  const crossing = report.repairs.find((repair) => repair.code === "edge_crosses_node");
  assert(crossing?.code === "edge_crosses_node");
  assert.equal(crossing.obstructionId, "b-retrieve");
  assert.match(crossing.path, /M448 284L702 284/);
  assert.deepEqual(crossing.obstructionBounds, {x: 488, y: 248, width: 180, height: 72});
  const semantic = await validateDiagramCandidate({...initial, type: "loop"}, context, async () => ({errors: ["独立几何错误"], repairs: [crossing], elements: report.measurements, nodes: [], edges: report.edgeEndpoints}));
  assert(semantic.repairs.some((repair) => repair.code === "meaning_invalid"));
  assert(semantic.repairs.some((repair) => repair.code === "cue_before_dependency"));
  assert(semantic.errors.includes("独立几何错误"));
  const overflow = report.repairs.find((repair) => repair.code === "text_overflow");
  assert(overflow?.code === "text_overflow");
  assert(overflow.textBounds.width > overflow.shapeBounds.width);

  const patch = diagramPatchSchema.parse({baseHash: initialHash, operations: [
    {op: "update_binding", groupId: "l-legend", changes: {cueText: "最后搭桥"}},
    {op: "replace_group", groupId: "e-qvec-vault", svg: '<g id="e-qvec-vault"><path d="M358 248L358 224L810 224L810 248" fill="none" stroke="#4F6BFF" marker-end="url(#arrow)"/></g>'},
    {op: "replace_group", groupId: "b-mongo", svg: '<g id="b-mongo"><rect x="816" y="356" width="96" height="60"/><text x="864" y="380" text-anchor="middle" font-family="Studio Sans" font-size="14">MongoDB</text><text x="864" y="398" text-anchor="middle" font-family="Studio Sans" font-size="14">Atlas</text></g>'},
  ]});
  const fixed = patchDiagram(initial, undefined, patch);
  assert.deepEqual(fixed.bindings.find((binding) => binding.groupId === "l-legend"), {...initial.bindings.find((binding) => binding.groupId === "l-legend"), cueText: "最后搭桥"});
  const edgeChange = patchDiagram(initial, undefined, {baseHash: initialHash, operations: [{op: "update_binding", groupId: "e-qvec-vault", changes: {name: "向量查询"}}]});
  assert.deepEqual(edgeChange.bindings.find((binding) => binding.groupId === "e-qvec-vault"), {...initial.bindings.find((binding) => binding.groupId === "e-qvec-vault"), name: "向量查询"});
  const fixedReport = await validateDiagramCandidate(fixed, context);
  assert.deepEqual(fixedReport.errors, []);
  assert.equal(group(initial, "b-retrieve"), group(fixed, "b-retrieve"));
  assert.equal(diagramCandidateHash(initial), initialHash);
  assert.throws(() => patchDiagram(fixed, undefined, patch), /候选已变化/);
  // 后一个操作不安全时，前面的绑定修改也不会泄漏到原候选。
  assert.throws(() => patchDiagram(initial, undefined, {...patch, operations: [patch.operations[0]!, {op: "replace_group", groupId: "b-mongo", svg: '<g id="b-mongo"><script/></g>'}]}), /不允许的 SVG 标签/);
  assert.equal(initial.bindings.find((binding) => binding.groupId === "l-legend")!.cueText, "总结");
  assert.throws(() => patchDiagram(initial, undefined, {...patch, operations: [{op: "replace_group", groupId: "b-mongo", svg: '<g id="other"/>'}]}), /相同 ID/);
  assert.throws(() => patchDiagram(initial, undefined, {...patch, operations: [{op: "replace_group", groupId: "b-mongo", svg: '<g id="b-mongo"/><g id="extra"/>'}]}), /单个 g/);

  const withOpening = {...initial, svg: initial.svg.replace("<defs>", '<g id="opening"><text x="48" y="60" font-size="20">标题</text></g><defs>')};
  const opening = patchDiagram(withOpening, undefined, {baseHash: diagramCandidateHash(withOpening), operations: [{op: "replace_group", groupId: "opening", svg: '<g id="opening"><text x="48" y="70" font-size="20">新标题</text></g>'}]});
  assert.match(opening.svg, /新标题/);
  assert.deepEqual(opening.bindings, initial.bindings);
  assert.throws(() => patchDiagram(withOpening, undefined, {baseHash: diagramCandidateHash(withOpening), operations: [{op: "update_binding", groupId: "opening", changes: {cueText: "标题"}}]}), /没有可更新/);

  const contained = containedVectorDiagram();
  assert((await validateDiagramCandidate(contained, context)).repairs.some((repair) => repair.code === "endpoint_off_boundary"));
  const removed = patchDiagram(contained, undefined, {baseHash: diagramCandidateHash(contained), operations: [{op: "remove_group", groupId: "s20-arrow-vector"}]});
  assert(!removed.svg.includes('id="s20-arrow-vector"'));
  assert(!removed.bindings.some((binding) => binding.groupId === "s20-arrow-vector" || binding.after.includes("s20-arrow-vector")));
  assert.deepEqual((await validateDiagramCandidate(removed, context)).errors, []);
  const referenced = {...contained, svg: contained.svg.replace('id="summary"', 'id="summary" aria-describedby="s20-arrow-vector"')};
  const cleaned = patchDiagram(referenced, undefined, {baseHash: diagramCandidateHash(referenced), operations: [{op: "remove_group", groupId: "s20-arrow-vector"}]});
  assert(!cleaned.svg.includes("aria-describedby"));

  // 属性顺序和结构缩进不构成新候选；实际文字、路径和触发词始终参与哈希。
  const equivalent = {...initial, svg: initial.svg.replace('x="268" y="248"', 'y="248" x="268"').replace(/>\s+</g, ">\n  <"), bindings: initial.bindings.map((binding) => ({...binding, after: [...binding.after].reverse()})).reverse()};
  assert.equal(diagramCandidateHash(equivalent), initialHash);
  const budget = new DiagramSaveBudget(1);
  assert(budget.accept(initialHash));
  assert(!budget.accept(diagramCandidateHash(equivalent), initialHash));
  assert.equal(budget.attempts, 1);
  assert.throws(() => budget.accept(diagramCandidateHash(fixed), initialHash), /预算/);

  let inspected = false;
  const unsafe = await validateDiagramCandidate({...initial, svg: initial.svg.replace('</svg>', '<script/></svg>')}, context, async () => {inspected = true; throw new Error("不应运行浏览器");});
  assert(!unsafe.valid); assert(!inspected);
  assert.equal(unsafe.repairs[0]!.code, "unsafe_svg");
  const compact = compactDiagramReport({...report, measurements: [...report.measurements, {id: "unrelated", kind: "label", ...diagramFixtureArea, boundary: diagramFixtureArea}]}, initial);
  assert(!compact.measurements.some((element) => element.id === "unrelated"));
  assert(compact.measurements.some((element) => element.id === "b-retrieve"));
  assert.equal(compact.repairs, report.repairs);
  console.log("图表独立校验、原子修复与保存预算回归通过");
};
main().catch((error) => {console.error(error); process.exitCode = 1;});
