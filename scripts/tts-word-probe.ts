/* eslint-disable @typescript-eslint/no-explicit-any, no-empty */
// TTS 字级时间戳探针：用最小文本对比不同音色/语速下百炼流式返回的 word 事件形态，
// 用于诊断“确认稿与 provider 字幕文本对不上”的匹配崩坏问题。仅诊断用，不进管道。
import {randomUUID} from "node:crypto";
import WebSocket from "ws";
import {readPipelineSettings} from "../src/lib/pipeline-settings";
import {normalizeCaptionTokens, reconcileCaptionsWithTextDetailed} from "../src/lib/tts";

// 取自失败 job 的前两段口播，覆盖中英混排与段间停顿边界。
const SEGMENT_A = "写代码也能做视频，还能批量生成。";
const SEGMENT_B = "Remotion是一个基于React的编程式视频制作框架，用熟悉的React和TypeScript语法，通过编写代码创建、编辑和渲染视频。";
const PAUSE_MS = 520;

// PROBE_FULL 模式：直接加载失败 job 的完整口播稿复现生产问题。
import {readFileSync} from "node:fs";
const fullDraftPath = process.env.PROBE_FULL;
const fullDraft = fullDraftPath ? JSON.parse(readFileSync(fullDraftPath, "utf8")) as {narrationSegments: Array<{id: string; spokenText: string; pauseAfter?: string}>} : null;
const fullSegments = fullDraft?.narrationSegments ?? [];
const PAUSE_PRESETS: Record<string, number> = {none: 0, short: 360, medium: 520, long: 700};
const escapeXml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const ssml = fullSegments.length
  ? `<speak>${fullSegments.map((segment, index) => {
      const pause = segment.pauseAfter === "none" ? 0 : PAUSE_PRESETS[segment.pauseAfter ?? "medium"] ?? 520;
      return `${escapeXml(segment.spokenText)}${index < fullSegments.length - 1 && pause > 0 ? `<break time="${pause}ms"/>` : ""}`;
    }).join("")}</speak>`
  : `<speak>${escapeXml(SEGMENT_A)}<break time="${PAUSE_MS}ms"/>${escapeXml(SEGMENT_B)}</speak>`;
const expectedFullText = (fullSegments.length ? fullSegments.map((segment) => segment.spokenText) : [SEGMENT_A, SEGMENT_B]).join("\n");

type ProbeWord = {text: string; startMs: number; endMs: number; messageIndex: number; outputType: string};

const probeOnce = async (websocketUrl: string, apiKey: string, model: string, sampleRate: number, voice: string, rate: number) => {
  const taskId = randomUUID();
  const words: ProbeWord[] = [];
  const messageTypes = new Map<string, {count: number; wordCount: number; sampleText: string}>();
  let messageCount = 0;
  await new Promise<void>((resolve, reject) => {
    let socket: WebSocket;
    let settled = false;
    let textSent = false;
    const timeout = setTimeout(() => finish(new Error("探针 WebSocket 超时")), 180_000);
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { socket.close(); } catch {}
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else resolve();
    };
    try {
      socket = new WebSocket(websocketUrl, {headers: {Authorization: `bearer ${apiKey}`, "X-DashScope-DataInspection": "enable"}});
    } catch (error) {
      clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    socket.onerror = (event) => finish(new Error(`WebSocket 失败：${String((event as {message?: string}).message ?? event)}`));
    socket.onclose = () => { if (!settled) finish(new Error("WebSocket 意外关闭")); };
    socket.onopen = () => {
      socket.send(JSON.stringify({
        header: {action: "run-task", task_id: taskId, streaming: "duplex"},
        payload: {
          task_group: "audio", task: "tts", function: "SpeechSynthesizer", model,
          parameters: {text_type: "PlainText", voice, format: "wav", sample_rate: sampleRate, rate, word_timestamp_enabled: true, enable_ssml: true},
          input: {},
        },
      }));
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      messageCount += 1;
      const parsed = JSON.parse(event.data) as Record<string, any>;
      const status = parsed?.header?.event ?? parsed?.event;
      if (status === "task-failed" || parsed?.header?.status_code >= 400) {
        finish(new Error(String(parsed?.header?.error_message ?? "task-failed")));
        return;
      }
      const output = parsed?.payload?.output ?? parsed?.output ?? {};
      const outputType = String(output?.type ?? "").toLowerCase();
      const sentences = Array.isArray(output?.sentences) ? output.sentences : output?.sentence ? [output.sentence] : [];
      const sentenceWords = sentences.flatMap((sentence: any) => Array.isArray(sentence?.words) ? sentence.words : []);
      if (sentenceWords.length) {
        for (const word of sentenceWords) {
          const text = String(word?.text ?? "");
          const startMs = Number(word?.begin_time ?? word?.beginTime);
          const endMs = Number(word?.end_time ?? word?.endTime);
          if (text && Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
            words.push({text, startMs, endMs, messageIndex: messageCount, outputType});
          }
        }
      }
      const bucketKey = `${status}|${outputType || "(无type)"}`;
      const bucket = messageTypes.get(bucketKey) ?? {count: 0, wordCount: 0, sampleText: ""};
      bucket.count += 1;
      bucket.wordCount += sentenceWords.length;
      if (!bucket.sampleText && sentenceWords.length) bucket.sampleText = sentenceWords.map((word: any) => String(word?.text ?? "")).join("");
      messageTypes.set(bucketKey, bucket);
      if (status === "task-started" && !textSent) {
        textSent = true;
        socket.send(JSON.stringify({header: {action: "continue-task", task_id: taskId, streaming: "duplex"}, payload: {input: {text: ssml}}}));
        socket.send(JSON.stringify({header: {action: "finish-task", task_id: taskId, streaming: "duplex"}, payload: {input: {}}}));
      }
      if (status === "task-finished" || status === "task-completed") finish();
    };
  });
  return {words, messageTypes, messageCount};
};

