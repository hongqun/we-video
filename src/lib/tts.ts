/* eslint-disable @typescript-eslint/no-explicit-any, no-empty, no-useless-escape */
import {promises as fs} from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import WebSocket from "ws";
import type {PipelineSettings} from "./pipeline-settings";
import type {RenderManifest, Caption} from "@/remotion/schema";
import {renderManifestSchema} from "@/remotion/schema";
import type {PlatformProfile} from "./profile";

type RawCaption = Caption;
type TtsTimestampDiagnostics = {
  providerMessageCount: number;
  providerMessagesWithWords: number;
  providerWordCount: number;
  providerCaptionCount: number;
  providerCharacterCount: number;
  // 供应商实际返回的字幕文本样本：匹配崩坏时可直接看出 provider 文本与确认稿的差异形态。
  providerObservedText?: string;
  expectedCharacterCount: number;
  matchedCharacters?: number;
  interpolatedCharacters?: number;
  reconciledCaptionCount?: number;
  reconciledCharacterCount?: number;
  fittedCaptionCount?: number;
  fittedCharacterCount?: number;
  wavDurationMs?: number;
  lastCaptionEndMs?: number;
  calibrationSegmentCount?: number;
  boundaryRepairCount?: number;
  timestampAlignmentFallback?: boolean;
  segmentTimelineFallback?: boolean;
  timestampAnomalyCount?: number;
  timestampAnomalyReasons?: string[];
  calibratedCaptionCount?: number;
};
export type SceneDraft = Record<string, any> & {spokenText: string; id: string};
export type NarrationSegmentDraft = {
  id: string;
  spokenText: string;
  ttsText?: string;
  pauseAfter?: "none" | "short" | "medium" | "long";
  keywords?: string[];
};

// 发音覆盖只影响合成和供应商时间戳匹配，显示文本仍由 spokenText 统一承载。
export const narrationAudioText = (segment: Pick<NarrationSegmentDraft, "spokenText" | "ttsText">) => segment.ttsText?.trim() || segment.spokenText;

export const narrationSegmentsForDraft = (draft: Record<string, any>): NarrationSegmentDraft[] => {
  const scenes = Array.isArray(draft.scenes) ? draft.scenes as SceneDraft[] : [];
  const candidate = Array.isArray(draft.narrationSegments) ? draft.narrationSegments as NarrationSegmentDraft[] : [];
  if (candidate.length) {
    if (!scenes.length || (candidate.length === scenes.length && candidate.every((segment, index) => segment.spokenText === scenes[index].spokenText))) {
      return candidate.map((segment) => {
        const pauseAfter = (segment as {pauseAfter?: string}).pauseAfter;
        return {
          ...segment,
          pauseAfter: pauseAfter === "auto" ? "medium" : pauseAfter as NarrationSegmentDraft["pauseAfter"],
        };
      });
    }
    throw new Error("narrationSegments 与视觉场景的口播文字不一致");
  }
  return scenes.map((scene, index) => ({
    id: `narration-${String(index + 1).padStart(2, "0")}`,
    spokenText: scene.spokenText,
    pauseAfter: scene.pauseAfter === "auto" ? "medium" : scene.pauseAfter ?? "medium",
  }));
};

const pausePresets: Record<string, number> = {none: 0, short: 360, medium: 520, long: 700};

const escapeXml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");

// 专题只调整停顿档位的时长，保留用户选择的档位及 none 的零停顿语义。
export const segmentPauseMs = (segment: NarrationSegmentDraft, overrides?: PipelineSettings["tts"]["pauseMs"]) => {
  if (segment.pauseAfter === "none") return 0;
  if (segment.pauseAfter && segment.pauseAfter in pausePresets) return overrides?.[segment.pauseAfter as "short" | "medium" | "long"] ?? pausePresets[segment.pauseAfter];
  return overrides?.medium ?? 520;
};

export const buildNarrationSsml = (segments: NarrationSegmentDraft[], pausesMs?: number[]) => {
  const pauses = pausesMs ?? segments.slice(0, -1).map((segment) => segmentPauseMs(segment));
  if (pauses.length !== Math.max(0, segments.length - 1)) throw new Error("整段口播的段落停顿数量无效");
  return `<speak>${segments.map((segment, index) => `${escapeXml(narrationAudioText(segment))}${index < pauses.length && pauses[index] > 0 ? `<break time="${Math.trunc(pauses[index])}ms"/>` : ""}`).join("")}</speak>`;
};

