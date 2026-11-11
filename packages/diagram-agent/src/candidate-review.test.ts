import assert from "node:assert/strict";
import {test} from "node:test";
import {assertDiagramCandidateReady} from "./candidate-review";
import {diagramCandidateHash, patchDiagram} from "../../../src/lib/diagram/candidate";
import type {DiagramCandidate} from "../../../src/lib/diagram/store";
import {containedVectorDiagram, diagramFixtureArea} from "../../../src/tests/fixtures/diagram-reliability";

// 模拟完整检查返回值，专门验证准备采用的最终门槛；不打开浏览器或调用模型。
test("完整校验和 inspect 必须属于当前请求的同一份候选", () => {
  const initial = containedVectorDiagram();
  const data = patchDiagram(initial, undefined, {baseHash: diagramCandidateHash(initial), operations: [{op: "remove_group", groupId: "s20-arrow-vector"}]});
  const hash = diagramCandidateHash(data);
  const candidate: DiagramCandidate = {data, hash, requestId: "request-1", fingerprint: "scene-1", valid: false, errors: [], validation: {valid: true, errors: [], repairs: [], measurements: [], edgeEndpoints: [], safeArea: diagramFixtureArea}};
  const context = {requestId: "request-1", fingerprint: "scene-1", reviewedHash: hash, saves: 2, maxSaves: 5};
  assert.doesNotThrow(() => assertDiagramCandidateReady(candidate, context));
  assert.throws(() => assertDiagramCandidateReady(candidate, {...context, reviewedHash: ""}), /inspect_diagram/);
  assert.throws(() => assertDiagramCandidateReady({...candidate, validation: undefined}, context), /未提交有效/);
  assert.throws(() => assertDiagramCandidateReady({...candidate, validation: {...candidate.validation!, valid: false, errors: ["连线穿过节点"]}}, context), /未提交有效/);
  assert.throws(() => assertDiagramCandidateReady({...candidate, validation: {...candidate.validation!, errors: ["连线穿过节点"]}}, context), /未提交有效/);
  assert.throws(() => assertDiagramCandidateReady(candidate, {...context, requestId: "request-2"}), /未提交有效/);
  assert.throws(() => assertDiagramCandidateReady(candidate, {...context, fingerprint: "scene-2"}), /未提交有效/);
  assert.throws(() => assertDiagramCandidateReady(null, {...context, saves: 5}), /5 次预算/);
  const patched = patchDiagram(data, undefined, {baseHash: hash, operations: [{op: "update_binding", groupId: "summary", changes: {cueText: "最后搭桥"}}]});
  assert.throws(() => assertDiagramCandidateReady({...candidate, data: patched}, context), /inspect_diagram/);
  assert.throws(() => assertDiagramCandidateReady({...candidate, data: patched, hash: diagramCandidateHash(patched)}, context), /inspect_diagram/);
});
