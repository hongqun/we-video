import assert from "node:assert/strict";
import {assertNarrationTimingConsistency, buildNarrationSsml, calibrateCaptionAnomalies, calibrateNarrationSegments, clampCaptionsToSpeech, fallbackCaptionsForSegments, narrationSegmentsForDraft, normalizeCaptionRanges, normalizeCaptionTokens, parseWords, pauseAfterMs, reconcileCaptionsWithText, reconcileCaptionsWithTextDetailed, remapCaptionsToDisplayText, repairFragmentedEnglishCaptions, repairEnglishSegmentCaptions, segmentPauseMs} from "../lib/tts";

assert.equal(
  buildNarrationSsml([{id: "one", spokenText: "A&B"}, {id: "two", spokenText: "第二场"}], [520]),
  '<speak>A&amp;B<break time="520ms"/>第二场</speak>',
);
assert.equal(
  buildNarrationSsml([{id: "one", spokenText: "第一段", pauseAfter: "long"}, {id: "two", spokenText: "第二段", pauseAfter: "none"}]),
  '<speak>第一段<break time="700ms"/>第二段</speak>',
);
assert.equal(
  buildNarrationSsml([{id: "one", spokenText: "Client-Host-Server", ttsText: "Client Host Server"}]),
  "<speak>Client Host Server</speak>",
);
const remappedDisplayCaptions = remapCaptionsToDisplayText(
  [{text: "ClientHostServer", startMs: 0, endMs: 900, timestampMs: 450, confidence: null}],
  [{id: "one", spokenText: "Client-Host-Server", ttsText: "Client Host Server"}],
);
assert.equal(remappedDisplayCaptions.map((caption) => caption.text).join(""), "Client-Host-Server");
assert.ok(remappedDisplayCaptions.every((caption) => caption.endMs > caption.startMs));
assert.equal(segmentPauseMs({id: "one", spokenText: "第一段", pauseAfter: "none"}), 0);
assert.equal(segmentPauseMs({id: "one", spokenText: "第一段", pauseAfter: "short"}), 360);
assert.equal(segmentPauseMs({id: "one", spokenText: "第一段", pauseAfter: "medium"}), 520);
assert.equal(segmentPauseMs({id: "one", spokenText: "第一段", pauseAfter: "long"}), 700);
// 专题停顿覆盖用于合成时间轴，none 始终保持零停顿，未覆盖档位继续兼容旧值。
assert.equal(segmentPauseMs({id: "one", spokenText: "Hello", pauseAfter: "medium"}, {medium: 300}), 300);
assert.equal(segmentPauseMs({id: "one", spokenText: "Hello", pauseAfter: "none"}, {medium: 300}), 0);
assert.equal(segmentPauseMs({id: "one", spokenText: "Hello", pauseAfter: "short"}, {medium: 300}), 360);