const isAsciiWord = (value: string) => Boolean(value) && [...value].every((c) => /[A-Za-z0-9+#._\/'’-]/.test(c));

export const normalizeCaptionTokens = (captions: RawCaption[]): RawCaption[] => {
  const unique = new Map<string, RawCaption>();
  for (const caption of captions) {
    const text = caption.text.trim();
    if (!text) continue;
    const key = `${text}\u0000${caption.startMs}`;
    const current = unique.get(key);
    if (!current || caption.endMs > current.endMs) unique.set(key, {...caption, text});
  }
  const split: RawCaption[] = [];
  for (const caption of [...unique.values()].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)) {
    const runs: string[] = [];
    for (const char of caption.text) {
      if (runs.length && isAsciiWord(runs.at(-1)!) === isAsciiWord(char)) runs[runs.length - 1] += char;
      else runs.push(char);
    }
    if (runs.length === 1) { split.push(caption); continue; }
    let consumed = 0;
    const duration = caption.endMs - caption.startMs;
    for (const run of runs) {
      const startMs = caption.startMs + Math.round(duration * consumed / caption.text.length);
      consumed += run.length;
      const endMs = caption.startMs + Math.round(duration * consumed / caption.text.length);
      split.push({...caption, text: run, startMs, endMs, timestampMs: Math.round((startMs + endMs) / 2)});
    }
  }
  const merged: RawCaption[] = [];
  for (const caption of split) {
    const previous = merged.at(-1);
    if (previous && isAsciiWord(previous.text) && isAsciiWord(caption.text) && caption.startMs - previous.endMs <= 240) {
      previous.text += caption.text;
      previous.endMs = Math.max(previous.endMs, caption.endMs);
      previous.timestampMs = Math.round((previous.startMs + previous.endMs) / 2);
    } else merged.push({...caption});
  }
  return merged;
};

const fitCaptions = (captions: RawCaption[], durationMs: number) => captions.flatMap((caption) => {
  const startMs = Math.max(0, Math.trunc(caption.startMs));
  if (startMs >= durationMs) return [];
  const endMs = Math.min(durationMs, Math.trunc(caption.endMs));
  if (endMs <= startMs) return [];
  return [{...caption, startMs, endMs, timestampMs: caption.timestampMs == null ? null : Math.min(endMs, Math.max(startMs, Math.trunc(caption.timestampMs)))}];
});

export const normalizeCaptionRanges = (captions: RawCaption[], durationMs: number) => {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return {captions, repairedCount: 0};
  const boundedDuration = Math.max(1, Math.trunc(durationMs));
  let repairedCount = 0;
  let previousEndMs = 0;
  const normalized = captions.map((caption, index) => {
    let startMs = Number.isFinite(caption.startMs) ? Math.trunc(caption.startMs) : 0;
    let endMs = Number.isFinite(caption.endMs) ? Math.ceil(caption.endMs) : startMs + 1;
    const originalStart = startMs;
    const originalEnd = endMs;
    const remainingCaptions = captions.length - index - 1;
    const maxEndMs = Math.max(1, boundedDuration - remainingCaptions);
    const maxStartMs = Math.max(0, maxEndMs - 1);
    startMs = Math.min(Math.max(previousEndMs, Math.max(0, startMs)), maxStartMs);
    // 极短区间在 30fps 下容易被舍入吞掉；只在不挤压后续字幕的范围内补足。
    const minimumDurationMs = 8;
    const minimumEndMs = Math.min(maxEndMs, startMs + minimumDurationMs);
    endMs = Math.min(Math.max(minimumEndMs, endMs), maxEndMs);
    if (startMs !== originalStart || endMs !== originalEnd) repairedCount += 1;
    previousEndMs = endMs;
    return {...caption, startMs, endMs, timestampMs: Math.round((startMs + endMs) / 2)};
  });
  return {captions: normalized, repairedCount};
};

const captionCharacters = (captions: RawCaption[]) => captions.flatMap((caption) => {
  const chars = [...caption.text].filter((c) => !/\s/.test(c));
  const duration = caption.endMs - caption.startMs;
  return chars.map((text, index) => {
    const startMs = caption.startMs + duration * index / chars.length;
    const endMs = caption.startMs + duration * (index + 1) / chars.length;
    return {...caption, text, startMs, endMs, timestampMs: (startMs + endMs) / 2};
  });
});

const isEnglishNarrationSegment = (value: string) => /[A-Za-z]/.test(value) && !/\p{Script=Han}/u.test(value);

// 仅在供应商时间戳整体失真且段落边界无法修复时使用，保留 SSML 声明的段间停顿。
export const fallbackCaptionsForSegments = (segments: NarrationSegmentDraft[], durationMs: number, pausesMs: number[]): RawCaption[] => {
  // 英文回退字幕按单词给时间，中文仍按字给时间；不能把英文逐字交给字幕组件。
  const tokensBySegment = segments.map((segment) => {
    const tokens: string[] = [];
    let wordBoundary = false;
    for (const character of narrationAudioText(segment)) {
      if (/\s/.test(character)) { wordBoundary = true; continue; }
      // 英文空格是词界；中文混排继续保持原回退行为。
      if (tokens.length && (!wordBoundary || !isEnglishNarrationSegment(segment.spokenText)) && isAsciiWord(tokens.at(-1)!) && isAsciiWord(character)) tokens[tokens.length - 1] += character;
      else tokens.push(character);
      wordBoundary = false;
    }
    return tokens;
  });
  const characterCount = tokensBySegment.flat().reduce((total, token) => total + [...token].length, 0);
  if (!characterCount) return [];
  const pauseTotal = pausesMs.reduce((total, pause) => total + Math.max(0, pause), 0);
  const speechDurationMs = Math.max(characterCount * 0.001, durationMs - pauseTotal);
  let cursorMs = 0;
  return tokensBySegment.flatMap((tokens, segmentIndex) => {
    const segmentCharacters = tokens.reduce((total, token) => total + [...token].length, 0);
    const segmentDurationMs = speechDurationMs * segmentCharacters / characterCount;
    let consumedCharacters = 0;
    const captions = tokens.map((text) => {
      const length = [...text].length;
      const startMs = cursorMs + segmentDurationMs * consumedCharacters / segmentCharacters;
      consumedCharacters += length;
      const endMs = cursorMs + segmentDurationMs * consumedCharacters / segmentCharacters;
      return {text, startMs, endMs, timestampMs: (startMs + endMs) / 2, confidence: null};
    });
    cursorMs += segmentDurationMs + (pausesMs[segmentIndex] ?? 0);
    return captions;
  });
};

// 旧任务可能逐字落盘，也可能把句末和下一词粘成 `autonomy.A`；均以确认稿的词界修复。
export const repairFragmentedEnglishCaptions = (captions: RawCaption[], spokenText: string, durationMs: number): RawCaption[] => {
  // 中文或中英混排不得触发英文词界修复。
  if (!isEnglishNarrationSegment(spokenText)) return captions;
  let run = 0;
  const fragmented = captions.some((caption) => {
    run = /^[A-Za-z0-9]$/.test(caption.text.trim()) ? run + 1 : 0;
    return run >= 3;
  }) || captions.some((caption, index) => (caption.text === "'" || caption.text === "’") && isAsciiWord(captions[index - 1]?.text ?? "") && isAsciiWord(captions[index + 1]?.text ?? ""))
    // 仅确认稿确有空格时才修复粘词，保留 U.S. 等合法缩写。
    || captions.some((caption) => /[.!?][A-Z]/.test(caption.text.trim()) && !spokenText.includes(caption.text.trim()));
  if (!fragmented) return captions;
  return reconcileCaptionsWithText(captions, spokenText, durationMs);
};

// 供应商可能把阿拉伯数字读成中文数字；只用于对齐，不改写最终字幕文字。
const normalizeTimestampCharacter = (character: string) => {
  const chineseNumbers: Record<string, string> = {零: "0", 〇: "0", 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9"};
  const punctuation: Record<string, string> = {点: ".", "．": ".", "。": ".", "，": ",", "、": ",", "？": "?", "！": "!", "：": ":", "；": ";", "（": "(", "）": ")"};
  return chineseNumbers[character] ?? punctuation[character] ?? character.toLowerCase();
};

export type CaptionReconciliationOptions = {
  requireTimestampCoverage?: boolean;
  maxInterpolatedCharacters?: number;
};

// 归一化字符级 LCS 对齐：返回每个 expected 字符匹配到的 observed 下标（null 为未匹配）。
// 对局部缺失（该音色会吃掉句号、句尾截断几个字）与插入噪声天然鲁棒；贪心游标方案里
// 高频字（的/，/是）会把游标拉到错误位置引发连锁 miss，曾导致 575 字只匹配 38 个。
const alignExpectedToObserved = (
  expectedNorms: string[],
  observedNorms: string[],
): Array<number | null> => {
  const n = expectedNorms.length;
  const m = observedNorms.length;
  if (!n || !m) return new Array<number | null>(n).fill(null);
  // 完整 dp 表供回溯（全文约 600×600 ≈ 1.4MB Uint32，每次合成仅计算一次）。
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] = expectedNorms[i] === observedNorms[j]
        ? dp[(i + 1) * width + (j + 1)] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)]);
    }
  }
  const sourceIndices: Array<number | null> = new Array<number | null>(n).fill(null);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (expectedNorms[i] === observedNorms[j]) {
      sourceIndices[i] = j;
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * width + j] > dp[i * width + (j + 1)]) {
      i += 1;
    } else {
      // 平局时优先跳过 observed：与旧贪心一致地把 expected 的后续字符对齐到最近的同字实例。
      j += 1;
    }
  }
  return sourceIndices;
};

