import assert from "node:assert/strict";
import {getTemplateStatus, isTemplateCompatible, templateById, templateRegistry} from "../remotion/templates/registry";
import {openingEmphasisCues, openingKeywordCues} from "../remotion/OpeningEmphasis";
import {getOpeningStageMotion} from "../remotion/OpeningStage";

assert.equal(templateRegistry.length, 7);
for (const definition of templateRegistry) {
  assert.ok(definition.minDurationMs > 0);
  assert.equal(definition.adapted, true);
  assert.equal(templateById.get(definition.id), definition);
}
const scene = {id: "scene-02", segmentId: "narration-02", startMs: 0, endMs: 4000, transition: {kind: "fade" as const, durationMs: 315}, spokenText: "模型和工具", content: {title: "核心能力", subtitle: "", text: "模型和工具", keywords: ["模型", "工具"]}, templateId: "rve/generic-content", rollType: "b-roll" as const, presenterMode: "hidden" as const, presenterPoseId: "neutral", presenterPlacement: "right-lower" as const};
assert.equal(isTemplateCompatible(scene, templateById.get("rve/generic-content")!), true);
assert.equal(isTemplateCompatible(scene, templateById.get("ip/opening-stage")!), false);
assert.equal(getTemplateStatus(scene).usable, true);
assert.equal(getTemplateStatus({...scene, templateId: "rve/visual-image"}).usable, false);
// 漫画开场两秒内完成入场，短镜头仍保留稳定阅读窗口。
const motion = getOpeningStageMotion(120, true, 3);
assert.equal(motion.hold.start, 60);
assert.equal(motion.hold.duration, 60);
assert.equal(motion.title.start < motion.subtitle!.start, true);
assert.equal(motion.subtitle!.start < motion.keywords[0]!.start, true);
assert.equal(motion.keywords.at(-1)!.start + motion.keywords.at(-1)!.duration <= motion.hold.start, true);
const compactMotion = getOpeningStageMotion(120, true, 2);
assert.equal(compactMotion.keywords.at(-1)!.start + compactMotion.keywords.at(-1)!.duration <= 60, true);
const compressedMotion = getOpeningStageMotion(70, true, 8);
assert.equal(compressedMotion.keywords[1]!.start - compressedMotion.keywords[0]!.start < 30, true);
assert.equal(compressedMotion.keywords.at(-1)!.start + compressedMotion.keywords.at(-1)!.duration <= compressedMotion.hold.start, true);
assert.equal(getOpeningStageMotion(70, true, 3).hold.duration >= 24, true);
assert.equal(getOpeningStageMotion(70, true, 3).keywords.at(-1)!.start + getOpeningStageMotion(70, true, 3).keywords.at(-1)!.duration <= 46, true);
console.info("template-contracts.test 通过：模板能力只由注册信息与资源状态决定");

// 用户重点词只绑定真实口播，支持重复出现和英文大小写差异。
const cueCaptions = [
  {text: "智能体", startMs: 200, endMs: 800, timestampMs: 500, confidence: null},
  {text: "智能体", startMs: 1200, endMs: 1800, timestampMs: 1500, confidence: null},
  {text: "API", startMs: 2000, endMs: 2300, timestampMs: 2150, confidence: null},
];
assert.deepEqual(openingKeywordCues(scene, cueCaptions, "智能体"), [{startMs: 200, endMs: 800}, {startMs: 1200, endMs: 1800}]);
assert.deepEqual(openingKeywordCues(scene, cueCaptions, "api"), [{startMs: 2000, endMs: 2300}]);
assert.deepEqual(openingKeywordCues(scene, cueCaptions, "不存在"), []);

// 画面词与口播词不同仍可触发；旧关键词不会自动成为重点词。
const emphasisScene = {...scene, content: {...scene.content, emphasisBindings: [{text: "自主性", cueText: "API"}]}};
assert.deepEqual(openingEmphasisCues(emphasisScene, cueCaptions, "自主性"), [{startMs: 2000, endMs: 2300}]);
assert.deepEqual(openingEmphasisCues(scene, cueCaptions, "模型"), []);
assert.deepEqual(openingEmphasisCues(emphasisScene, cueCaptions, "API"), []);
