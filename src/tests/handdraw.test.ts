/* eslint-disable @remotion/non-pure-animation -- 测试时间是输入夹具，不参与组件动画。 */
import assert from "node:assert/strict";
import {HANDDRAW_VERSION, handdrawDataSchema, handdrawPenAt, handdrawTemplateData, handdrawTiming, handdrawLiftMs, handdrawPlaybackTrack, handdrawSourceTimeAt, handdrawPromptBudget, type HanddrawData, type HanddrawMotion} from "../remotion/templates/handdraw-schema";
import {decodeHanddrawTimes, paintHanddrawPixels} from "../remotion/templates/handdraw-pixels";
import {getTemplateStatus} from "../remotion/templates/registry";
import {visualResourceForScene} from "../lib/visual-resource-selection";

// 任意时刻独立重建，覆盖倒放、尚未开始和相同时间重复定位。
const pixels = {
  line: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]),
  color: new Uint8ClampedArray([240, 10, 10, 255, 10, 220, 30, 255]),
  lineTimes: new Uint32Array([100, 0xffffffff]), colorTimes: new Uint32Array([300, 400]),
};
assert.deepEqual([...paintHanddrawPixels(pixels, -1)], [255, 255, 255, 255, 255, 255, 255, 255]);
const middle = paintHanddrawPixels(pixels, 200);
assert.deepEqual([...middle], [0, 0, 0, 255, 255, 255, 255, 255]);
assert.deepEqual([...paintHanddrawPixels(pixels, 500)], [0, 0, 0, 255, 10, 220, 30, 255]);
assert.deepEqual(paintHanddrawPixels(pixels, 200), middle);
assert.deepEqual([...decodeHanddrawTimes(new Uint8ClampedArray([1, 2, 3, 255, 0, 0, 0, 0]))], [197121, 0xffffffff]);

const data: HanddrawData = {algorithmVersion: HANDDRAW_VERSION, cacheKey: "a".repeat(64), width: 100, height: 100, minimumDrawMs: 2000, completePath: "complete.png", lineLayerPath: "line.png", colorLayerPath: "color.png", lineTimePath: "line-time.png", colorTimePath: "color-time.png", motionPath: "motion.json", hashes: {}};
assert.equal(handdrawTiming({startMs: 0, endMs: 4000}, data).drawDurationMs, 2000);
assert.equal(handdrawTiming({startMs: 0, endMs: 4000}, data).holdMs, 2000);
assert.equal(handdrawTiming({startMs: 0, endMs: 2500}, data).drawDurationMs, 1500);
assert.throws(() => handdrawTiming({startMs: 0, endMs: 2500}, {...data, minimumDrawMs: 16000}), /超过 10 倍上限/);
assert.equal(handdrawTiming({startMs: 5000, endMs: 9500, transition: {durationMs: 300}}, data).drawStartMs, 300);
assert.equal(handdrawDataSchema.safeParse({...data, algorithmVersion: "old"}).success, false);
assert.equal(handdrawTemplateData({status: "processing"}, (path) => path), undefined);
assert.equal(handdrawTemplateData({status: "ready", data}, (path) => `artifact://${path}`)?.motionPath, "artifact://motion.json");
const motion: HanddrawMotion = {algorithmVersion: HANDDRAW_VERSION, cacheKey: data.cacheKey, width: 100, height: 100, minimumDrawMs: 2000, points: [[50, 0, 0, 0], [100, 10, 20, 1], [200, 20, 40, 1], [2000, 20, 40, 0]]};
assert.equal(handdrawPenAt(motion, 0), null);
assert.deepEqual(handdrawPenAt(motion, 150), {x: 15, y: 30, lifted: false});
assert.equal(handdrawPenAt(motion, 2000), null);

// 手绘待上传仍可保留选择，时长不足时给出具体原因；原图片模板要求不变。
const scene = {id: "scene-01", segmentId: "n1", startMs: 0, endMs: 4000, transition: {kind: "none" as const, durationMs: 0 as const}, spokenText: "测试", content: {title: "测试", subtitle: "", text: "测试", keywords: []}, templateId: "rve/handdraw-image", rollType: "b-roll" as const, presenterMode: "hidden" as const, presenterPoseId: "neutral", presenterPlacement: "right-lower" as const};
assert.equal(getTemplateStatus(scene).usable, false);
assert.equal(getTemplateStatus({...scene, templateData: data}).usable, true);
assert.match(getTemplateStatus({...scene, endMs: 2000, templateData: {...data, minimumDrawMs: 11000}}).reason, /至少需要/);
assert.equal(getTemplateStatus({...scene, templateId: "rve/visual-image", templateData: data}).usable, false);
const resources = {resources: [{sceneId: "s1", segmentId: "n1", polygons: [], handdraw: {status: "ready" as const, data}}]};
assert.equal(visualResourceForScene(resources, "s1-split", "n1")?.handdraw?.data?.cacheKey, data.cacheKey);
assert.equal(visualResourceForScene(resources, "s2", "n1"), undefined);
console.info("handdraw.test 通过：像素合成、跳帧、画笔定位、预算和拆分资源");

// 先压缩空程、再加速出墨，时间图和笔尖共用同一映射；长镜头不强行慢画。
const pauseMotion: HanddrawMotion = {...motion, minimumDrawMs: 1000, points: [[0, 0, 0, 0], [600, 10, 0, 1], [1000, 30, 0, 0]]};
const liftMs = handdrawLiftMs(pauseMotion);
assert.equal(liftMs, 600);
const adapted = handdrawTiming({startMs: 0, endMs: 1800}, {...data, minimumDrawMs: 1000, motionTiming: {liftMs}});
assert.equal(adapted.speed, 1);
assert.equal(adapted.holdMs, 1000);
assert.ok(Math.abs(adapted.liftScale - 2 / 3) < 1e-9);
const track = handdrawPlaybackTrack(pauseMotion, adapted);
assert.ok(Math.abs(track.at(-1)!.playbackMs - adapted.drawDurationMs) < 1e-6);
assert.equal(handdrawSourceTimeAt(track, -1), -1);
assert.ok(Math.abs(handdrawSourceTimeAt(track, 400) - 600) < 1e-6);
assert.ok(Math.abs(handdrawSourceTimeAt(track, 600) - 800) < 1e-6);
assert.equal(handdrawSourceTimeAt(track, 801), 1000);
const expected = new Map([0, 100, 400, 600, 800].map((time) => [time, paintHanddrawPixels(pixels, handdrawSourceTimeAt(track, time))]));
for (const time of [800, 0, 600, 100, 400, 100]) assert.deepEqual(paintHanddrawPixels(pixels, handdrawSourceTimeAt(track, time)), expected.get(time));
assert.equal(handdrawTiming({startMs: 0, endMs: 1800}, {...data, minimumDrawMs: 8000}).acceleration, 10);
assert.throws(() => handdrawTiming({startMs: 0, endMs: 1800}, {...data, minimumDrawMs: 8001}), /超过 10 倍上限/);
assert.equal(handdrawTiming({startMs: 0, endMs: 10000}, data).acceleration, 1);
const briefBudget = handdrawPromptBudget({startMs: 0, endMs: 20000});
assert.equal(briefBudget.drawSeconds, 14);
assert.equal(briefBudget.holdSeconds, 6);
assert.equal(briefBudget.maxSubjects, 1);
assert.equal(briefBudget.maxColors, 3);
assert.ok(handdrawPromptBudget({startMs: 0, endMs: 60000}).maxStrokes > briefBudget.maxStrokes);