export const reconcileCaptionsWithTextDetailed = (
  captions: RawCaption[],
  spokenText: string,
  durationMs: number,
  options: CaptionReconciliationOptions = {},
) => {
  const expected: Array<{text: string; normalizedText: string; spaceBefore: boolean}> = [];
  let whitespaceBefore = false;
  for (const character of spokenText) {
    if (/\s/.test(character)) { whitespaceBefore = true; continue; }
    expected.push({text: character, normalizedText: normalizeTimestampCharacter(character), spaceBefore: whitespaceBefore});
    whitespaceBefore = false;
  }
  if (!expected.length) return {captions: [], matchedCharacters: 0, interpolatedCharacters: 0};
  const observed = captionCharacters(captions);
  const sourceIndices = alignExpectedToObserved(
    expected.map((item) => item.normalizedText),
    observed.map((item) => normalizeTimestampCharacter(item.text)),
  );
  const aligned: Array<RawCaption | null> = sourceIndices.map((sourceIndex, index) =>
    sourceIndex === null ? null : {...observed[sourceIndex]!, text: expected[index]!.text});
  let matchedCharacters = aligned.filter(Boolean).length;
  // 标点符号的时间戳对字幕质量没有意义（该音色会整类吃掉句号）；标点 miss 不计入插值率，
  // 避免真实字级时间戳被少量标点缺失拖进整段重建兜底。
  const isTimedCharacter = (character: string) => /\p{L}|\p{N}/u.test(character);
  let interpolatedCharacters = aligned.filter((caption, index) => !caption && isTimedCharacter(expected[index]!.text)).length;
  // CosyVoice may normalize pronunciations in its word text (for example
  // `5.3` becomes `五点三`) while still returning a complete timed stream.
  // Keep every matched provider boundary and interpolate only the unmatched
  // local span, so one missing character cannot shift the rest of the script.
  let timestampAlignmentFallback = false;
  if (options.requireTimestampCoverage && (interpolatedCharacters > (options.maxInterpolatedCharacters ?? Math.max(3, Math.ceil(expected.length * 0.03))) || !observed.length)) {
    timestampAlignmentFallback = true;
    if (!observed.length) {
      const step = Math.max(0.001, durationMs / expected.length);
      for (let i = 0; i < expected.length; i++) {
        const startMs = step * i;
        const endMs = Math.max(startMs + 0.001, step * (i + 1));
        aligned[i] = {text: expected[i].text, startMs, endMs, timestampMs: (startMs + endMs) / 2, confidence: null};
      }
      matchedCharacters = 0;
      interpolatedCharacters = expected.length;
    }
  }
  // Provider timestamps are authoritative for matched text; local gaps are
  // filled below between the nearest trusted boundaries.
  let index = 0;
  while (index < aligned.length) {
    if (aligned[index]) { index++; continue; }
    const start = index;
    while (index < aligned.length && !aligned[index]) index++;
    const left = start ? aligned[start - 1]!.endMs : 0;
    const right = index < aligned.length ? aligned[index]!.startMs : durationMs;
    const step = Math.max(0.001, (right - left) / (index - start));
    for (let offset = 0; offset < index - start; offset++) {
      const startMs = left + step * offset;
      const endMs = Math.min(durationMs, left + step * (offset + 1));
      aligned[start + offset] = {text: expected[start + offset].text, startMs, endMs: Math.max(startMs + 0.001, endMs), timestampMs: (startMs + endMs) / 2, confidence: null};
    }
  }
  const result: RawCaption[] = [];
  for (const [i, caption] of aligned.entries()) {
    if (!caption) continue;
    const previous = result.at(-1);
    if (previous && isAsciiWord(previous.text) && isAsciiWord(caption.text) && !expected[i].spaceBefore) {
      previous.text += caption.text;
      previous.endMs = caption.endMs;
      previous.timestampMs = (previous.startMs + previous.endMs) / 2;
    } else result.push({...caption});
  }
  return {captions: result, matchedCharacters, interpolatedCharacters, timestampAlignmentFallback};
};

export const reconcileCaptionsWithText = (
  captions: RawCaption[],
  spokenText: string,
  durationMs: number,
  options?: CaptionReconciliationOptions,
) => reconcileCaptionsWithTextDetailed(captions, spokenText, durationMs, options).captions;

