import assert from "node:assert/strict";
import {compileCameraTrack, DEFAULT_CAMERA, getCameraState, resolveModelTime, modelSceneFrameCount, modelSceneLastFrame, localModelFrame} from "../remotion/templates/model-scene-camera";
import {cameraKey, ensureCameraBoundaries, freshCameraPlan, moveCameraKey, resetModelPlan, splitModelPlan} from "../remotion/templates/model-scene-editing";
import {modelSceneDataSchema, modelScenePlanSchema, type ModelScenePlan} from "../remotion/templates/model-scene-schema";
import {resolveModelSceneSchedule} from "../remotion/templates/model-scene-timing";
import {modelRenderGl} from "../lib/render-integrity";
import {visualResourceForScene} from "../lib/visual-resource-selection";
import {annotationLayout, annotationPointer, annotationStyle, dragLabelOffset, MODEL_WIDTH, MODEL_HEIGHT, type ModelAnnotation} from "../remotion/templates/model-scene-annotations";
import type {Caption, VideoScene} from "../remotion/schema";

const scene = {segmentId: "s1", startMs: 1000, endMs: 11000};
const captions: Caption[] = [{text: "MCU", startMs: 3000, endMs: 3500, timestampMs: 3000, confidence: null}];
const start = {...cameraKey(DEFAULT_CAMERA, 0, "start"), holdMs: 1000};
const finish = cameraKey({...DEFAULT_CAMERA, position: {x: 0, y: 0.84, z: -4.2}, fov: 60}, 5000, "finish");
const plan: ModelScenePlan = {schemaVersion: "2.0", keyframes: [start, finish], annotations: []};
const track = compileCameraTrack(plan, scene, captions, 30);
const expected = Array.from({length: 301}, (_, frame) => getCameraState(frame, track));
// 顺序、逆序、跨段随机跳帧不改变结果，也不修改持久化数据。
const serialized = JSON.stringify(plan);
for (const frame of [240, 0, 80, 150, 29, 149, 300, 42, ...Array.from({length: 301}, (_, i) => 300 - i)]) assert.deepEqual(getCameraState(frame, track), expected[frame]);
assert.equal(JSON.stringify(plan), serialized);
assert.deepEqual(getCameraState(29, track).position, DEFAULT_CAMERA.position);
assert.deepEqual(getCameraState(150, track).position, finish.position);
assert.deepEqual(getCameraState(300, track).position, finish.position);
const middle = getCameraState(90, track);
assert.ok(Math.hypot(middle.position.x, middle.position.y, middle.position.z) > 4, "对面视角过渡不能穿过模型中心");
assert.equal(middle.fov, 50);
assert.deepEqual(modelScenePlanSchema.parse(JSON.parse(serialized)), plan);
assert.throws(() => compileCameraTrack({...plan, keyframes: [start, {...finish, timeMs: 500}]}, scene, [], 30), /冲突/);
assert.throws(() => compileCameraTrack({...plan, keyframes: [start, {...finish, timeMs: 12000}]}, scene, [], 30), /超出/);
assert.throws(() => compileCameraTrack({...plan, keyframes: [{...start, position: start.target}]}, scene, [], 30), /重合/);
assert.throws(() => compileCameraTrack({...plan, keyframes: [{...start, timeMs: NaN}]}, scene, [], 30), /无效/);
assert.throws(() => compileCameraTrack(plan, scene, [], 0), /FPS/);
assert.equal(modelScenePlanSchema.safeParse({...plan, keyframes: [start, {...finish, id: start.id}]}).success, false);