// 英文回退字幕与历史字幕修复都必须保留单词边界。
assert.deepEqual(fallbackCaptionsForSegments([{id: "one", spokenText: "Hello everyone", pauseAfter: "none"}], 1_000, []).map((caption) => caption.text), ["Hello", "everyone"]);
assert.deepEqual(repairFragmentedEnglishCaptions(["H", "i", "e", "v", "e", "r", "y"].map((text, index) => ({text, startMs: index * 10, endMs: index * 10 + 10, timestampMs: index * 10 + 5, confidence: null})), "Hi every", 70).map((caption) => caption.text), ["Hi", "every"]);
// CosyVoice 偶尔把上一句结尾和下一段首词粘为同一个 token；修复后必须恢复确认稿的词界。
assert.deepEqual(repairFragmentedEnglishCaptions([
  {text: "autonomy.A", startMs: 0, endMs: 400, timestampMs: 200, confidence: null},
  {text: "workflow", startMs: 400, endMs: 700, timestampMs: 550, confidence: null},
], "autonomy. A workflow", 700).map((caption) => caption.text), ["autonomy.", "A", "workflow"]);
// 回贴必须按段分词；跨段首词只能归属本段，重复修复不改变时间戳。
const boundarySegments = [{id: "one", spokenText: "Done."}, {id: "two", spokenText: "An agent"}];
const boundaryCaptions = [
  {text: "Done.An", startMs: 0, endMs: 500, timestampMs: 250, confidence: null},
  {text: "agent", startMs: 900, endMs: 1300, timestampMs: 1100, confidence: null},
];
const remappedBoundary = remapCaptionsToDisplayText(boundaryCaptions, boundarySegments);
assert.deepEqual(remappedBoundary.map((item) => item.text), ["Done.", "An", "agent"]);
const boundaryTimings = [{id: "one", speechStartMs: 0, speechEndMs: 500}, {id: "two", speechStartMs: 800, speechEndMs: 1300}];
const repairedBoundary = repairEnglishSegmentCaptions(boundaryCaptions, boundarySegments, boundaryTimings);
assert.deepEqual(repairedBoundary.map((item) => item.text), ["Done.", "An", "agent"]);
assert.equal(repairedBoundary[1]!.startMs, 800);
assert.equal(repairedBoundary[2]!.startMs, 900);
assert.strictEqual(repairEnglishSegmentCaptions(repairedBoundary, boundarySegments, boundaryTimings), repairedBoundary);
// 中文、混排和正文不一致时不得尝试英文迁移。
assert.strictEqual(repairEnglishSegmentCaptions(boundaryCaptions, [{id: "one", spokenText: "中文 API"}], boundaryTimings), boundaryCaptions);
assert.strictEqual(repairEnglishSegmentCaptions(boundaryCaptions, [{id: "one", spokenText: "Different text"}], boundaryTimings), boundaryCaptions);
assert.deepEqual(
  narrationSegmentsForDraft({narrationSegments: [{id: "narration-01", spokenText: "只有口播段落", pauseAfter: "short"}]}),
  [{id: "narration-01", spokenText: "只有口播段落", pauseAfter: "short"}],
);
assert.deepEqual(
  narrationSegmentsForDraft({narrationSegments: [{id: "narration-01", spokenText: "Client-Host-Server", ttsText: "Client Host Server", pauseAfter: "none"}]}),
  [{id: "narration-01", spokenText: "Client-Host-Server", ttsText: "Client Host Server", pauseAfter: "none"}],
);
assert.throws(
  () => narrationSegmentsForDraft({
    narrationSegments: [{id: "narration-01", spokenText: "确认文字", pauseAfter: "short"}],
    scenes: [{id: "scene-01", spokenText: "过期文字"}],
  }),
  /narrationSegments 与视觉场景的口播文字不一致/,
);

assert.deepEqual(
  normalizeCaptionTokens([
    {text: "传", startMs: 0, endMs: 100, timestampMs: 50, confidence: null},
    {text: "统", startMs: 100, endMs: 180, timestampMs: 140, confidence: null},
    {text: "统", startMs: 100, endMs: 200, timestampMs: 150, confidence: null},
    {text: "R", startMs: 220, endMs: 300, timestampMs: 260, confidence: null},
    {text: "e", startMs: 300, endMs: 380, timestampMs: 340, confidence: null},
    {text: "m", startMs: 380, endMs: 460, timestampMs: 420, confidence: null},
    {text: "是A", startMs: 500, endMs: 700, timestampMs: 600, confidence: null},
    {text: " I", startMs: 720, endMs: 800, timestampMs: 760, confidence: null},
  ]).map((caption) => caption.text),
  ["传", "统", "Rem", "是", "AI"],
);

assert.deepEqual(
  parseWords({
    payload: {
      output: {
        type: "sentence-end",
        sentence: {
          words: [
            {text: "智", begin_time: 0, end_time: 120},
            {text: "谱", begin_time: 120, end_time: 240},
          ],
        },
      },
    },
  }).map((caption) => caption.text),
  ["智", "谱"],
);
assert.deepEqual(
  parseWords({payload: {output: {type: "sentence-begin", sentence: {words: [{text: "智", begin_time: 0, end_time: 120}]}}}}),
  [],
);