// 供应商时间戳按 ttsText 生成；特殊发音文本与显示文本不一致时，将同一时间范围重新标记为 spokenText。
export const remapCaptionsToDisplayText = (captions: RawCaption[], segments: NarrationSegmentDraft[]) => {
  const timedCharacters = captionCharacters(captions);
  let sourceCursor = 0;
  const displayCaptions: RawCaption[] = [];
  for (const segment of segments) {
    const audioText = narrationAudioText(segment);
    const audioCharacters = [...audioText].filter((character) => !/\s/.test(character));
    const displayCharacters: Array<{text: string; normalizedText: string; spaceBefore: boolean}> = [];
    let whitespaceBefore = false;
    for (const character of segment.spokenText) {
      if (/\s/.test(character)) { whitespaceBefore = true; continue; }
      displayCharacters.push({text: character, normalizedText: normalizeTimestampCharacter(character), spaceBefore: whitespaceBefore});
      whitespaceBefore = false;
    }
    const source = timedCharacters.slice(sourceCursor, sourceCursor + audioCharacters.length);
    sourceCursor += audioCharacters.length;
    const sourceIndices = alignExpectedToObserved(
      displayCharacters.map((character) => character.normalizedText),
      audioCharacters.map((character) => normalizeTimestampCharacter(character)),
    );
    const aligned: Array<RawCaption | null> = sourceIndices.map((sourceIndex, index) => sourceIndex === null ? null : {...source[sourceIndex]!, text: displayCharacters[index]!.text});
    let index = 0;
    while (index < aligned.length) {
      if (aligned[index]) { index++; continue; }
      const start = index;
      while (index < aligned.length && !aligned[index]) index++;
      const left = start ? aligned[start - 1]!.endMs : source[0]?.startMs ?? 0;
      const right = index < aligned.length ? aligned[index]!.startMs : source.at(-1)?.endMs ?? left + 1;
      const step = Math.max(0.001, (right - left) / Math.max(1, index - start));
      for (let offset = 0; offset < index - start; offset++) {
        const startMs = left + step * offset;
        const endMs = Math.max(startMs + 0.001, Math.min(right, left + step * (offset + 1)));
        aligned[start + offset] = {text: displayCharacters[start + offset]!.text, startMs, endMs, timestampMs: (startMs + endMs) / 2, confidence: null};
      }
    }
    for (const [displayIndex, caption] of aligned.entries()) {
      if (!caption) continue;
      const previous = displayCaptions.at(-1);
      const character = displayCharacters[displayIndex]!;
      // 英文回贴在段首强制开启新词，禁止把下一段首词并入上一段的句末。
      if (previous && (displayIndex > 0 || !isEnglishNarrationSegment(segment.spokenText)) && isAsciiWord(previous.text) && isAsciiWord(caption.text) && !character.spaceBefore) {
        previous.text += caption.text;
        previous.endMs = caption.endMs;
        previous.timestampMs = Math.round((previous.startMs + previous.endMs) / 2);
      } else displayCaptions.push({...caption});
    }
  }
  return displayCaptions;
};

// 仅修复英文已确认稿的字幕归属：按全文字符顺序定位所属段，绝不借用相邻段文字。
// 时间落在段外的词裁回该段语音区间；正常词的供应商时间保持不变。
export const repairEnglishSegmentCaptions = (captions: RawCaption[], segments: Array<{id: string; spokenText: string}>, timings: Array<{id: string; speechStartMs: number; speechEndMs: number}>) => {
  if (!segments.length || !segments.every((segment) => isEnglishNarrationSegment(segment.spokenText))) return captions;
  const compact = (text: string) => text.replace(/\s/gu, "");
  if (compact(captions.map((caption) => caption.text).join("")) !== compact(segments.map((segment) => segment.spokenText).join(""))) return captions;
  const characters = captionCharacters(captions);
  let cursor = 0;
  const result: RawCaption[] = [];
  for (const segment of segments) {
    const timing = timings.find((item) => item.id === segment.id);
    if (!timing || timing.speechEndMs <= timing.speechStartMs) return captions;
    const length = nonWhitespaceLength(segment.spokenText);
    const group = characters.slice(cursor, cursor + length);
    cursor += length;
    const words = reconcileCaptionsWithText(group, segment.spokenText, timing.speechEndMs);
    // 已经正常分词且边界正确时直接复用，避免刷新累计舍入漂移。
    const bounded = words.map((word) => ({...word,
      startMs: Math.max(0, word.startMs - timing.speechStartMs),
      endMs: Math.min(timing.speechEndMs - timing.speechStartMs, word.endMs - timing.speechStartMs),
    }));
    result.push(...normalizeCaptionRanges(bounded, timing.speechEndMs - timing.speechStartMs).captions.map((word) => ({...word,
      startMs: word.startMs + timing.speechStartMs, endMs: word.endMs + timing.speechStartMs,
      timestampMs: (word.timestampMs ?? 0) + timing.speechStartMs,
    })));
  }
  return JSON.stringify(result) === JSON.stringify(captions) ? captions : result;
};

const nonWhitespaceLength = (value: string) => [...value].filter((character) => !/\s/.test(character)).length;

export type NarrationTiming = {
  id: string;
  startMs: number;
  endMs: number;
  speechStartMs: number;
  speechEndMs: number;
  pauseAfterMs: number;
  transition: {kind: "fade"; durationMs: number};
};

type WavPcmInfo = {channels: number; sampleRate: number; bits: number; bytesPerFrame: number; dataOffset: number; dataLength: number; durationMs: number};

const hasAudibleAudioBetween = (audio: Buffer, wav: WavPcmInfo, startMs: number, endMs: number) => {
  if (wav.bits !== 16 || endMs - startMs < 20) return false;
  const startFrame = Math.max(0, Math.floor(startMs / 1000 * wav.sampleRate));
  const endFrame = Math.min(Math.floor(wav.dataLength / wav.bytesPerFrame), Math.ceil(endMs / 1000 * wav.sampleRate));
  const windowFrames = Math.max(1, Math.floor(wav.sampleRate * 0.02));
  const threshold = 0.01;
  for (let frame = startFrame; frame < endFrame; frame += windowFrames) {
    const windowEnd = Math.min(endFrame, frame + windowFrames);
    let energy = 0;
    let count = 0;
    for (let current = frame; current < windowEnd; current += 1) {
      let frameEnergy = 0;
      for (let channel = 0; channel < wav.channels; channel += 1) {
        const offset = wav.dataOffset + current * wav.bytesPerFrame + channel * 2;
        frameEnergy += Math.abs(audio.readInt16LE(offset) / 32768);
      }
      energy += frameEnergy / wav.channels;
      count += 1;
    }
    if (count && energy / count >= threshold) return true;
  }
  return false;
};

type CaptionCalibrationResult = {captions: RawCaption[]; anomalyCount: number; anomalyReasons: string[]; calibratedCaptionCount: number};

