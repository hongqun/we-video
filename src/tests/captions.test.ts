import assert from "node:assert/strict";
import type {Caption} from "../remotion/schema";

const caption = (text: string, startMs: number, endMs: number): Caption => ({text, startMs, endMs, timestampMs: Math.round((startMs + endMs) / 2), confidence: null});
// 测试以 CommonJS 方式加载 Remotion TSX 模块，避免改变现有 tsx 运行入口。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const captionModule = require("../remotion/Captions") as {
  paginateChineseCaptions: (captions: Caption[]) => Array<{text?: string; tokens: Caption[]}>;
  captionTokenMotion: (elapsedFrames: number) => {translateY: number; rotate: number; opacity: number};
  captionTokenColor: (elapsedFrames: number, baseColor: string, accentColor?: string) => string;
};
const paginateChineseCaptions = captionModule.paginateChineseCaptions;
const captionTokenMotion = captionModule.captionTokenMotion;
const captionTokenColor = captionModule.captionTokenColor;
// 与上方 Remotion TSX 加载方式保持一致。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {repairFragmentedEnglishCaptions} = require("../lib/tts") as {
  repairFragmentedEnglishCaptions: (captions: Caption[], spokenText: string, durationMs: number) => Caption[];
};

const pages = paginateChineseCaptions([
  caption("第一，三个区域。第二，四大对象。", 0, 4_000),
  caption("这是一段没有标点但超过二十字的内容用于验证硬上限。", 4_000, 8_000),
]);

assert.deepEqual(pages.slice(0, 2).map((page) => page.tokens.map((token) => token.text).join("")), ["第一，三个区域。", "第二，四大对象。"]);
assert.ok(pages.every((page) => [...page.tokens].reduce((total, token) => total + [...token.text].length, 0) <= 20));
assert.equal(pages.map((page) => page.tokens.map((token) => token.text).join("")).join(""), "第一，三个区域。第二，四大对象。这是一段没有标点但超过二十字的内容用于验证硬上限。");
assert.ok(pages.length >= 4);

const introPages = paginateChineseCaptions([caption("Git的底层到底是怎么工作的？要搞懂它，记住三个区域和一个快照理念就够了。", 0, 8_000)]);
assert.deepEqual(introPages.slice(0, 3).map((page) => page.tokens.map((token) => token.text).join("")), [
  "Git的底层到底是怎么工作的？",
  "要搞懂它，",
  "记住三个区域和一个快照理念就够了。",
]);

const englishPages = paginateChineseCaptions([
  caption("Hello", 0, 400),
  caption("everyone.", 400, 1_100),
  caption("In", 1_100, 1_300),
  caption("the", 1_300, 1_550),
]);
assert.deepEqual(englishPages[0]?.tokens.map((token) => token.text), ["Hello", "everyone.", "In", "the"]);
assert.equal(englishPages[0]?.tokens.map((token) => token.text).join(" "), "Hello everyone. In the");

// 历史英文任务的逐字符回退字幕必须按确认稿中的空格恢复单词。
assert.deepEqual(
  repairFragmentedEnglishCaptions([caption("H", 0, 50), caption("i", 50, 100), caption("e", 100, 150), caption("v", 150, 200), caption("e", 200, 250), caption("r", 250, 300), caption("y", 300, 350), caption("o", 350, 400), caption("n", 400, 450), caption("e", 450, 500)], "Hi everyone", 500).map((item) => item.text),
  ["Hi", "everyone"],
);

const beforeToken = captionTokenMotion(-1);
assert.deepEqual(beforeToken, {translateY: 0, rotate: 0, opacity: 0.72});
const firstNudge = captionTokenMotion(0);
assert.equal(firstNudge.translateY, 3);
assert.equal(firstNudge.rotate, -0.4);
assert.equal(firstNudge.opacity, 0.72);
const settledNudge = captionTokenMotion(12);
assert.equal(settledNudge.translateY, 0);
assert.equal(settledNudge.rotate, 0);
assert.equal(settledNudge.opacity, 0.72);
assert.ok(captionTokenMotion(4).translateY < 0);
assert.ok(Math.abs(captionTokenMotion(4).rotate) <= 0.201);
assert.equal(captionTokenMotion(4).opacity, 1);
assert.equal(captionTokenColor(-1, "#10231B", "#20D34F"), "#10231B");
assert.equal(captionTokenColor(0, "#10231B", "#20D34F"), "rgba(16, 35, 27, 1)");
assert.equal(captionTokenColor(4, "#10231B", "#20D34F"), "rgba(32, 211, 79, 1)");
assert.equal(captionTokenColor(12, "#10231B", "#20D34F"), "rgba(16, 35, 27, 1)");

console.log("captions.test 通过：整页预显、逐字拨动、标点优先分页并遵守单页字数上限");