// 时间绑定重新使用新字幕，显式拖动只改变偏移；纯时间关键帧保持镜头内时间。
const bound = {...finish, cueText: "MCU", offsetMs: 100};
assert.equal(resolveModelTime(bound, scene, captions), 2100);
const moved = moveCameraKey(bound, 2500, scene, captions);
assert.equal(moved.offsetMs, 500);
assert.equal(resolveModelTime(moved, scene, captions), 2500);
const translatedCaptions = captions.map((c) => ({...c, text: "controller", startMs: 4000}));
assert.equal(resolveModelTime({...moved, cueText: "controller"}, scene, translatedCaptions), 3500);
assert.throws(() => resolveModelTime(bound, scene, translatedCaptions), /未匹配/);
assert.equal(resolveModelTime(finish, scene, translatedCaptions), 5000);
assert.throws(() => compileCameraTrack(plan, {...scene, endMs: 4000}, captions, 30), /超出/);

const annotated = {...plan, annotations: [{id: "label", text: "MCU", cueText: "", timeMs: 1000, endMs: 6000, anchor: {x: 0, y: 0, z: 0}}]};
const [left, right] = splitModelPlan(annotated, scene, 3700, captions, 30);
const leftTrack = compileCameraTrack(left, {...scene, endMs: 3700}, captions, 30);
const rightTrack = compileCameraTrack(right, {...scene, startMs: 3700}, captions, 30);
const closePose = (actual: ReturnType<typeof getCameraState>, wanted: ReturnType<typeof getCameraState>) => {
  for (const field of ["position", "target"] as const) for (const axis of ["x", "y", "z"] as const) assert.ok(Math.abs(actual[field][axis] - wanted[field][axis]) < 1e-10);
  assert.ok(Math.abs(actual.fov - wanted.fov) < 1e-10);
};
for (let frame = 0; frame < 81; frame++) closePose(getCameraState(frame, leftTrack), getCameraState(frame, track));
for (let frame = 0; frame < 219; frame++) closePose(getCameraState(frame, rightTrack), getCameraState(frame + 81, track));
assert.equal(left.annotations[0]!.endMs, 2700);
assert.equal(right.annotations[0]!.timeMs, 0);
assert.equal(right.annotations[0]!.endMs, 3300);
right.keyframes![0]!.position.x = 999;
assert.notEqual(left.keyframes!.at(-1)!.position.x, 999);

const [exactLeft, exactRight] = splitModelPlan(annotated, scene, 6000, captions, 30);
exactRight.keyframes![0]!.position.x = 888;
assert.notEqual(exactLeft.keyframes!.at(-1)!.position.x, 888);
exactRight.annotations[0]!.anchor!.x = 888;
assert.equal(exactLeft.annotations[0]!.anchor!.x, 0);

// 停留中切开仍保持静止，未来关键帧的口播绑定继续保留。
const [, heldRight] = splitModelPlan(plan, scene, 1500, captions, 30);
const heldTrack = compileCameraTrack(heldRight, {...scene, startMs: 1500}, captions, 30);
closePose(getCameraState(10, heldTrack), DEFAULT_CAMERA);
const boundPlan = {...plan, keyframes: [start, {...finish, cueText: "MCU", offsetMs: 3000}]};
const [, boundRight] = splitModelPlan(boundPlan, scene, 2500, captions, 30);
assert.equal(boundRight.keyframes!.find((k) => k.id === "finish")!.cueText, "MCU");
assert.equal(boundRight.keyframes!.length, 3, "拆分不能将用户轨道膨胀为每帧一个关键帧");

