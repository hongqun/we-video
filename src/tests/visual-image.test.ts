import assert from "node:assert/strict";
import {buildVisualImageSchedule, parseVisualImageData} from "../remotion/templates/visual-image";
import type {Caption, VideoScene} from "../remotion/schema";

const caption = (text: string, startMs: number, endMs: number): Caption => ({text, startMs, endMs, timestampMs: Math.round((startMs + endMs) / 2), confidence: null});
const scene = {id: "scene-generic", startMs: 11_577, endMs: 33_442, speechStartMs: 11_577, speechEndMs: 33_442} satisfies Pick<VideoScene, "id" | "startMs" | "endMs" | "speechStartMs" | "speechEndMs">;
const texts = [
  "RAG，全称是检索增强生成。",
  "简单说，就是先查资料，再让AI回答。",
  "普通大语言模型回答问题主要依赖训练时学到的知识，而RAG会在回答之前，先从你自己的知识库、文档、数据库里找出相关内容，",
  "再把内容连同问题一起交给大语言模型。",
];
const captions = [
  caption(texts[0]!, 11_577, 14_817),
  caption(texts[1]!, 14_817, 17_711),
  caption(texts[2]!, 17_711, 30_577),
  caption(texts[3]!, 30_585, 33_442),
];
const data = {
  imagePath: "artifact://uploaded-images/narration-02.png",
  imageWidth: 1672,
  imageHeight: 941,
  polygons: texts.map((text, index) => ({text, points: [{x: index * 0.1, y: index * 0.1}, {x: index * 0.1 + 0.3, y: index * 0.1}, {x: index * 0.1 + 0.3, y: index * 0.1 + 0.25}, {x: index * 0.1, y: index * 0.1 + 0.25}]})),
};

// 当前真实用例只作为输入样本，调度逻辑不读取场景序号或主题。
const schedule = buildVisualImageSchedule({scene, captions, data});
assert.equal(schedule.cues.length, 4);
assert.equal(schedule.stableWindowMs, 800);
assert.equal(schedule.stableStartMs, 32_642);
assert.equal(schedule.cues[0]?.revealStartMs, 11_577);
assert.equal(schedule.cues[0]?.revealEndMs, 13_683);
assert.equal(schedule.cues[2]?.revealEndMs, 20_111);
assert.equal(schedule.cues[3]?.revealEndMs, 32_442);
// 后续框只生成与历史并集的差集片段，笔尖也只会跟随这些片段。
assert.ok((schedule.cues[1]?.revealSegments.length ?? 0) > 0);
assert.ok((schedule.cues[1]?.revealSegments.reduce((sum, segment) => sum + segment.width * segment.height, 0) ?? 0) < 0.3 * 0.25);
const fullyCovered = buildVisualImageSchedule({scene: {id: "scene-covered", startMs: 0, endMs: 4_000, speechStartMs: 0, speechEndMs: 4_000}, captions: [caption("甲", 0, 2_000), caption("乙", 2_000, 4_000)], data: {...data, polygons: [
  {text: "甲", points: [{x: 0, y: 0}, {x: 0.5, y: 0}, {x: 0.5, y: 0.5}, {x: 0, y: 0.5}]},
  {text: "乙", points: [{x: 0, y: 0}, {x: 0.5, y: 0}, {x: 0.5, y: 0.5}, {x: 0, y: 0.5}]},
]}});
assert.equal(fullyCovered.cues[1]?.revealSegments.length, 0);

// 长口播按 65% 计算，但单块扫掠最多 2.4 秒。
const longScene = {id: "scene-long", startMs: 0, endMs: 12_000, speechStartMs: 0, speechEndMs: 12_000};
const longSchedule = buildVisualImageSchedule({scene: longScene, captions: [caption("一段持续十秒以上的通用讲解", 0, 11_000)], data: {...data, polygons: [{text: "一段持续十秒以上的通用讲解", points: [{x: 0.1, y: 0.1}, {x: 0.9, y: 0.1}, {x: 0.9, y: 0.9}, {x: 0.1, y: 0.9}]}]}});
assert.equal(longSchedule.cues[0]?.revealEndMs, 2_400);
assert.equal(longSchedule.cues[0]?.revealSegments.length, 20);

// 小区域按图片像素高度限次数，不再固定拆成 8 行后又额外拆分。
const smallRegion = buildVisualImageSchedule({scene: {id: "scene-small", startMs: 0, endMs: 2_000, speechStartMs: 0, speechEndMs: 2_000}, captions: [caption("小区域", 0, 1_000)], data: {...data, imageHeight: 941, polygons: [{text: "小区域", points: [{x: 0.1, y: 0.1}, {x: 0.9, y: 0.1}, {x: 0.9, y: 0.15}, {x: 0.1, y: 0.15}]}]}});
assert.equal(smallRegion.cues[0]?.revealSegments.length, 2);

// 可用时间不足时，扫描次数由最短带时长限制，而不是继续增加高度切分。
const shortScan = buildVisualImageSchedule({scene: {id: "scene-short-scan", startMs: 0, endMs: 1_500, speechStartMs: 0, speechEndMs: 1_500}, captions: [caption("短时扫描", 0, 500)], data: {...data, polygons: [{text: "短时扫描", points: [{x: 0.1, y: 0.1}, {x: 0.9, y: 0.1}, {x: 0.9, y: 0.9}, {x: 0.1, y: 0.9}]}]}});
assert.equal(shortScan.cues[0]?.revealSegments.length, 2);
assert.equal(shortScan.cues[0]?.revealSegments[0]?.reverse, false);
assert.equal(shortScan.cues[0]?.revealSegments[1]?.reverse, true);

assert.throws(() => parseVisualImageData(scene, {...data, polygons: [{text: "少点", points: [{x: 0, y: 0}, {x: 1, y: 1}]}]}), />=3/);
assert.throws(() => parseVisualImageData(scene, {...data, polygons: [{text: "自相交", points: [{x: 0, y: 0}, {x: 1, y: 1}, {x: 0, y: 1}, {x: 1, y: 0}]}]}), /多边形面积不能为零|多边形边线不能相交/);
assert.throws(() => buildVisualImageSchedule({scene, captions, data: {...data, polygons: [{text: "口播中不存在", points: [{x: 0, y: 0}, {x: 0.2, y: 0}, {x: 0.2, y: 0.2}]}]}}), /文字无法匹配口播/);
assert.throws(() => buildVisualImageSchedule({scene: {id: "scene-short", startMs: 0, endMs: 1_000, speechStartMs: 0, speechEndMs: 1_000}, captions: [caption("太短", 950, 1_000)], data: {...data, polygons: [{text: "太短", points: [{x: 0, y: 0}, {x: 0.2, y: 0}, {x: 0.2, y: 0.2}]}]}}), /没有足够时间/);

console.log("visual-image tests passed");