// 供应商时间戳默认保留；只有有声的异常长空档才触发局部重分配。
export const calibrateCaptionAnomalies = (captions: RawCaption[], timings: NarrationTiming[], audio: Buffer, wav: WavPcmInfo): CaptionCalibrationResult => {
  const characters = captionCharacters(captions).map((caption) => ({...caption}));
  const reasons: string[] = [];
  let calibratedCaptionCount = 0;
  timings.forEach((timing) => {
    const indexes = characters.map((caption, index) => ({caption, index})).filter(({caption}) => caption.startMs >= timing.speechStartMs && caption.startMs < timing.speechEndMs).map(({index}) => index);
    for (let cursor = 0; cursor + 1 < indexes.length; cursor += 1) {
      const leftIndex = indexes[cursor]!;
      const rightIndex = indexes[cursor + 1]!;
      const left = characters[leftIndex]!;
      const right = characters[rightIndex]!;
      const gapMs = right.startMs - left.endMs;
      if (gapMs <= 1200 || !hasAudibleAudioBetween(audio, wav, left.endMs, right.startMs)) continue;
      const suffixIndexes = indexes.slice(cursor + 1);
      const suffix = suffixIndexes.map((index) => characters[index]!);
      const availableMs = Math.max(suffix.length, timing.speechEndMs - left.endMs);
      const totalWeight = suffix.reduce((sum, caption) => sum + Math.max(1, caption.endMs - caption.startMs), 0);
      let nextStartMs = left.endMs;
      suffix.forEach((caption, suffixIndex) => {
        const weight = Math.max(1, caption.endMs - caption.startMs);
        const nextEndMs = suffixIndex === suffix.length - 1 ? timing.speechEndMs : nextStartMs + (availableMs * weight) / totalWeight;
        caption.startMs = Math.round(nextStartMs);
        caption.endMs = Math.max(caption.startMs + 1, Math.round(nextEndMs));
        caption.timestampMs = Math.round((caption.startMs + caption.endMs) / 2);
        nextStartMs = caption.endMs;
        calibratedCaptionCount += 1;
      });
      reasons.push(`${timing.id}: ${Math.round(gapMs)}ms 有声异常空档`);
      break;
    }
  });
  return {captions: characters, anomalyCount: reasons.length, anomalyReasons: reasons, calibratedCaptionCount};
};

// narration.json 落盘前执行与视觉规划相同的节奏契约，防止坏时间轴延迟到下一阶段才暴露。
export const assertNarrationTimingConsistency = (timings: NarrationTiming[], durationMs: number) => {
  timings.forEach((timing, index) => {
    const nextSpeechStartMs = timings[index + 1]?.speechStartMs ?? durationMs;
    if (nextSpeechStartMs !== timing.speechEndMs + timing.pauseAfterMs) {
      throw new Error(`口播段落 ${timing.id} 的停顿与口播时间轴不一致`);
    }
  });
};

export const calibrateNarrationSegments = (
  captions: RawCaption[],
  segments: NarrationSegmentDraft[],
  durationMs: number,
  prefixMs = 0,
): NarrationTiming[] => {
  if (!segments.length) throw new Error("至少需要一个口播段落");
  const expectedLength = segments.reduce((total, segment) => total + nonWhitespaceLength(narrationAudioText(segment)), 0);
  const observed = captionCharacters(captions);
  const rawRanges: Array<{startMs: number; endMs: number}> = [];
  const providerStartMs = observed[0]?.startMs ?? 0;
  const providerEndMs = Math.max(providerStartMs + 1, observed.at(-1)?.endMs ?? durationMs);
  const providerDurationMs = providerEndMs - providerStartMs;
  const providerBoundaryAt = (position: number) => {
    if (!observed.length) return providerStartMs + providerDurationMs * position / Math.max(1, expectedLength);
    if (position >= observed.length) return providerEndMs;
    const index = Math.max(0, Math.floor(position));
    const fraction = position - index;
    const source = observed[index];
    return source.startMs + (source.endMs - source.startMs) * fraction;
  };
  let cursor = 0;
  // 每段记录首/末 token，用于段边界停顿回收（break 被吸收进边界 token 的场景）。
  const boundaryTokens: Array<{head?: RawCaption; tail?: RawCaption}> = [];
  for (const segment of segments) {
    const length = nonWhitespaceLength(narrationAudioText(segment));
    if (!length) throw new Error(`口播段落 ${segment.id} 不能为空`);
    if (observed.length === expectedLength) {
      const group = observed.slice(cursor, cursor + length);
      rawRanges.push({startMs: group[0].startMs, endMs: group.at(-1)!.endMs});
      boundaryTokens.push({head: group[0], tail: group.at(-1)});
    } else {
      const startPosition = observed.length ? cursor * observed.length / expectedLength : cursor;
      const endPosition = observed.length ? (cursor + length) * observed.length / expectedLength : cursor + length;
      rawRanges.push({startMs: providerBoundaryAt(startPosition), endMs: providerBoundaryAt(endPosition)});
      boundaryTokens.push({
        head: observed[Math.min(observed.length - 1, Math.floor(startPosition))],
        tail: observed[Math.min(observed.length - 1, Math.ceil(endPosition) - 1)],
      });
    }
    cursor += length;
  }
  const totalMs = prefixMs + durationMs;
  // CosyVoice 的词级时间戳会把段间 break 静音吸收进段末 token（如 '。' 时长被拉到 500ms+ 且与下段首字无缝），
  // 导致停顿在时间轴上丢失、场景转场窗口归零（成片中表现为边界骤暗+硬切闪动）。
  // 回收策略：边界两侧 token 无缝（gap ≤ 30ms）时，把末 token 超出单字正常朗读上限的溢出按停顿回收，
  // 下一段首 token 若同样被拉长则对称回退。上限与 SSML 停顿预设（≤700ms）对齐。
  const maxTailCharMs = 260;
  const maxHeadCharMs = 300;
  const tokenReclaim = (index: number) => {
    if (index + 1 >= boundaryTokens.length) return {tail: 0, nextHead: 0};
    const tail = boundaryTokens[index].tail;
    const head = boundaryTokens[index + 1].head;
    if (!tail || !head) return {tail: 0, nextHead: 0};
    if (head.startMs - tail.endMs > 30) return {tail: 0, nextHead: 0}; // 已有间隙，break 未被吸收
    // 仅回收"无发音时长"的标点末 token：朗读中的长单字（如拖长音）无法与吸收停顿区分，不回收。
    const isSilentPunctuation = !/[A-Za-z0-9一-鿿]/u.test(tail.text);
    if (!isSilentPunctuation) return {tail: 0, nextHead: 0};
    return {
      tail: Math.min(640, Math.max(0, tail.endMs - tail.startMs - maxTailCharMs)),
      nextHead: Math.min(640, Math.max(0, head.endMs - head.startMs - maxHeadCharMs)),
    };
  };
  // 先固化每段最终语音区间，再从相邻最终边界计算停顿；避免“本段预测的下一起点”与下一段实际起点使用不同回收量。
  const speechRanges: Array<{startMs: number; endMs: number}> = [];
  for (let index = 0; index < segments.length; index += 1) {
    const reclaimBefore = index > 0 ? tokenReclaim(index - 1).nextHead : 0;
    const reclaimAfter = tokenReclaim(index).tail;
    const rawStartMs = prefixMs + Math.round(rawRanges[index].startMs) - Math.round(reclaimBefore);
    const previousEndMs = index > 0 ? speechRanges[index - 1]!.endMs : prefixMs;
    const startMs = Math.max(prefixMs, previousEndMs, rawStartMs);
    const endMs = Math.max(startMs + 1, prefixMs + Math.round(rawRanges[index].endMs) - Math.round(reclaimAfter));
    speechRanges.push({startMs, endMs});
  }
  return segments.map((segment, index) => {
    const speechStartMs = speechRanges[index]!.startMs;
    const speechEndMs = speechRanges[index]!.endMs;
    const nextSpeechStartMs = speechRanges[index + 1]?.startMs ?? totalMs;
    const measuredPauseAfterMs = nextSpeechStartMs - speechEndMs;
    const actualPauseAfterMs = Math.max(0, measuredPauseAfterMs);
    const pauseAfterMs = Math.min(700, actualPauseAfterMs);
    if (actualPauseAfterMs > 700 && index + 1 < rawRanges.length) throw new Error(`口播段落 ${segment.id} 的实际停顿超出契约范围：${actualPauseAfterMs}ms`);
    return {
      id: segment.id,
      startMs: index === 0 ? 0 : 0,
      endMs: index + 1 === segments.length ? totalMs : speechEndMs + Math.round(pauseAfterMs / 2),
      speechStartMs,
      speechEndMs,
      pauseAfterMs,
      transition: {kind: "fade" as const, durationMs: transitionDurationMs(pauseAfterMs)},
    };
  }).map((timing, index, all) => ({...timing, startMs: index === 0 ? 0 : all[index - 1].endMs}));
};