const main = async () => {
  const settings = await readPipelineSettings();
  const apiKey = settings.tts.apiKey;
  if (!apiKey) throw new Error("缺少 DASHSCOPE_API_KEY");
  const combos = fullSegments.length
    ? [{voice: "longanhuan_v3", rate: 0.96, label: "longanhuan_v3 + rate 0.96（失败场景）"}]
    : [
        {voice: "longanhuan_v3", rate: 0.96, label: "longanhuan_v3 + rate 0.96（失败场景）"},
        {voice: "longanhuan_v3", rate: 1.0, label: "longanhuan_v3 + rate 1.0（对照：去掉语速变量）"},
      ];
  console.log(`探针文本 A: ${SEGMENT_A}`);
  console.log(`探针文本 B: ${SEGMENT_B}\n`);
  for (const combo of combos) {
    console.log(`=== ${combo.label} ===`);
    const result = await probeOnce(settings.tts.websocketUrl, apiKey, settings.tts.model, settings.tts.sampleRate, combo.voice, combo.rate);
    console.log(`消息总数: ${result.messageCount}`);
    for (const [key, bucket] of result.messageTypes) {
      console.log(`  ${key}: 消息 ${bucket.count} 条, word ${bucket.wordCount} 个${bucket.sampleText ? `, 样例: ${bucket.sampleText.slice(0, 60)}` : ""}`);
    }
    const sentenceEndWords = result.words.filter((word) => word.outputType === "sentence-end" || word.outputType === "sentence_end");
    console.log(`全部 word: ${result.words.length} 个；其中 sentence-end 携带: ${sentenceEndWords.length} 个`);
    // 打印 sentence-end 的完整 word 明细，对照确认稿定位文本差异。
    const detailLines = sentenceEndWords.map((word) => `${word.text}@${Math.round(word.startMs)}-${Math.round(word.endMs)}`);
    for (let i = 0; i < detailLines.length; i += 8) console.log(`  sentence-end words[${i}..${Math.min(i + 8, detailLines.length)}]: ${detailLines.slice(i, i + 8).join("  ")}`);
    // 用生产匹配逻辑（parseWords 过滤 → normalizeCaptionTokens → 贪心前向对齐）复现匹配结果。
    const captions = normalizeCaptionTokens(sentenceEndWords.map(({text, startMs, endMs}) => ({text, startMs, endMs, timestampMs: (startMs + endMs) / 2, confidence: null})));
    const observedText = captions.map((caption) => caption.text).join("");
    console.log(`normalize 后 caption: ${captions.length} 条, ${[...observedText].length} 字: ${observedText}`);
    const productionDetail = reconcileCaptionsWithTextDetailed(captions, expectedFullText, 60000, {requireTimestampCoverage: true});
    console.log(`生产匹配器: 匹配 ${productionDetail.matchedCharacters}, 插值 ${productionDetail.interpolatedCharacters}, 兜底标记 ${productionDetail.timestampAlignmentFallback}`);
    console.log("");
  }
};

main().catch((error) => { console.error(error); process.exitCode = 1; });
