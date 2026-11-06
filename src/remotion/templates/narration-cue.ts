import type {Caption, VideoScene} from "../schema";

type Bounds = Pick<VideoScene, "startMs" | "endMs" | "speechStartMs" | "speechEndMs">;
export const normalizeNarrationCue = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");

// 字幕区间仅提供字符时间估算；归一化后的每个 UTF-16 单元都保留原字符的时间。
export const narrationCharacterMap = (scene: Bounds, captions: Caption[]) => {
  const start = Math.max(scene.startMs, scene.speechStartMs ?? scene.startMs);
  const end = Math.min(scene.endMs, scene.speechEndMs ?? scene.endMs);
  return captions.flatMap((caption) => {
    const chars = [...caption.text];
    // 组合字符按字素归一化，兼容 NFKC 合字展开与组合音标。
    let rawIndex = 0;
    return [...new Intl.Segmenter(undefined, {granularity: "grapheme"}).segment(caption.text)].flatMap(({segment: character}) => {
      const index = rawIndex; rawIndex += [...character].length;
      const startMs = caption.startMs + (caption.endMs - caption.startMs) * index / chars.length;
      const endMs = caption.startMs + (caption.endMs - caption.startMs) * rawIndex / chars.length;
      if (startMs < start || endMs > end) return [];
      return normalizeNarrationCue(character).split("").map((unit) => ({character: unit, startMs, endMs}));
    });
  });
};

export const resolveNarrationCue = ({scene, captions, text, occurrence = 1}: {scene: Bounds; captions: Caption[]; text?: string; occurrence?: number}) => {
  const needle = normalizeNarrationCue(text ?? "");
  if (!needle || !Number.isInteger(occurrence) || occurrence < 1) return null;
  const chars = narrationCharacterMap(scene, captions);
  const haystack = chars.map((char) => char.character).join("");
  let from = 0, index = -1;
  for (let count = 0; count < occurrence; count++) {
    index = haystack.indexOf(needle, from);
    if (index < 0) return null;
    from = index + needle.length;
  }
  return {startMs: chars[index]!.startMs, endMs: chars[index + needle.length - 1]!.endMs};
};