/**
 * 停顿回收后，边界标点 token 的原始时间戳仍横跨回收出的停顿区间
 * （如 '。' 6400-6823 而段 speech 区间到 6660 截止），会被
 * "字幕不能落入停顿区间"校验拒绝。这里把跨界 token 裁剪回所属段的
 * speech 边界内：标点显示到本句读完为止，与本句末字同时消失。
 */
export const clampCaptionsToSpeech = (captions: RawCaption[], timings: NarrationTiming[]): RawCaption[] => {
  if (!timings.length) return captions;
  const clamped = captions.map((caption) => {
    // 找到 caption 起点所在的段（起点保证 token 主体属于该段）。
    const timing = timings.find((t) => caption.startMs >= t.startMs && caption.startMs < t.endMs)
      ?? timings.find((t) => caption.startMs < t.endMs);
    if (!timing) return caption;
    let startMs = caption.startMs;
    let endMs = caption.endMs;
    if (startMs < timing.speechStartMs) startMs = timing.speechStartMs;
    if (endMs > timing.speechEndMs) endMs = Math.max(startMs + 1, timing.speechEndMs);
    // 整条 token 落在停顿间隙（如时长补偿挤出的 1ms 残片）：归入下一段 speech 起点。
    if (endMs <= startMs || startMs >= timing.speechEndMs) {
      const next = timings[timings.indexOf(timing) + 1];
      startMs = next ? next.speechStartMs : timing.speechEndMs - 1;
      endMs = Math.max(startMs + 1, next ? next.speechStartMs + Math.max(1, caption.endMs - caption.startMs) : timing.speechEndMs);
    }
    if (startMs === caption.startMs && endMs === caption.endMs) return caption;
    return {...caption, startMs, endMs, timestampMs: Math.round((startMs + endMs) / 2)};
  });
  return clamped;
};

export const pauseAfterMs = (scene: SceneDraft, nextScene: SceneDraft | undefined, speechDurationMs: number) => {
  const preference = scene.pauseAfter ?? "auto";
  if (preference in pausePresets) return pausePresets[preference];
  if (preference !== "auto") throw new Error(`不支持的场景停顿：${preference}`);
  if (!nextScene) return 560;
  let pause = 520;
  if (speechDurationMs > 7000) pause += 60;
  return Math.min(700, Math.max(360, pause));
};

const transitionDurationMs = (pauseMs: number) => Math.min(360, Math.max(240, Math.round(pauseMs * 0.7)));

const wavInfo = (audio: Buffer) => {
  if (audio.length < 12 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") throw new Error("百炼返回的音频不是 WAV");
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataOffset = -1;
  let dataLength = 0;
  for (let offset = 12; offset + 8 <= audio.length;) {
    const chunkId = audio.toString("ascii", offset, offset + 4);
    const declaredLength = audio.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const availableLength = Math.max(0, audio.length - chunkStart);
    const chunkLength = Math.min(declaredLength, availableLength);
    if (chunkId === "fmt " && chunkLength >= 16) {
      const format = audio.readUInt16LE(chunkStart);
      channels = audio.readUInt16LE(chunkStart + 2);
      sampleRate = audio.readUInt32LE(chunkStart + 4);
      bits = audio.readUInt16LE(chunkStart + 14);
      if (format !== 1) throw new Error("仅支持未压缩 PCM WAV");
    } else if (chunkId === "data") {
      dataOffset = chunkStart;
      dataLength = chunkLength;
      break;
    }
    offset = chunkStart + declaredLength + (declaredLength % 2);
  }
  const bytesPerFrame = channels * bits / 8;
  if (!channels || !sampleRate || !bits || !Number.isInteger(bytesPerFrame) || bytesPerFrame <= 0) throw new Error("WAV 缺少有效的 PCM fmt 块");
  if (dataOffset < 0 || dataLength <= 0) throw new Error("WAV 缺少 data 块");
  return {channels, sampleRate, bits, bytesPerFrame, dataOffset, dataLength, durationMs: Math.round(dataLength / bytesPerFrame / sampleRate * 1000)};
};

const pcmToWav = (pcm: Buffer, sampleRate: number) => {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8); header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
};

export const parseWords = (value: unknown): RawCaption[] => {
  const output = (value as any)?.payload?.output ?? (value as any)?.output ?? value;
  const outputType = String((output as any)?.type ?? "").toLowerCase();
  // 流式中间事件会重复携带尚未稳定的 words；只有句末事件的时间戳可作为字幕事实。
  if (outputType && outputType !== "sentence-end" && outputType !== "sentence_end") return [];
  const sentences = Array.isArray((output as any)?.sentences)
    ? (output as any).sentences
    : (output as any)?.sentence ? [(output as any).sentence] : [];
  const list = Array.isArray(sentences) ? sentences : [sentences];
  return list.flatMap((sentence: any) => (sentence?.words ?? []).flatMap((word: any) => {
    const text = String(word.text ?? ""); const startMs = Number(word.begin_time ?? word.beginTime); const endMs = Number(word.end_time ?? word.endTime);
    return text && Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs ? [{text, startMs, endMs, timestampMs: Math.round((startMs + endMs) / 2), confidence: null}] : [];
  }));
};

