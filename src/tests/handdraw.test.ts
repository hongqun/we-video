/* eslint-disable @remotion/non-pure-animation -- 测试时间是输入夹具，不参与组件动画。 */
import assert from "node:assert/strict";
import {HANDDRAW_VERSION, handdrawMotionSchema, handdrawToolAt, handdrawDataSchema, handdrawPenAt, handdrawTemplateData, handdrawTiming, handdrawLiftMs, handdrawPlaybackTrack, handdrawSourceTimeAt, handdrawPromptBudget, type HanddrawData, type HanddrawMotion} from "../remotion/templates/handdraw-schema";
import {decodeHanddrawTimes, paintHanddrawPixels, handdrawPaperTimes} from "../remotion/templates/handdraw-pixels";
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

const data: HanddrawData = {algorithmVersion: "handdraw-5", cacheKey: "a".repeat(64), width: 100, height: 100, minimumDrawMs: 2000, completePath: "complete.png", lineLayerPath: "line.png", colorLayerPath: "color.png", lineTimePath: "line-time.png", colorTimePath: "color-time.png", motionPath: "motion.json", hashes: {}};
assert.equal(handdrawTiming({startMs: 0, endMs: 4000}, data).drawDurationMs, 2000);
assert.equal(handdrawTiming({startMs: 0, endMs: 4000}, data).holdMs, 2000);
assert.equal(handdrawTiming({startMs: 0, endMs: 2500}, data).drawDurationMs, 1500);
assert.throws(() => handdrawTiming({startMs: 0, endMs: 2500}, {...data, minimumDrawMs: 16000}), /超过 10 倍上限/);
assert.equal(handdrawTiming({startMs: 5000, endMs: 9500, transition: {durationMs: 300}}, data).drawStartMs, 300);
assert.equal(handdrawDataSchema.safeParse({...data, algorithmVersion: "old"}).success, false);
assert.equal(handdrawTemplateData({status: "processing"}, (path) => path), undefined);
assert.equal(handdrawTemplateData({status: "ready", data}, (path) => `artifact://${path}`)?.motionPath, "artifact://motion.json");
const motion: HanddrawMotion = {algorithmVersion: "handdraw-5", cacheKey: data.cacheKey, width: 100, height: 100, minimumDrawMs: 2000, points: [[50, 0, 0, 0], [100, 10, 20, 1], [200, 20, 40, 1], [2000, 20, 40, 0]]};
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