const declaredPauseFallback = fallbackCaptionsForSegments(
  [{id: "narration-01", spokenText: "第一段", pauseAfter: "medium"}, {id: "narration-02", spokenText: "第二段", pauseAfter: "none"}],
  2000,
  [520],
);
assert.equal(Math.round(declaredPauseFallback[3]!.startMs - declaredPauseFallback[2]!.endMs), 520);

const reconciled = reconcileCaptionsWithText([
  {text: "从", startMs: 0, endMs: 100, timestampMs: 50, confidence: null},
  {text: "Rem。", startMs: 100, endMs: 400, timestampMs: 250, confidence: null},
  {text: "视", startMs: 400, endMs: 500, timestampMs: 450, confidence: null},
], "从 Remotion 视频。", 1000);
assert.deepEqual(reconciled.map((caption) => caption.text), ["从", "Remotion", "视", "频", "。"]);
assert.equal(reconciled.at(-1)?.endMs, 1000);
const bounded = normalizeCaptionRanges([
  {text: "尾", startMs: 1000, endMs: 1000, timestampMs: 1000, confidence: null},
], 1000);
assert.equal(bounded.repairedCount, 1);
assert.equal(bounded.captions[0].startMs, 999);
assert.equal(bounded.captions[0].endMs, 1000);
const fractionalBounded = normalizeCaptionRanges([
  {text: "尾", startMs: 998.8, endMs: 999.1, timestampMs: 998.95, confidence: null},
], 1000);
assert.equal(fractionalBounded.captions[0].startMs, 998);
assert.equal(fractionalBounded.captions[0].endMs, 1000);
const overlapping = normalizeCaptionRanges([
  {text: "甲", startMs: 0, endMs: 100, timestampMs: 50, confidence: null},
  {text: "乙", startMs: 38, endMs: 200, timestampMs: 119, confidence: null},
], 1000);
assert.equal(overlapping.captions[1].startMs, 100);
assert.equal(overlapping.captions[1].endMs, 200);
const providerTimedFallback = reconcileCaptionsWithText(
  [{text: "甲", startMs: 100, endMs: 500, timestampMs: 300, confidence: null}],
  "甲乙丙丁戊",
  1000,
  {requireTimestampCoverage: true},
);
assert.equal(providerTimedFallback.length, 5);
assert.ok(providerTimedFallback.every((caption, index) => index === 0 || caption.startMs >= providerTimedFallback[index - 1].endMs));
const localTimestampFallback = reconcileCaptionsWithText(
  [
    {text: "甲", startMs: 100, endMs: 200, timestampMs: 150, confidence: null},
    {text: "丙", startMs: 400, endMs: 500, timestampMs: 450, confidence: null},
  ],
  "甲乙丙",
  1000,
  {requireTimestampCoverage: true},
);
assert.equal(localTimestampFallback[0]?.startMs, 100);
assert.equal(localTimestampFallback.at(-1)?.startMs, 400);
assert.ok(localTimestampFallback.every((caption, index) => index === 0 || caption.startMs >= localTimestampFallback[index - 1].endMs));
assert.equal(
  reconcileCaptionsWithText(
    [{text: "智谱五点三", startMs: 0, endMs: 900, timestampMs: 450, confidence: null}],
    "智谱5.3",
    1000,
    {requireTimestampCoverage: true},
  ).map((caption) => caption.text).join(""),
  "智谱5.3",
);
const emptyProviderFallback = reconcileCaptionsWithText([], "缺少完整口播时间戳", 1000, {requireTimestampCoverage: true});
assert.equal(emptyProviderFallback.length, 9);
assert.ok(emptyProviderFallback.every((caption, index) => index === 0 || caption.startMs >= emptyProviderFallback[index - 1].endMs));