// 旧动作、混合格式和缺少显式关键帧的输入必须拒绝，不自动转换。
for (const invalid of [
  {motions: [{id: "orbit", kind: "orbit", cueText: ""}], annotations: []},
  {...plan, motions: []},
  {...plan, schemaVersion: undefined},
  {...plan, keyframes: undefined},
  {...plan, keyframes: []},
]) {
  assert.equal(modelScenePlanSchema.safeParse(invalid).success, false);
  assert.throws(() => resolveModelSceneSchedule(scene as VideoScene, [], {...invalid, modelPath: "model.glb"}));
}
const fresh = freshCameraPlan(scene);
assert.equal(fresh.keyframes.length, 2, "新编排自动生成首尾两个全景，不生成环绕动作");
const freshTrack = compileCameraTrack(fresh, scene, [], 30);
for (const frame of [0, 30, 90, 299]) closePose(getCameraState(frame, freshTrack), DEFAULT_CAMERA);
const reset = resetModelPlan(scene, annotated);
assert.equal(reset.keyframes!.length, 2);
assert.equal(reset.annotations[0]!.text, "MCU");
assert.equal(reset.annotations[0]!.anchor, undefined);
assert.equal(modelSceneDataSchema.safeParse({...reset, modelPath: "model.glb"}).success, false);
const scheduled = resolveModelSceneSchedule(scene as VideoScene, captions, {...annotated, modelPath: "model.glb"});
assert.equal(scheduled.annotations[0]!.startMs, 2000);
assert.equal(scheduled.annotations[0]!.endMs, 7000);
assert.throws(() => resolveModelSceneSchedule(scene as VideoScene, captions, {...annotated, modelPath: "model.glb", annotations: [{...annotated.annotations[0], endMs: 12000}]}), /超出/);
assert.equal(modelRenderGl(undefined), "swangle");
assert.equal(modelRenderGl(" angle "), "angle");
assert.throws(() => modelRenderGl("broken"), /无效/);
const resources = {resources: [{sceneId: "s1", segmentId: "p1", modelPath: "uploaded-models/s1-hash.glb", polygons: []}]};
assert.equal(visualResourceForScene(resources, "s1-split", "p1")?.modelPath, resources.resources[0]!.modelPath);
assert.equal(visualResourceForScene(resources, "other", "p1"), undefined);
// 两端位于真正可播放的边界；保护时间、绑定和尾部停留。
assert.equal(fresh.keyframes[0]!.boundary, "start");
assert.equal(fresh.keyframes[1]!.boundary, "end");
assert.equal(frameAt(fresh.keyframes[1]!.timeMs), 299);
assert.throws(() => moveCameraKey(fresh.keyframes[0]!, 500, scene, []), /首尾/);
assert.throws(() => compileCameraTrack({...fresh, keyframes: [fresh.keyframes[0]!, {...fresh.keyframes[1]!, holdMs: 100}]}, scene, [], 30), /首尾/);
assert.throws(() => compileCameraTrack({...fresh, keyframes: [{...fresh.keyframes[0]!, cueText: "MCU"}, fresh.keyframes[1]!] }, scene, captions, 30), /首尾/);
const single: ModelScenePlan = {schemaVersion: "2.0", keyframes: [cameraKey(DEFAULT_CAMERA, 0, "single")], annotations: []};
const bounded = ensureCameraBoundaries(single, scene, [], 30);
assert.equal(single.keyframes.length, 1, "补边界不修改传入草稿");
assert.equal(bounded.keyframes.length, 2);
assert.equal(bounded.keyframes[0]!.id, "single");
closePose(getCameraState(299, compileCameraTrack(bounded, scene, [], 30)), DEFAULT_CAMERA);
const asymmetric = ensureCameraBoundaries(plan, scene, captions);
closePose(getCameraState(299, compileCameraTrack(asymmetric, scene, captions, 30)), finish);
const changedLength = ensureCameraBoundaries(fresh, {...scene, endMs: 12000}, []);
assert.equal(frameAt(changedLength.keyframes.at(-1)!.timeMs), 329);
assert.equal(changedLength.keyframes.at(-1)!.id, fresh.keyframes[1]!.id);
const shorter = ensureCameraBoundaries(asymmetric, {...scene, endMs: 4000}, []);
assert.ok(shorter.keyframes.some((k) => k.id === finish.id), "缩短时长保留冲突的中间关键帧供用户修复");
assert.throws(() => compileCameraTrack(shorter, {...scene, endMs: 4000}, [], 30), /超出|冲突/);
const oneFrameScene = {...scene, endMs: scene.startMs + 33};
const oneFrame = freshCameraPlan(oneFrameScene);
assert.equal(oneFrame.keyframes.length, 1);
assert.equal(modelSceneLastFrame(oneFrameScene, 30), 0);
compileCameraTrack(oneFrame, oneFrameScene, [], 30);
const twoFrames = freshCameraPlan({...scene, endMs: scene.startMs + 67});
assert.equal(frameAt(twoFrames.keyframes[1]!.timeMs), 1);
const fractionalScene = {segmentId: "fractional", startMs: 9058, endMs: 64495};
assert.equal(modelSceneFrameCount(fractionalScene, 30), Math.round(64495 * 30 / 1000) - Math.round(9058 * 30 / 1000));
assert.equal(localModelFrame(9066.666666666666, fractionalScene, 30), 0);
assert.equal(left.keyframes[0]!.boundary, "start");
assert.equal(left.keyframes.at(-1)!.boundary, "end");
assert.equal(frameAt(left.keyframes.at(-1)!.timeMs), 80);
assert.equal(frameAt(right.keyframes.at(-1)!.timeMs), 218);

