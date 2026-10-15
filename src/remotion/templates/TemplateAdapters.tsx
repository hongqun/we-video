// 漫画内容纸面沿用原揭示与口播绑定，只替换视觉外观。
import {comicTextSize} from "../ComicChrome";
import {Interactive, interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import type {Caption, VideoScene} from "../schema";
import {VIDEO_COLORS, VIDEO_RADIUS, VIDEO_SHADOW, VIDEO_SURFACES} from "../theme";

const getListCueStarts = (scene: VideoScene, captions: Caption[], items: string[]): number[] => {
  const start = scene.speechStartMs ?? scene.startMs;
  const end = scene.speechEndMs ?? scene.endMs;
  const chars = captions.flatMap((caption) => [...caption.text].map((character) => ({character, startMs: caption.startMs})));
  const joined = chars.map((item) => item.character).join("");
  let from = 0;
  return items.map((item, index) => {
    const needle = [...item].filter((character) => !/[\s，。！？、；：,.!?;:]/.test(character)).join("");
    const position = needle ? joined.indexOf(needle, from) : -1;
    if (position >= 0) { from = position + needle.length; return chars[position]?.startMs ?? start; }
    return start + ((end - start) * index) / Math.max(1, items.length);
  });
};

// text-highlight 的唯一适配器；其它历史 RVE 族已从流水线移除。
export const TemplateHighlight: React.FC<{scene: VideoScene; captions: Caption[]; text: string; items: string[]}> = ({scene, captions, text, items}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const cueStarts = getListCueStarts(scene, captions, items);
  const now = scene.startMs + frame / fps * 1000;
  const active = cueStarts.reduce((current, start, index) => now >= start ? index : current, -1);
  const progress = interpolate(frame, [0, Math.max(1, Math.round(((scene.endMs - scene.startMs) / 1000) * fps))], [0, 100], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  return <Interactive.Div name="Text highlight" style={{background: VIDEO_COLORS.surface, border: `3px solid ${VIDEO_COLORS.ink}`, borderRadius: VIDEO_RADIUS.feature, boxShadow: VIDEO_SHADOW.feature, color: VIDEO_COLORS.ink, minHeight: 360, overflow: "hidden", padding: 42, position: "relative"}}>
    <div style={{backgroundColor: VIDEO_COLORS.accent, height: 10, left: 0, position: "absolute", top: 0, width: `${progress}%`}} />
    <div style={{fontSize: comicTextSize(text, 820, 220, text.length > 16 ? 48 : 64), fontWeight: 820, lineHeight: 1.2, marginBottom: 30, textAlign: "center"}}>{text}</div>
    <div style={{display: "grid", gap: 14}}>{items.map((item, index) => <Interactive.Div key={`${item}-${index}`} name={`Highlight item ${index + 1}`} style={{backgroundColor: index === active ? VIDEO_COLORS.accent : VIDEO_SURFACES.feature, border: `2px solid ${index === active ? VIDEO_COLORS.accent : VIDEO_COLORS.line}`, borderRadius: VIDEO_RADIUS.card, fontSize: comicTextSize(item, 780, Math.max(20, 400 / Math.max(1, items.length) - 30), 30), fontWeight: 730, opacity: interpolate(frame, [index * 5, index * 5 + 14], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"}), padding: "8px 20px", overflowWrap: "anywhere", textAlign: "center"}}>{item}</Interactive.Div>)}</div>
  </Interactive.Div>;
};
