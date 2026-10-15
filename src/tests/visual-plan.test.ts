import assert from "node:assert/strict";
import {visualPlanModelOutputSchema, visualPlanSchema, deriveScenes, validateNarrationTimeline, validateVisualPlan, type VisualPlan} from "../lib/visual-plan";
import {runContractPlanning, visualPlanFallbackState, visualPlanWorkerArgument, visualStyleForPlanning} from "../lib/visual-planner";
import {selectSceneTransition} from "../lib/scene-transitions";
import {splitVisualPlanScene, visualPlanSceneIndexAtTime} from "../lib/visual-plan-editor";
import {spokenTextForTimeRange} from "../lib/visual-plan-text";
import {relationGraphDataSchema} from "../remotion/templates/relation-graph-schema";
import {visualResourceForScene} from "../lib/visual-resource-selection";
import {preserveVisualPlanStructure} from "../lib/derivation";
import {resolveVideoTheme} from "../remotion/visual-style";

const content = {title: "核心能力", subtitle: "浏览器内预览", text: "模型和工具协同工作", keywords: ["模型", "工具"]};
const presenter = {rollType: "a-roll" as const, mode: "hero" as const, poseId: "neutral", placement: "hero" as const, framing: "full" as const};
const plan: VisualPlan = {schemaVersion: "1.0", revision: 1, planVersion: 1, createdAt: "2026-09-04T00:00:00.000Z", scenes: [{id: "plan-01", segmentId: "narration-01", startMs: 0, endMs: 5000, transition: {kind: "fade", durationMs: 315}, content, templateId: "ip/opening-stage", presenter}]};
const draft = {title: "测试", narrationSegments: [{id: "narration-01", spokenText: "核心能力包括模型和工具。"}]};
const narration = {text: "核心能力包括模型和工具。", durationMs: 5000, spokenDurationMs: 4685, model: "test", voice: "test", captions: [{text: "核心能力包括模型和工具。", startMs: 0, endMs: 4685, timestampMs: 2000, confidence: null}], segments: [{id: "narration-01", startMs: 0, endMs: 5000, speechStartMs: 0, speechEndMs: 4685, pauseAfterMs: 315, transition: {kind: "fade" as const, durationMs: 315}}]};
const profile = {accountId: "tech123", seriesId: "tech-minute", presenter: {poses: [{id: "neutral", label: "中立", src: "neutral.png", semanticTags: ["默认"], gestureDirection: "neutral", safeSide: "both"}]}};

