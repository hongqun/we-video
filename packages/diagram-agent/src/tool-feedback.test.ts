import assert from "node:assert/strict";
import {test} from "node:test";
import {z} from "zod";
import {ToolInputParsingException} from "@langchain/core/tools";
import {diagramInputFeedback} from "./tool-feedback";
import {DiagramSvgError, diagramDataSchema} from "../../../src/remotion/templates/auto-diagram-schema";
import {diagramCandidateHash, DiagramSaveBudget, patchDiagram} from "../../../src/lib/diagram/candidate";
import {containedVectorDiagram} from "../../../src/tests/fixtures/diagram-reliability";

// 复现真实的 pattern 保存失败：返回可执行反馈，安全候选和保存预算均不被修改。
test("不支持的 SVG 返回修正建议，修正后可继续保存", () => {
  const original = containedVectorDiagram();
  const originalText = JSON.stringify(original);
  const originalHash = diagramCandidateHash(original);
  const budget = new DiagramSaveBudget(5);
  const rejected = {...original, svg: original.svg.replace("</defs>", '<pattern id="grid" width="20" height="20"><path d="M0 0L20 0"/></pattern></defs>')};
  let feedback: ReturnType<typeof diagramInputFeedback>;
  try {budget.accept(diagramCandidateHash(rejected), originalHash); assert.fail("不能保存 pattern");}
  catch (error) {feedback = diagramInputFeedback(error);}
  assert.equal(feedback?.recoverable, true);
  assert.equal(feedback?.candidateUnchanged, true);
  assert.match(feedback!.errors[0]!, /pattern/u);
  assert.match(feedback!.repairs[0]!.instruction, /删除 pattern/u);
  assert.equal(budget.attempts, 0);
  assert.equal(JSON.stringify(original), originalText);
  const fixed = {...original, svg: original.svg.replace('width="896"', 'width="890"')};
  assert.equal(budget.accept(diagramCandidateHash(fixed), originalHash), true);
  assert.equal(budget.attempts, 1);
});
test("非法补丁保持原图，候选变化提示重读 hash", () => {
  const original = containedVectorDiagram(), hash = diagramCandidateHash(original);
  assert.throws(() => patchDiagram(original, undefined, {baseHash: hash, operations: [{op: "replace_group", groupId: "summary", svg: '<g id="summary"><script/></g>'}]}), (error: unknown) => Boolean(diagramInputFeedback(error)?.recoverable));
  assert.equal(diagramCandidateHash(original), hash);
  try {patchDiagram(original, undefined, {baseHash: "0".repeat(64), operations: [{op: "remove_group", groupId: "summary"}]});}
  catch (error) {assert.match(diagramInputFeedback(error)!.repairs[0]!.instruction, /read_current_diagram/u);}
});
test("字段错误有反馈，环境和未知错误不能被吞成输入问题", () => {
  const result = diagramDataSchema.safeParse({type: "not-supported", svg: "<svg/>", bindings: []});
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error instanceof z.ZodError);
    assert.equal(diagramInputFeedback(result.error)?.repairs[0]?.code, "input_schema_invalid");
  }
  assert.equal(diagramInputFeedback(Object.assign(new Error("private-key"), {code: "EACCES"})), undefined);
  assert.equal(diagramInputFeedback(new Error("unknown SDK failure")), undefined);
  assert.equal(diagramInputFeedback(new DiagramSvgError("SVG 解析失败"))?.recoverable, true);
  const wrapped = diagramInputFeedback(new ToolInputParsingException("SDK body private-key", "private-key"));
  assert.equal(wrapped?.recoverable, true);
  assert.equal(JSON.stringify(wrapped).includes("private-key"), false);
});