// 回归：provider 把“乙”推迟数秒，但音频区间持续有声时，只校准该段异常后缀。
const testSampleRate = 1000;
const testFrames = 8200;
const testAudio = Buffer.alloc(44 + testFrames * 2);
testAudio.write("RIFF", 0); testAudio.write("WAVE", 8); testAudio.write("fmt ", 12); testAudio.writeUInt32LE(16, 16); testAudio.writeUInt16LE(1, 20); testAudio.writeUInt16LE(1, 22); testAudio.writeUInt32LE(testSampleRate, 24); testAudio.writeUInt32LE(testSampleRate * 2, 28); testAudio.writeUInt16LE(2, 32); testAudio.writeUInt16LE(16, 34); testAudio.write("data", 36); testAudio.writeUInt32LE(testFrames * 2, 40);
for (let frame = 100; frame < 8000; frame += 1) testAudio.writeInt16LE(10000, 44 + frame * 2);
const testCaptions = [{text: "甲", startMs: 0, endMs: 100, timestampMs: 50, confidence: null}, {text: "乙", startMs: 8000, endMs: 8100, timestampMs: 8050, confidence: null}, {text: "丙", startMs: 8100, endMs: 8200, timestampMs: 8150, confidence: null}];
const anomalyCalibration = calibrateCaptionAnomalies(
  testCaptions,
  [{id: "narration-01", startMs: 0, endMs: 8200, speechStartMs: 0, speechEndMs: 8200, pauseAfterMs: 0, transition: {kind: "fade", durationMs: 240}}],
  testAudio,
  {channels: 1, sampleRate: testSampleRate, bits: 16, bytesPerFrame: 2, dataOffset: 44, dataLength: testFrames * 2, durationMs: testFrames},
);
assert.equal(anomalyCalibration.anomalyCount, 1);
assert.ok((anomalyCalibration.captions[1]?.startMs ?? 0) < 8000);
const silentAudio = Buffer.alloc(testAudio.length);
testAudio.copy(silentAudio, 0, 0, 44);
const silentCalibration = calibrateCaptionAnomalies(testCaptions, [{id: "narration-01", startMs: 0, endMs: 8200, speechStartMs: 0, speechEndMs: 8200, pauseAfterMs: 0, transition: {kind: "fade", durationMs: 240}}], silentAudio, {channels: 1, sampleRate: testSampleRate, bits: 16, bytesPerFrame: 2, dataOffset: 44, dataLength: testFrames * 2, durationMs: testFrames});
assert.equal(silentCalibration.anomalyCount, 0);

// 回归（longanhuan_v3 实测形态）：word 流几乎吃掉所有句号、句尾截断几个字，
// 但在几十秒后幸存一个孤例句号。旧的全局贪心会把 expected 的"。"匹配到那个孤例上，
// 游标一次前跃数百字导致 575 字只匹配 38 个；局部窗口对齐后应保持高匹配率。
const periodEaten = reconcileCaptionsWithTextDetailed(
  [
    {text: "写代码也能做视频，还能批量生成", startMs: 86, endMs: 2764, timestampMs: 1425, confidence: null},
    {text: "Remotion是一个基于React的编程式视频制作框架，用熟悉的React和typescript语法，通过编写代码创建、编辑和渲", startMs: 3528, endMs: 13118, timestampMs: 8323, confidence: null},
    {text: "。", startMs: 19000, endMs: 19200, timestampMs: 19100, confidence: null},
  ],
  "写代码也能做视频，还能批量生成。Remotion是一个基于React的编程式视频制作框架，用熟悉的React和TypeScript语法，通过编写代码创建、编辑和渲染视频。",
  20000,
  {requireTimestampCoverage: true},
);
// 85 字中仅"染视频"3 个实义字来自插值；两处句号 miss 不计入插值率。
assert.equal(periodEaten.matchedCharacters, 81);
assert.equal(periodEaten.interpolatedCharacters, 3);
assert.equal(periodEaten.timestampAlignmentFallback, false);
// 匹配到的字符必须保留 provider 的真实时间戳（首字来自第一条 caption 的起始）。
assert.equal(Math.round(periodEaten.captions[0]?.startMs ?? -1), 86);