assert.equal(visualPlanSchema.safeParse(plan).success, true);
assert.equal(visualPlanSchema.safeParse({...plan, visualStyle: "kinetic-lime"}).success, true);
assert.equal(visualPlanSchema.safeParse({...plan, visualStyle: "layered-mint"}).success, true);
assert.equal(visualPlanSchema.safeParse({...plan, visualStyle: "deep-signal"}).success, true);
assert.equal(visualPlanSchema.safeParse({...plan, visualStyle: "fake-dashboard"}).success, false);
assert.equal(visualStyleForPlanning(null), "kinetic-lime");
assert.equal(visualStyleForPlanning(plan, "重新提取"), undefined);
assert.equal(visualStyleForPlanning({...plan, visualStyle: "deep-signal"}, "重新提取"), "deep-signal");
// 英文派生只替换画面文案，全片主题必须从母任务原样继承。
const translatedPlan = {...plan, scenes: plan.scenes.map((scene) => ({...scene, content: {...scene.content, title: "Core capability"}}))};
assert.equal(preserveVisualPlanStructure({...plan, visualStyle: "layered-mint"}, translatedPlan).visualStyle, "layered-mint");
// 薄荷与深绿风格的封面另设画布；科技简报沿用同一浅色画布。
for (const style of ["kinetic-lime", "layered-mint", "deep-signal"] as const) {
  const coverCanvas = resolveVideoTheme(style, "cover").colors.canvas;
  const sceneCanvas = resolveVideoTheme(style, "scene").colors.canvas;
  if (style === "kinetic-lime") assert.equal(coverCanvas, sceneCanvas);
  else assert.notEqual(coverCanvas, sceneCanvas);
  assert.equal(resolveVideoTheme(style, "scene").colors.ink.startsWith("#F"), false);
}
assert.equal(visualPlanSchema.safeParse({...plan, scenes: [{...plan.scenes[0], visualKind: "hook"}]}).success, false);
const model = {scenes: [{segmentId: "narration-01", content: {title: "核心能力", subtitle: "", text: "模型和工具", keywords: ["模型", "工具"]}}]};
assert.equal(visualPlanModelOutputSchema.safeParse(model).success, true);
assert.equal(visualPlanModelOutputSchema.safeParse({scenes: [{segmentId: "narration-01", content: {title: "标题", subtitle: "副标题", text: "超长镜头内容".repeat(100), keywords: Array.from({length: 8}, (_, index) => `关键词${index}`)}}]}).success, true);
assert.equal(visualPlanModelOutputSchema.safeParse({scenes: [{...model.scenes[0], templateId: "rve/generic-content"}]}).success, false);
assert.equal(visualPlanModelOutputSchema.safeParse({scenes: [{...model.scenes[0], visualIntent: "statement"}]}).success, false);
assert.doesNotThrow(() => validateNarrationTimeline(draft, narration));
assert.doesNotThrow(() => validateNarrationTimeline(
  {...draft, narrationSegments: [{...draft.narrationSegments[0]!, spokenText: "  测试口播  "}]},
  {...narration, text: "测试口播"},
));
assert.doesNotThrow(() => validateVisualPlan(plan, draft, narration, profile as never));
const englishCaptions = [
  {text: "Hello", startMs: 0, endMs: 400, timestampMs: 200, confidence: null},
  {text: "everyone.", startMs: 400, endMs: 1_100, timestampMs: 750, confidence: null},
  {text: "In", startMs: 1_100, endMs: 1_300, timestampMs: 1_200, confidence: null},
  {text: "the", startMs: 1_300, endMs: 1_550, timestampMs: 1_425, confidence: null},
];
assert.equal(spokenTextForTimeRange(englishCaptions, 0, 1_550), "Hello everyone. In the");
assert.equal(spokenTextForTimeRange([
  {text: "past", startMs: 0, endMs: 100, timestampMs: 50, confidence: null},
  {text: ",", startMs: 100, endMs: 120, timestampMs: 110, confidence: null},
  {text: "AI", startMs: 120, endMs: 220, timestampMs: 170, confidence: null},
  {text: "applications", startMs: 220, endMs: 400, timestampMs: 310, confidence: null},
  {text: "point.MCP", startMs: 400, endMs: 600, timestampMs: 500, confidence: null},
  {text: "architecture.The", startMs: 600, endMs: 800, timestampMs: 700, confidence: null},
], 0, 800), "past, AI applications point. MCP architecture. The");
assert.equal(spokenTextForTimeRange([
  {text: "第一", startMs: 0, endMs: 300, timestampMs: 150, confidence: null},
  {text: "层", startMs: 300, endMs: 500, timestampMs: 400, confidence: null},
], 0, 500), "第一层");
assert.equal(deriveScenes(plan, draft, narration)[0]?.templateId, "ip/opening-stage");
assert.equal(deriveScenes(plan, draft, narration)[0]?.content.title, "核心能力");
// 未拆分镜头必须显示确认稿全文，不能因词级字幕跨段粘连而缺少开头文字。
const boundaryCaptionNarration = {...narration, segments: [{...narration.segments[0]!, id: "narration-01"}, {...narration.segments[0]!, id: "narration-02"}], captions: [
  {text: "前一段.A", startMs: 0, endMs: 3_000, timestampMs: 1_500, confidence: null},
  {text: "后续", startMs: 3_000, endMs: 5_000, timestampMs: 4_000, confidence: null},
]};
const boundaryCaptionDraft = {language: {outputLanguage: "en-US"}, title: "边界", narrationSegments: [
  {id: "narration-01", spokenText: "前一段。"},
  {id: "narration-02", spokenText: "A workflow"},
]};
const boundaryCaptionPlan: VisualPlan = {...plan, scenes: [
  {...plan.scenes[0]!, id: "plan-01", segmentId: "narration-01", startMs: 0, endMs: 3_000},
  {...plan.scenes[0]!, id: "plan-02", segmentId: "narration-02", startMs: 3_000, endMs: 5_000},
]};
assert.equal(deriveScenes(boundaryCaptionPlan, boundaryCaptionDraft, boundaryCaptionNarration)[1]?.spokenText, "A workflow");
assert.equal(selectSceneTransition({templateId: "rve/text-highlight"}, 1, 3), "wipe-right");
assert.equal(visualPlanSchema.safeParse({...plan, scenes: [{...plan.scenes[0], transition: {kind: "none", durationMs: 0}}]}).success, true);
assert.equal(visualPlanSchema.safeParse({...plan, scenes: [{...plan.scenes[0], transition: {kind: "none", durationMs: 315}}]}).success, false);
assert.equal(visualPlanFallbackState(false), "awaiting_visual_resources");
assert.equal(visualPlanWorkerArgument(["node", "worker", "--job-id", "job"], "--job-id"), "job");
const splitPlan = splitVisualPlanScene(plan.scenes, 0, 2500);
assert.deepEqual(splitPlan.map((scene) => [scene.segmentId, scene.startMs, scene.endMs]), [["narration-01", 0, 2500], ["narration-01", 2500, 5000]]);
assert.equal(splitPlan[1]!.transition.kind, "none");
assert.equal(visualPlanSceneIndexAtTime(splitPlan, 2600), 1);
const legacyImageResource = {schemaVersion: "1.0" as const, revision: 1, resources: [{segmentId: "narration-01", imagePath: "uploaded-images/legacy.png", imageWidth: 100, imageHeight: 100, polygons: []}]};
assert.equal(visualResourceForScene(legacyImageResource, "scene-1", "narration-01")?.imagePath, "uploaded-images/legacy.png");
const isolatedImageResources = {...legacyImageResource, resources: [...legacyImageResource.resources, {sceneId: "scene-1", segmentId: "narration-01", imagePath: "uploaded-images/scene-1.png", imageWidth: 100, imageHeight: 100, polygons: []}]};
assert.equal(visualResourceForScene(isolatedImageResources, "scene-1", "narration-01")?.imagePath, "uploaded-images/scene-1.png");
assert.equal(visualResourceForScene(isolatedImageResources, "scene-2", "narration-01"), undefined);
const relationGraph = relationGraphDataSchema.parse({kind: "relation-graph", nodes: [{id: "node-1", type: "default", position: {x: 20, y: 30}, data: {label: "原节点", shape: "list", palette: "blue", items: ["原条目"], memberIds: ["member"], icon: {src: "icon.svg", name: "图标"}}}], edges: []});
const relationGraphPlan = {...plan, scenes: [{...plan.scenes[0]!, templateId: "rve/relation-graph", visualData: relationGraph}]};
const splitRelationGraphPlan = splitVisualPlanScene(relationGraphPlan.scenes, 0, 2500);
assert.notEqual(splitRelationGraphPlan[0]!.visualData, splitRelationGraphPlan[1]!.visualData);
assert.notEqual(splitRelationGraphPlan[0]!.visualData!.nodes[0], splitRelationGraphPlan[1]!.visualData!.nodes[0]);
assert.notEqual(splitRelationGraphPlan[0]!.visualData!.nodes[0]!.data, splitRelationGraphPlan[1]!.visualData!.nodes[0]!.data);
assert.notEqual(splitRelationGraphPlan[0]!.visualData!.nodes[0]!.data.icon, splitRelationGraphPlan[1]!.visualData!.nodes[0]!.data.icon);
assert.notEqual(splitRelationGraphPlan[0]!.content, splitRelationGraphPlan[1]!.content);
assert.notEqual(splitRelationGraphPlan[0]!.presenter, splitRelationGraphPlan[1]!.presenter);
assert.notEqual(splitRelationGraphPlan[0]!.transition, splitRelationGraphPlan[1]!.transition);
splitRelationGraphPlan[1]!.visualData!.nodes[0]!.data.label = "场景 3 修改";
splitRelationGraphPlan[1]!.visualData!.nodes[0]!.position.x = 500;
assert.equal(splitRelationGraphPlan[0]!.visualData!.nodes[0]!.data.label, "原节点");
assert.equal(splitRelationGraphPlan[0]!.visualData!.nodes[0]!.position.x, 20);
// 列表与外框成员的修改只归属拆分后的当前镜头。
splitRelationGraphPlan[1]!.visualData!.nodes[0]!.data.items![0] = "修改后的条目";
splitRelationGraphPlan[1]!.visualData!.nodes[0]!.data.memberIds.push("new-member");
assert.deepEqual(splitRelationGraphPlan[0]!.visualData!.nodes[0]!.data.items, ["原条目"]);
assert.deepEqual(splitRelationGraphPlan[0]!.visualData!.nodes[0]!.data.memberIds, ["member"]);
assert.equal(splitRelationGraphPlan[1]!.visualData!.nodes[0]!.data.shape, "list");

