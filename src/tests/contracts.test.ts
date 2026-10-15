import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {renderManifestSchema, visualPlanContentSchema} from "../remotion/schema";
import {getCoverContent} from "../remotion/CoverOpening";
import {templateRegistry} from "../remotion/templates/registry";
import {visualPlanChanged} from "../lib/visual-plan-editor";

const scene = {
  id: "scene-01", segmentId: "narration-01", startMs: 0, endMs: 5000, speechStartMs: 0, speechEndMs: 4685, pauseAfterMs: 315,
  transition: {kind: "fade" as const, durationMs: 315}, spokenText: "测试口播",
  content: {title: "核心能力", subtitle: "副标题", text: "正文", keywords: ["模型", "工具"]},
  templateId: "ip/opening-stage", rollType: "a-roll" as const, presenterMode: "hero" as const, presenterPoseId: "neutral", presenterPlacement: "hero" as const, presenterFraming: "full" as const,
};
const manifest = {schemaVersion: "1.0" as const, jobId: "test-job", revision: 1, title: "测试视频", captionStyle: "narration" as const, video: {width: 1080 as const, height: 1260 as const, fps: 30 as const, outroDurationMs: 3000 as const}, narration: {text: "测试口播", audioSrc: "artifact://audio/narration.wav", durationMs: 5000, model: "test", voice: "test"}, captions: [{text: "测试口播", startMs: 0, endMs: 4685, timestampMs: 2000, confidence: null}], scenes: [scene], brand: {logoSrc: "logo.png", title: "Tech123", subtitle: "科技"}};
assert.deepEqual(getCoverContent({title: "编辑封面", subtitle: "", keywords: ["新关键词"], presenterPoseId: "neutral"}), {title: "编辑封面", subtitle: "", keywords: ["新关键词"]});
// 封面组件只接受 cover，不能再从 draft 标题或首镜头内容补值。
assert.deepEqual(getCoverContent({title: "独立封面", subtitle: "", keywords: ["封面关键词"], presenterPoseId: "neutral"}), {title: "独立封面", subtitle: "", keywords: ["封面关键词"]});
assert.equal(renderManifestSchema.safeParse({...manifest, cover: {title: "", subtitle: "", keywords: [], presenterPoseId: "neutral"}}).success, false);
assert.equal(renderManifestSchema.safeParse({...manifest, cover: {title: "封面", subtitle: "副标题", keywords: [], presenterPoseId: "?"}}).success, false);
assert.equal(renderManifestSchema.safeParse({...manifest, cover: {title: "封面", subtitle: "副标题", keywords: [], presenterPoseId: "neutral", imagePath: "uploaded-images/cover.png", imageWidth: 1}}).success, false);
assert.equal(renderManifestSchema.safeParse({...manifest, cover: {title: "封面", subtitle: "副标题", keywords: [], presenterPoseId: "neutral", imagePath: "artifact://uploaded-images/cover.png", imageWidth: 1, imageHeight: 1}}).success, true);
// 全片风格只有三个公开选项；缺失字段继续兼容旧漫画成片。
for (const visualStyle of ["kinetic-lime", "layered-mint", "deep-signal"]) assert.equal(renderManifestSchema.safeParse({...manifest, visualStyle}).success, true);
assert.equal(renderManifestSchema.safeParse({...manifest, visualStyle: "legacy-comic"}).success, false);
// 固定片尾文案是可选字段，英文派生任务可写入，历史中文 Manifest 仍可省略。
assert.equal(renderManifestSchema.safeParse({...manifest, brand: {...manifest.brand, outro: {title: "Tech123", subtitle: "Science · Technology · Innovation", prompt: "Leave a comment"}}}).success, true);
assert.equal(renderManifestSchema.safeParse({...manifest, brand: {...manifest.brand, outro: {title: "", subtitle: "Science", prompt: "Leave a comment"}}}).success, false);
assert.equal(renderManifestSchema.safeParse({...manifest, contentProfile: {accountId: "tech123", seriesId: "tech-minute", accountVersion: "1", seriesVersion: "1", outputLanguage: "zh-CN"}, shortTitle: "这是一个确实超过十六个字符的中文标题"}).success, false);
assert.equal(renderManifestSchema.safeParse({...manifest, contentProfile: {accountId: "tech123", seriesId: "tech-minute-en", accountVersion: "1", seriesVersion: "1", outputLanguage: "en-US"}, shortTitle: "This is an intentionally long English publishing title"}).success, true);
// 只编辑封面时也必须触发保存，避免预览与最终 Manifest 分叉。
const planWithCover = {schemaVersion: "1.0" as const, revision: 1, planVersion: 1, createdAt: "2026-09-05T00:00:00.000Z", cover: {title: "封面", subtitle: "副标题", keywords: ["模型"], presenterPoseId: "neutral"}, scenes: [{id: "scene-01", segmentId: "narration-01", startMs: 0, endMs: 5000, transition: {kind: "fade" as const, durationMs: 315}, content: scene.content, templateId: scene.templateId, presenter: {rollType: "a-roll" as const, mode: "hero" as const, poseId: "neutral", placement: "hero" as const, framing: "full" as const}}]};
assert.equal(visualPlanChanged(planWithCover, {...planWithCover, cover: {...planWithCover.cover, title: "新封面"}}), true);
assert.equal(visualPlanChanged(planWithCover, {...planWithCover, visualStyle: "kinetic-lime"}), true);
assert.equal(renderManifestSchema.safeParse({...manifest, scenes: [{...scene, visualKind: "hook"}]}).success, false);
assert.equal(renderManifestSchema.safeParse({...manifest, scenes: [{...scene, visualTemplate: {id: "x", data: {}}}]}).success, false);
// 关系图属于当前可选内容模板，白名单断言必须与实际注册表保持同步。
assert.deepEqual(templateRegistry.map((item) => item.id), ["ip/opening-stage", "rve/text-reveal", "rve/visual-image", "rve/text-highlight", "rve/generic-content", "rve/relation-graph", "ip/closing-stage"]);
// 契约文件在独立项目根目录，不再位于旧平台父目录。
assert.doesNotThrow(() => JSON.parse(readFileSync(new URL("../../contracts/render-manifest-v1.schema.json", import.meta.url), "utf8")));
assert.doesNotThrow(() => JSON.parse(readFileSync(new URL("../../contracts/draft-v1.schema.json", import.meta.url), "utf8")));
console.info("contracts.test 通过：新 Manifest 契约与模板白名单有效");

// 重点词绑定为可选独立字段，旧内容兼容且两个配置值完整保留。
const emphasisContent = {...scene.content, emphasisBindings: [{text: "自主性", cueText: "核心区别"}]};
assert.deepEqual(visualPlanContentSchema.parse(emphasisContent).emphasisBindings, emphasisContent.emphasisBindings);
assert.equal(visualPlanContentSchema.parse(scene.content).emphasisBindings, undefined);
assert.equal(visualPlanContentSchema.safeParse({...scene.content, emphasisBindings: [{text: "自主性", cueText: ""}]}).success, false);