// 预览缩放只改变屏幕尺寸，不改变标签画幅坐标；所有样式都限制在画面内。
assert.deepEqual(annotationPointer({x: 486, y: 370}, {left: 10, top: 20, width: 952, height: 700}), {x: 476, y: 350});
assert.deepEqual(annotationPointer({x: 248, y: 195}, {left: 10, top: 20, width: 476, height: 350}), {x: 476, y: 350});
const label: ModelAnnotation = {...annotated.annotations[0]!, text: "MCU 主控芯片"};
assert.equal(annotationStyle(label).preset, "callout");
for (const preset of ["tag", "callout", "bubble"] as const) {
  for (const anchor of [{x: 1, y: 1}, {x: 951, y: 699}, {x: 476, y: 350}]) {
    const variant = {...label, style: {preset, fontSize: 48}, labelOffset: {x: 0.9, y: 0.9}};
    const layout = annotationLayout(variant, anchor);
    assert.ok(layout.x >= 0 && layout.y >= 0);
    assert.ok(layout.x + layout.width <= MODEL_WIDTH && layout.y + layout.height <= MODEL_HEIGHT);
    const offset = dragLabelOffset(variant, anchor, {x: -1000, y: 2000});
    const movedLayout = annotationLayout({...variant, labelOffset: offset}, anchor);
    assert.ok(movedLayout.x >= 0 && movedLayout.y + movedLayout.height <= MODEL_HEIGHT);
    assert.deepEqual(label.anchor, annotated.annotations[0]!.anchor, "拖动文字不能改变部件锚点");
  }
}
const styled = {...label, style: {preset: "bubble" as const, accentColor: "#ffaa00", textColor: "#101010", backgroundColor: "#ffffff", fontSize: 36, showLine: false}, labelOffset: {x: 0.2, y: -0.1}};
assert.deepEqual(modelScenePlanSchema.parse({...plan, annotations: [styled]}).annotations[0], styled);
const styledReset = resetModelPlan(scene, {...plan, annotations: [styled]});
assert.deepEqual(styledReset.annotations[0]!.style, styled.style);
assert.deepEqual(styledReset.annotations[0]!.labelOffset, styled.labelOffset);
assert.equal(styledReset.annotations[0]!.anchor, undefined);
assert.equal(modelScenePlanSchema.safeParse({...plan, annotations: [{...styled, style: {...styled.style, accentColor: "red"}}]}).success, false);
assert.ok(annotationLayout({...styled, text: "很长的芯片标注内容".repeat(50)}, {x: 950, y: 5}).lines.length <= 6);
function frameAt(ms: number) {return Math.round(ms * 30 / 1000);}
console.log("model scene contracts passed");