assert.equal(pauseAfterMs({id: "one", spokenText: "文本"}, undefined, 8000), 560);
assert.equal(pauseAfterMs({id: "one", spokenText: "文本", pauseAfter: "short"}, undefined, 8000), 360);
assert.equal(pauseAfterMs({id: "one", spokenText: "文本"}, {id: "two", spokenText: "文本"}, 8000), 580);

const segmentCaptions = [
  {text: "第一段", startMs: 100, endMs: 500, timestampMs: 300, confidence: null},
  {text: "第二段", startMs: 900, endMs: 1400, timestampMs: 1150, confidence: null},
];
const segmentTimings = calibrateNarrationSegments(
  segmentCaptions,
  [{id: "narration-01", spokenText: "第一段", pauseAfter: "medium"}, {id: "narration-02", spokenText: "第二段", pauseAfter: "none"}],
  2000,
  180,
);
assert.equal(segmentTimings[0].speechStartMs, 280);
assert.equal(segmentTimings[0].speechEndMs, 680);
assert.equal(segmentTimings[0].pauseAfterMs, 400);
assert.equal(segmentTimings[1].speechStartMs, 1080);
assert.equal(segmentTimings[1].endMs, 2180);

const roundedOverlapTimings = calibrateNarrationSegments(
  [
    {text: "甲", startMs: 100.2, endMs: 500.6, timestampMs: 300, confidence: null},
    {text: "乙", startMs: 499.6, endMs: 700.2, timestampMs: 600, confidence: null},
  ],
  [{id: "narration-01", spokenText: "甲", pauseAfter: "medium"}, {id: "narration-02", spokenText: "乙", pauseAfter: "none"}],
  800,
  0,
);
assert.equal(roundedOverlapTimings[0].pauseAfterMs, 0);
const repairedOverlapTimings = calibrateNarrationSegments(
  [
    {text: "甲", startMs: 100, endMs: 505, timestampMs: 300, confidence: null},
    {text: "乙", startMs: 443, endMs: 700, timestampMs: 600, confidence: null},
  ],
  [{id: "narration-01", spokenText: "甲", pauseAfter: "medium"}, {id: "narration-02", spokenText: "乙", pauseAfter: "none"}],
  800,
  0,
);
assert.equal(repairedOverlapTimings[0].pauseAfterMs, 0);

// 段末标点和下一段首字同时吸收 break 时，两侧必须复用同一边界回收量。
// 旧实现用当前段索引计算下一段起点，导致 pauseAfterMs 指向一个并不存在的起点。
const reclaimedBoundaryTimings = calibrateNarrationSegments(
  [
    {text: "甲", startMs: 0, endMs: 100, timestampMs: 50, confidence: null},
    {text: "。", startMs: 100, endMs: 700, timestampMs: 400, confidence: null},
    {text: "乙", startMs: 700, endMs: 1150, timestampMs: 925, confidence: null},
  ],
  [{id: "narration-01", spokenText: "甲。", pauseAfter: "medium"}, {id: "narration-02", spokenText: "乙", pauseAfter: "none"}],
  1300,
  0,
);
assert.equal(reclaimedBoundaryTimings[1].speechStartMs, 550);
assert.equal(
  reclaimedBoundaryTimings[0].speechEndMs + reclaimedBoundaryTimings[0].pauseAfterMs,
  reclaimedBoundaryTimings[1].speechStartMs,
);
assert.doesNotThrow(() => assertNarrationTimingConsistency(reclaimedBoundaryTimings, 1300));
assert.throws(() => assertNarrationTimingConsistency([
  {...reclaimedBoundaryTimings[0], pauseAfterMs: reclaimedBoundaryTimings[0].pauseAfterMs + 1},
  reclaimedBoundaryTimings[1],
], 1300), /停顿与口播时间轴不一致/);
const clampedMappedCaptions = clampCaptionsToSpeech([
  {text: "。", startMs: 100, endMs: 700, timestampMs: 400, confidence: null},
], [{...reclaimedBoundaryTimings[0], speechStartMs: 100, speechEndMs: 360}]);
assert.equal(clampedMappedCaptions[0].endMs, 360);

console.log("TypeScript TTS tests passed");