const middlePresenter = {rollType: "b-roll" as const, mode: "hidden" as const, poseId: "neutral", placement: "right-lower" as const, framing: "waist" as const};
const multiDraft = {title: "多镜头", narrationSegments: [{id: "narration-01", spokenText: "第一段"}, {id: "narration-02", spokenText: "第二段"}, {id: "narration-03", spokenText: "第三段"}]};
const multiNarration = {text: "第一段\n第二段\n第三段", durationMs: 12000, spokenDurationMs: 12000, model: "test", voice: "test", captions: [{text: "第一段", startMs: 0, endMs: 3000, timestampMs: 1500, confidence: null}], segments: [
  {id: "narration-01", startMs: 0, endMs: 3000, speechStartMs: 0, speechEndMs: 3000, pauseAfterMs: 0, transition: {kind: "fade" as const, durationMs: 240}},
  {id: "narration-02", startMs: 3000, endMs: 9000, speechStartMs: 3000, speechEndMs: 9000, pauseAfterMs: 0, transition: {kind: "fade" as const, durationMs: 240}},
  {id: "narration-03", startMs: 9000, endMs: 12000, speechStartMs: 9000, speechEndMs: 12000, pauseAfterMs: 0, transition: {kind: "fade" as const, durationMs: 240}},
]};
const multiPlan: VisualPlan = {schemaVersion: "1.0", revision: 1, planVersion: 1, createdAt: "2026-09-04T00:00:00.000Z", scenes: [
  {...plan.scenes[0]!, id: "plan-01", segmentId: "narration-01", startMs: 0, endMs: 3000},
  {...plan.scenes[0]!, id: "plan-02", segmentId: "narration-02", startMs: 3000, endMs: 6000, templateId: "rve/generic-content", presenter: middlePresenter},
  {...plan.scenes[0]!, id: "plan-03", segmentId: "narration-02", startMs: 6000, endMs: 9000, templateId: "rve/generic-content", presenter: middlePresenter, transition: {kind: "none", durationMs: 0}},
  {...plan.scenes[0]!, id: "plan-04", segmentId: "narration-03", startMs: 9000, endMs: 12000, templateId: "ip/closing-stage", presenter},
]};
assert.doesNotThrow(() => validateVisualPlan(multiPlan, multiDraft, multiNarration, profile as never));
const selectableOpeningPlan: VisualPlan = {...multiPlan, scenes: [{...multiPlan.scenes[0]!, templateId: "rve/generic-content", presenter: middlePresenter}, ...multiPlan.scenes.slice(1)]};
assert.doesNotThrow(() => validateVisualPlan(selectableOpeningPlan, multiDraft, multiNarration, profile as never));
assert.throws(() => validateVisualPlan({...multiPlan, scenes: [{...multiPlan.scenes[0]!, endMs: 2900}, ...multiPlan.scenes.slice(1)]}, multiDraft, multiNarration, profile as never), /末个视觉镜头边界无效/);
const incompleteImagePlan: VisualPlan = {...multiPlan, scenes: multiPlan.scenes.map((scene, index) => index === 1 ? {...scene, templateId: "rve/visual-image"} : scene)};
assert.doesNotThrow(() => validateVisualPlan(incompleteImagePlan, multiDraft, multiNarration, profile as never, undefined, {allowIncompleteImage: true}));
assert.throws(() => validateVisualPlan(incompleteImagePlan, multiDraft, multiNarration, profile as never), /缺少完整图片资源|图片尺寸或多边形无效/);
assert.equal(deriveScenes(incompleteImagePlan, multiDraft, multiNarration, undefined, {allowIncompleteImage: true})[1]?.templateData, undefined);

