import assert from "node:assert/strict";
import {
  detectFrameCorruptions,
  parseFrameDifferences,
  renderBrowserConfig,
  type FrameDifference,
} from "../lib/render-integrity";

const difference = (frame: number, yAverage: number): FrameDifference => ({
  frame,
  ptsTime: frame / 30,
  yAverage,
});

// 正常渐变和单次硬切都不构成“进入异常 + 离开异常”的双侧尖峰。
assert.deepEqual(detectFrameCorruptions([
  difference(1, 0.8),
  difference(2, 1.2),
  difference(3, 8),
  difference(4, 11.5),
  difference(5, 2),
]), []);

const isolated = detectFrameCorruptions([
  difference(22, 1),
  difference(23, 11.794),
  difference(24, 11.8186),
  difference(25, 0.6),
]);
assert.equal(isolated.length, 1);
assert.deepEqual(isolated[0], {
  startFrame: 23,
  endFrame: 23,
  startTimeMs: 767,
  endTimeMs: 800,
  entryDifference: 11.794,
  exitDifference: 11.8186,
});

// 两个连续坏帧会把进入和离开的尖峰隔开，仍需作为同一次短时异常拦截。
assert.equal(detectFrameCorruptions([
  difference(80, 12),
  difference(81, 1),
  difference(82, 12.5),
]).length, 1);
assert.equal(detectFrameCorruptions([
  difference(80, 12),
  difference(84, 12.5),
]).length, 0);

const parsed = parseFrameDifferences([
  "frame:23    pts:72000    pts_time:0.8",
  "lavfi.signalstats.YMIN=0",
  "lavfi.signalstats.YAVG=11.794",
  "frame:24    pts:75000    pts_time:0.833333",
  "lavfi.signalstats.YAVG=11.8186",
].join("\n"));
assert.deepEqual(parsed, [
  {frame: 23, ptsTime: 0.8, yAverage: 11.794},
  {frame: 24, ptsTime: 0.833333, yAverage: 11.8186},
]);

assert.deepEqual(renderBrowserConfig(undefined), {
  browserExecutable: null,
  chromeMode: "headless-shell",
  concurrency: "50%",
  customBrowser: false,
});
assert.deepEqual(renderBrowserConfig(" /custom/chrome "), {
  browserExecutable: "/custom/chrome",
  chromeMode: "headless-shell",
  concurrency: 1,
  customBrowser: true,
});

console.log("render integrity tests passed");