const synthesize = async (ssml: string, settings: PipelineSettings["tts"], voice: string) => {
  // 百炼采用 duplex WebSocket：先启动任务，再发送完整 SSML，最后显式结束输入。
  const taskId = randomUUID();
  const audio: Buffer[] = []; const captions: RawCaption[] = [];
  let providerMessageCount = 0;
  let providerMessagesWithWords = 0;
  let providerWordCount = 0;
  await new Promise<void>((resolve, reject) => {
    let socket: WebSocket;
    let settled = false;
    let textSent = false;
    try {
      socket = new WebSocket(settings.websocketUrl, {headers: {Authorization: `bearer ${settings.apiKey}`, "X-DashScope-DataInspection": "enable"}});
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const timeout = setTimeout(() => fail(new Error("百炼 WebSocket TTS 超时")), 120_000);
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { socket.close(); } catch {}
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const complete = () => { if (settled) return; settled = true; if (timeout) clearTimeout(timeout); try { socket.close(); } catch {} resolve(); };
    socket.onerror = (event) => fail(new Error(`百炼 WebSocket 失败：${String((event as any).message ?? event)}`));
    socket.onclose = (event) => { if (!settled) fail(new Error(`百炼 WebSocket 意外关闭：${event.code}${event.reason ? ` ${event.reason}` : ""}`)); };
    socket.onopen = () => {
      // 同时开启 SSML 和字级时间戳，音频与字幕时间轴由同一次合成产生。
      const request = {
        header: {action: "run-task", task_id: taskId, streaming: "duplex"},
        payload: {
          task_group: "audio", task: "tts", function: "SpeechSynthesizer", model: settings.model,
          parameters: {text_type: "PlainText", voice, format: "wav", sample_rate: settings.sampleRate, volume: settings.volume, rate: settings.rate, pitch: settings.pitch, seed: settings.seed, instruction: settings.instruction, language_hints: settings.languageHints, enable_ssml: true, word_timestamp_enabled: true},
          input: {},
        },
      };
      socket.send(JSON.stringify(request));
    };
    socket.onmessage = async (event) => {
      try {
        if (typeof event.data === "string") {
          const parsed = JSON.parse(event.data);
          const words = parseWords(parsed);
          providerMessageCount += 1;
          providerWordCount += words.length;
          if (words.length) providerMessagesWithWords += 1;
          captions.push(...words);
          const status = (parsed as any)?.header?.event ?? (parsed as any)?.event;
          if (status === "task-failed" || (parsed as any)?.header?.status_code >= 400) throw new Error((parsed as any)?.header?.error_message ?? "百炼语音合成失败");
          if (status === "task-started" && !textSent) {
            textSent = true;
            // 只发送一次整段文本，避免按场景调用造成音色和时间轴断裂。
            socket.send(JSON.stringify({
              header: {action: "continue-task", task_id: taskId, streaming: "duplex"},
              payload: {input: {text: ssml}},
            }));
            socket.send(JSON.stringify({
              header: {action: "finish-task", task_id: taskId, streaming: "duplex"},
              payload: {input: {}},
            }));
          }
          if (status === "task-finished" || status === "task-completed") complete();
        // 二进制消息是音频数据，文本消息则包含任务状态和字级时间戳。
        } else if (Buffer.isBuffer(event.data)) audio.push(event.data);
        else if (event.data instanceof ArrayBuffer) audio.push(Buffer.from(event.data));
        else if (event.data instanceof Blob) audio.push(Buffer.from(await event.data.arrayBuffer()));
      } catch (error) { fail(error); }
    };
  });
  if (!audio.length) throw new Error("百炼整段 SSML 语音合成未返回音频数据");
  const normalizedCaptions = normalizeCaptionTokens(captions);
  return {audio: Buffer.concat(audio), captions: normalizedCaptions, diagnostics: {providerMessageCount, providerMessagesWithWords, providerWordCount}};
};

export const combineSceneAudio = async (segments: NarrationSegmentDraft[], settings: PipelineSettings["tts"], voice: string, outputDir: string) => {
  if (!segments.length) throw new Error("至少需要一个口播段落");
  await fs.mkdir(outputDir, {recursive: true});
  const pauses = segments.slice(0, -1).map((segment) => segmentPauseMs(segment, settings.pauseMs));
  // 段落停顿写入同一份 SSML，保证百炼生成的语音和口播段落边界一致。
  const ssml = buildNarrationSsml(segments, pauses); await fs.writeFile(path.join(outputDir, "narration.ssml"), `${ssml}\n`, "utf8");
  const result = await synthesize(ssml, settings, voice);
  const rawWav = result.audio.slice(0, 4).toString("ascii") === "RIFF" ? result.audio : pcmToWav(result.audio, settings.sampleRate);
  const wav = wavInfo(rawWav);
  const spokenText = segments.map((segment) => segment.spokenText.trim()).join("\n");
  const ttsText = segments.map((segment) => narrationAudioText(segment).trim()).join("\n");
  const diagnostics: TtsTimestampDiagnostics = {
    ...result.diagnostics,
    providerCaptionCount: result.captions.length,
    providerCharacterCount: captionCharacters(result.captions).length,
    providerObservedText: result.captions.map((caption) => caption.text).join("").slice(0, 600),
    expectedCharacterCount: nonWhitespaceLength(ttsText),
    wavDurationMs: wav.durationMs,
    lastCaptionEndMs: result.captions.at(-1)?.endMs,
  };
  try {
    const reconciled = reconcileCaptionsWithTextDetailed(result.captions, ttsText, wav.durationMs, {requireTimestampCoverage: true});
    const bounded = normalizeCaptionRanges(reconciled.captions, wav.durationMs);
    let captions = fitCaptions(bounded.captions, wav.durationMs);
    diagnostics.matchedCharacters = reconciled.matchedCharacters;
    diagnostics.interpolatedCharacters = reconciled.interpolatedCharacters;
    diagnostics.reconciledCaptionCount = reconciled.captions.length;
    diagnostics.reconciledCharacterCount = captionCharacters(reconciled.captions).length;
    diagnostics.fittedCaptionCount = captions.length;
    diagnostics.fittedCharacterCount = captionCharacters(captions).length;
    diagnostics.lastCaptionEndMs = captions.at(-1)?.endMs;
    diagnostics.boundaryRepairCount = bounded.repairedCount;
    diagnostics.timestampAlignmentFallback = reconciled.timestampAlignmentFallback;
    if (!captions.length) throw new Error("百炼未返回可用的整段字级时间戳");
    // SSML 声明不等于实测静音，不能仅按配置压缩英文词的实际朗读时长。
    // 先用未加前导静音的时间轴检查 provider 空档，避免异常时间戳进入最终 narration。
    try {
      const provisionalTimings = calibrateNarrationSegments(captions, segments, wav.durationMs, 0);
      const calibrated = calibrateCaptionAnomalies(captions, provisionalTimings, rawWav, wav);
      captions = fitCaptions(normalizeCaptionRanges(calibrated.captions, wav.durationMs).captions, wav.durationMs);
      diagnostics.timestampAnomalyCount = calibrated.anomalyCount;
      diagnostics.timestampAnomalyReasons = calibrated.anomalyReasons;
      diagnostics.calibratedCaptionCount = calibrated.calibratedCaptionCount;
    } catch (error) {
      // 初步校验不能确定段落边界时，继续交给后面的正式时间轴校验处理。
      diagnostics.timestampAnomalyReasons = [error instanceof Error ? `自动校准跳过：${error.message}` : "自动校准跳过：未知错误"];
    }
  // 补齐成片需要的前导和结尾静音，再把最终 WAV 写入任务目录。
  const prefixFrames = Math.round(wav.sampleRate * 180 / 1000); const finalPause = segmentPauseMs(segments.at(-1)!, settings.pauseMs); const tailFrames = Math.round(wav.sampleRate * finalPause / 1000);
  const frames = rawWav.subarray(wav.dataOffset, wav.dataOffset + wav.dataLength); const silence = (count: number) => Buffer.alloc(count * wav.bytesPerFrame); const outputFrames = Buffer.concat([silence(prefixFrames), frames, silence(tailFrames)]); const outputWav = pcmToWav(outputFrames, wav.sampleRate); await fs.writeFile(path.join(outputDir, "narration.wav"), outputWav);
  const totalMs = Math.round(outputFrames.length / wav.bytesPerFrame / wav.sampleRate * 1000);
  let timings: NarrationTiming[];
  try {
    timings = calibrateNarrationSegments(captions, segments, totalMs - 180, 180);
  } catch (error) {
    const isInvalidPause = error instanceof Error && error.message.includes("实际停顿超出契约范围");
    // 假停顿只可能来自失真的时间轴（SSML 声明的停顿 ≤700ms，真实音频不会更长）；
    // 无论字级匹配是否触发过兜底，一律按原 SSML 停顿重建可渲染时间轴，不让契约校验阻断音频交付。
    if (!isInvalidPause) throw error;
    captions = fitCaptions(fallbackCaptionsForSegments(segments, wav.durationMs, pauses), wav.durationMs);
    diagnostics.fittedCaptionCount = captions.length;
    diagnostics.fittedCharacterCount = captionCharacters(captions).length;
    diagnostics.segmentTimelineFallback = true;
    timings = calibrateNarrationSegments(captions, segments, totalMs - 180, 180);
  }
  assertNarrationTimingConsistency(timings, totalMs);
  diagnostics.calibrationSegmentCount = timings.length;
  // 字幕先进入含 180ms 前导静音的成片坐标系，再按同坐标系的 speech 区间裁剪。
  const displayCaptions = segments.some((segment) => narrationAudioText(segment) !== segment.spokenText)
    ? remapCaptionsToDisplayText(captions, segments)
    : captions;
  const mappedCaptions = clampCaptionsToSpeech(displayCaptions.map((caption) => ({...caption, startMs: Math.trunc(caption.startMs) + 180, endMs: Math.trunc(caption.endMs) + 180, timestampMs: caption.timestampMs == null ? null : Math.trunc(caption.timestampMs) + 180})), timings);
  // 记录实际合成参数，便于区分配置变化与历史音频；不保存密钥和服务地址。
  const synthesis = {rate: settings.rate, pitch: settings.pitch, volume: settings.volume, instruction: settings.instruction, seed: settings.seed, languageHints: settings.languageHints, sampleRate: settings.sampleRate, pausesMs: [...pauses, finalPause]};
  const finalCaptions = settings.languageHints.includes("en")
    ? repairEnglishSegmentCaptions(mappedCaptions, segments, timings) : mappedCaptions;
  const narration = {synthesis, schemaVersion: "1.0", text: spokenText, durationMs: totalMs, spokenDurationMs: timings.reduce((sum, timing) => sum + timing.speechEndMs - timing.speechStartMs, 0), model: settings.model, voice, captions: fitCaptions(finalCaptions, totalMs), segments: timings};
  await fs.writeFile(path.join(outputDir, "narration.json"), `${JSON.stringify(narration, null, 2)}\n`, "utf8");
  return {audioPath: path.join(outputDir, "narration.wav"), audioDurationMs: totalMs, spokenDurationMs: narration.spokenDurationMs, captions: narration.captions, timings};
  } catch (error) {
    const detail = {...diagnostics, error: error instanceof Error ? error.message : String(error)};
    console.error(`[tts-diagnostics] ${JSON.stringify(detail)}`);
    throw error;
  }
};

export const createNarrationManifest = (jobId: string, revision: number, draft: Record<string, any>, profile: PlatformProfile, result: Awaited<ReturnType<typeof combineSceneAudio>>, model: string, voice: string): RenderManifest => {
  const visualScenes = draft.scenes as SceneDraft[];
  if (!Array.isArray(visualScenes) || visualScenes.length !== result.timings.length) {
    throw new Error("视觉场景数量必须与口播段落数量一致；请先完成视觉规划");
  }
  const segments = narrationSegmentsForDraft(draft);
  const scenes = visualScenes.map((scene: SceneDraft, index: number) => ({...scene, spokenText: segments[index].spokenText, ...result.timings[index]}));
  return renderManifestSchema.parse({schemaVersion: "1.0", jobId, revision, contentProfile: {accountId: profile.accountId, seriesId: profile.seriesId, accountVersion: profile.accountVersion, seriesVersion: profile.seriesVersion, outputLanguage: profile.outputLanguage}, title: draft.title, ...(draft.shortTitle ? {shortTitle: draft.shortTitle} : {}), ...(draft.summary ? {summary: draft.summary} : {}), captionStyle: draft.captionStyle ?? "narration", video: {width: 1080, height: 1260, fps: 30, outroDurationMs: 3000}, narration: {text: segments.map((segment: NarrationSegmentDraft) => segment.spokenText.trim()).join("\n"), audioSrc: "artifact://audio/narration.wav", spokenDurationMs: result.spokenDurationMs, durationMs: result.audioDurationMs, model, voice}, captions: result.captions, scenes, brand: {logoSrc: profile.logoSrc, title: profile.title, subtitle: profile.subtitle, ...(profile.brandOutro ? {outro: profile.brandOutro} : {}), label: profile.displayLabel, downloadPrefix: profile.downloadPrefix}, presenter: profile.presenter});
};
