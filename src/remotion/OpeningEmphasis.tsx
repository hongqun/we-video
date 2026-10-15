import {interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import type {Caption, VideoScene} from "./schema";
import {VIDEO_COLORS} from "./theme";

const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[\s，。！？、；：,.!?;:]/gu, "");
// 仅按配置的口播绑定查找真实字幕；未命中不猜时间，同段口播多次出现分别触发。
export const openingKeywordCues = (scene: VideoScene, captions: Caption[], keyword: string) => {
  const characters = captions.filter((item) => item.endMs > scene.startMs && item.startMs < scene.endMs).flatMap((item) => {
    const chars = Array.from(item.text);
    return chars.flatMap((char, index) => Array.from(normalize(char)).map((value) => ({value, startMs: item.startMs + (item.endMs - item.startMs) * index / chars.length, endMs: item.startMs + (item.endMs - item.startMs) * (index + 1) / chars.length})));
  });
  const needle = normalize(keyword);
  if (!needle) return [];
  const joined = characters.map((item) => item.value).join("");
  const cues: Array<{startMs: number; endMs: number}> = [];
  for (let from = 0; from < joined.length;) {
    const index = joined.indexOf(needle, from);
    if (index < 0) break;
    cues.push({startMs: characters[index]!.startMs, endMs: characters[index + needle.length - 1]!.endMs});
    from = index + needle.length;
  }
  return cues;
};

// 显示文字不能作为隐式口播绑定，缺少配置时不触发任何词级效果。
export const openingEmphasisCues = (scene: VideoScene, captions: Caption[], text: string) =>
  (scene.content.emphasisBindings ?? []).filter((binding) => binding.text.trim() && binding.cueText.trim() && normalize(binding.text) === normalize(text)).flatMap((binding) => openingKeywordCues(scene, captions, binding.cueText));

// 画面用 text 定位重点词，时间只用 cueText 匹配；关键词标签不参与特效。
export const OpeningEmphasis = ({text, scene, captions}: {text: string; scene: VideoScene; captions: Caption[]}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const nowMs = scene.startMs + frame / fps * 1000;
  const bindings = (scene.content.emphasisBindings ?? []).filter((binding) => binding.text.trim() && binding.cueText.trim());
  const words = [...new Set(bindings.map((binding) => binding.text.trim()))].sort((a, b) => b.length - a.length);
  if (!words.length) return <>{text}</>;
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "giu"));
  return <>{parts.map((part, index) => {
    const keyword = words.find((word) => normalize(word) === normalize(part));
    if (!keyword) return <span key={index}>{part}</span>;
    const cues = openingEmphasisCues(scene, captions, keyword);
    const emphasis = Math.max(0, ...cues.map((cue) => {
      const end = Math.min(scene.endMs, Math.max(cue.endMs + 240, cue.startMs + 720));
      const peak = cue.startMs + (end - cue.startMs) * .22;
      const hold = cue.startMs + (end - cue.startMs) * .65;
      return interpolate(nowMs, [cue.startMs, peak, hold, end], [0, 1, 1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
    }));
    return <span key={index} style={{display: "inline-block", position: "relative", zIndex: emphasis > 0 ? 1 : undefined, scale: String(1 + emphasis * .45), translate: `0 ${-5 * emphasis}px`, rotate: `${-2 * emphasis}deg`, transformOrigin: "center", backgroundColor: emphasis > 0 ? VIDEO_COLORS.highlight : "transparent", borderRadius: 4, boxShadow: emphasis > 0 ? `0 3px 0 ${VIDEO_COLORS.accent}` : "none", fontWeight: 850}}>{part}</span>;
  })}</>;
};