const planned = await runContractPlanning({
  modelCall: async () => ({raw: JSON.stringify({scenes: [
    {segmentId: "narration-01", content: {title: "开场", subtitle: "", text: "开场正文", keywords: []}},
    {segmentId: "narration-02", content: {title: "中段", subtitle: "", text: "中段正文", keywords: ["重点"]}},
    {segmentId: "narration-03", content: {title: "结尾", subtitle: "", text: "结尾正文", keywords: []}},
  ]}), contentLength: 100}),
  segments: [
    {id: "narration-01", spokenText: "开场", startMs: 0, endMs: 3000, durationMs: 3000},
    {id: "narration-02", spokenText: "中段", startMs: 3000, endMs: 6000, durationMs: 3000, imagePath: "image.png", imageWidth: 100, imageHeight: 100},
    {id: "narration-03", spokenText: "结尾", startMs: 6000, endMs: 9000, durationMs: 3000},
  ],
  presenterPoses: profile.presenter.poses as never,
});
assert.deepEqual(planned.scenes.map((scene) => scene.templateId), ["ip/opening-stage", "rve/visual-image", "ip/closing-stage"]);
assert.equal(JSON.stringify(planned.scenes).includes("polygons"), false);
console.info("visual-plan.test 通过：模型、规划、模板和资源边界有效");