// 新版四阶段契约与工具切换，缺少任一辅助产物时拒绝播放。
const stages = {sketchEndMs: 300, lineEndMs: 700, eraseEndMs: 1000, colorEndMs: 1900};
const modernData: HanddrawData = {...data, algorithmVersion: HANDDRAW_VERSION, sketchLayerPath: "sketch.png", sketchTimePath: "sketch-time.png", eraseTimePath: "erase-time.png", stageTimings: stages};
assert.ok(handdrawDataSchema.safeParse(modernData).success);
for (const field of ["sketchLayerPath", "sketchTimePath", "eraseTimePath", "stageTimings"] as const) assert.equal(handdrawDataSchema.safeParse({...modernData, [field]: undefined}).success, false);
for (const version of ["handdraw-1", "handdraw-2", "handdraw-3", "handdraw-4", "handdraw-5"]) assert.ok(handdrawDataSchema.safeParse({...data, algorithmVersion: version}).success);
assert.equal(handdrawTemplateData({status: "ready", data: modernData}, (path) => `artifact://${path}`)?.eraseTimePath, "artifact://erase-time.png");
assert.equal(handdrawDataSchema.safeParse({...modernData, stageTimings: {...stages, eraseEndMs: 600}}).success, false);
const modernMotion: HanddrawMotion = {...motion, algorithmVersion: HANDDRAW_VERSION, stageTimings: stages, points: [[0, 0, 0, 0], [50, 10, 10, 3], [250, 20, 20, 0], [350, 10, 10, 1], [650, 20, 20, 0], [750, 10, 10, 4], [950, 20, 20, 0], [1050, 10, 10, 2], [1900, 20, 20, 0]]};
assert.ok(handdrawMotionSchema.safeParse(modernMotion).success);
assert.equal(handdrawMotionSchema.safeParse({...modernMotion, stageTimings: undefined}).success, false);
assert.equal(handdrawMotionSchema.safeParse({...modernMotion, points: [[100, 0, 0, 3], [50, 0, 0, 1]]}).success, false);
for (const [time, tool] of [[0, "pencil"], [100, "pencil"], [300, "ink"], [400, "ink"], [700, "eraser"], [800, "eraser"], [1000, "marker"], [1200, "marker"]] as const) assert.equal(handdrawToolAt(modernMotion, time), tool);
const modernPixels = {...pixels, sketch: new Uint8ClampedArray([105, 145, 196, 110, 105, 145, 196, 110]), sketchTimes: new Uint32Array([10, 20]), eraseTimes: new Uint32Array([250, 260]), smooth: true};
const sketchFrame = paintHanddrawPixels(modernPixels, 80);
assert.ok(sketchFrame[0]! < 255 && sketchFrame[0]! > 105);
assert.equal(paintHanddrawPixels(modernPixels, 200)[0], 0);
// 橡皮擦清掉辅助线后，已有墨线保持不变；成图不留下蓝线或笔道。
assert.deepEqual([...paintHanddrawPixels(modernPixels, 280)], [0, 0, 0, 255, 255, 255, 255, 255]);
assert.deepEqual(paintHanddrawPixels(modernPixels, 2000), paintHanddrawPixels(pixels, 2000));
const modernTiming = handdrawTiming({startMs: 0, endMs: 2800}, {...modernData, motionTiming: {liftMs: handdrawLiftMs(modernMotion)}});
const modernTrack = handdrawPlaybackTrack(modernMotion, modernTiming);
assert.ok(Math.abs(modernTrack.at(-1)!.playbackMs - modernTiming.drawDurationMs) < 1e-6);
const frameAt = (time: number) => paintHanddrawPixels(modernPixels, handdrawSourceTimeAt(modernTrack, time));
const frames = new Map([0, 50, 200, 800, 1500, 1800].map((time) => [time, frameAt(time)]));
for (const time of [1800, 200, 0, 800, 50, 1500, 200]) assert.deepEqual(frameAt(time), frames.get(time));
assert.ok(Math.abs(briefBudget.preparationSeconds - briefBudget.drawSeconds * .2) < 1e-6);
assert.ok(briefBudget.maxStrokes < Math.floor(briefBudget.drawSeconds * 1.8));
console.info("handdraw-6 通过：四阶段契约、工具、起形擦除、旧版兼容及乱序定位");

// 透明纸底保留封闭物体内部的白色，画外和未开始绘制的画布保持透明。
const paperFixture = {line: new Uint8ClampedArray(7 * 7 * 4), color: new Uint8ClampedArray(7 * 7 * 4), lineTimes: new Uint32Array(49).fill(0xffffffff), colorTimes: new Uint32Array(49).fill(0xffffffff)};
for (let y = 1; y <= 5; y++) for (let x = 1; x <= 5; x++) {
  if (x !== 1 && x !== 5 && y !== 1 && y !== 5) continue;
  const i = y * 7 + x;
  paperFixture.line[i * 4 + 3] = 255;
  paperFixture.lineTimes[i] = x === 5 ? 200 : 100;
}
const paperTimes = handdrawPaperTimes(paperFixture, 7, 7);
assert.equal(paperTimes[0], 0xffffffff);
assert.equal(paperTimes[3 * 7 + 3], 200);
const transparentFixture = {...paperFixture, paperTimes, transparent: true};
assert.ok(paintHanddrawPixels(transparentFixture, -1).every((value) => value === 0));
assert.equal(paintHanddrawPixels(transparentFixture, 150)[(3 * 7 + 3) * 4 + 3], 0);
const finished = paintHanddrawPixels(transparentFixture, 300);
assert.deepEqual([...finished.slice((3 * 7 + 3) * 4, (3 * 7 + 3) * 4 + 4)], [255, 255, 255, 255]);
assert.equal(finished[3], 0);
assert.equal(finished[(1 * 7 + 1) * 4 + 3], 255);
// 开放轮廓不猜测人物边界，避免把整张画布误判成白色物体。
paperFixture.line[(1 * 7 + 3) * 4 + 3] = 0;
paperFixture.lineTimes[1 * 7 + 3] = 0xffffffff;
assert.equal(handdrawPaperTimes(paperFixture, 7, 7)[3 * 7 + 3], 0xffffffff);
const translucent = {...pixels, transparent: true, line: new Uint8ClampedArray([0, 0, 0, 128, 0, 0, 0, 0])};
assert.deepEqual([...paintHanddrawPixels(translucent, 200).slice(0, 4)], [0, 0, 0, 128]);
console.info("手绘透明背景通过：画外透明、内部白色保护、边界显现时机及无白边合成");
