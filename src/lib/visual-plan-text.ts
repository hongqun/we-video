import type {VisualPlan} from "./visual-plan";
import type {Caption} from "@/remotion/schema";

type SpokenSegment = {id: string; spokenText: string};

export const comparableVisualText = (value: string) => value.normalize("NFKC").replace(/[\s，。！？；：、,.!?;:'"“”‘’（）()《》【\][]—…-]/g, "").toLowerCase();

/** 将模型常见的转义换行统一为真实换行，保证编辑器和渲染端显示一致。 */
export const normalizeMultilineVisualText = (value: unknown) => {
  const text = typeof value === "string" ? value : "";
  return text.replaceAll(String.fromCharCode(92, 114, 92, 110), "\n").replaceAll(String.fromCharCode(92, 110), "\n").replace(/<br[^>]*>/gi, "\n").replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
};
export const normalizeSingleLineVisualText = (value: string) => normalizeMultilineVisualText(value).replace(/\s*\n\s*/g, " ");

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const normalizeCaptionChunkSpacing = (value: string) => value.replace(/([.!?,;:])(?=[A-Za-z])/g, "$1 ");
const needsCaptionWordSpace = (previous: string, current: string) => /[A-Za-z][A-Za-z0-9.!?,;:]*$/u.test(previous) && /^[A-Za-z0-9]/u.test(current);
const captionTextBoundary = (caption: Caption, timeMs: number) => {
  const characters = Array.from(caption.text);
  if (!characters.length || timeMs <= caption.startMs) return 0;
  if (timeMs >= caption.endMs) return characters.length;
  return clamp(Math.round((timeMs - caption.startMs) / Math.max(1, caption.endMs - caption.startMs) * characters.length), 0, characters.length);
};

// 视觉镜头可以只覆盖一条字幕的一部分；按同一比例裁剪文字，避免拆分后重复显示整段口播。
// caption 文本通常不含空格，因此仅在相邻片段都是英文 token 时补一个显示空格，中文仍连续显示。
export const spokenTextForTimeRange = (captions: readonly Caption[], startMs: number, endMs: number) => {
  const chunks = captions.flatMap((caption) => {
    if (caption.endMs <= startMs || caption.startMs >= endMs) return [];
    const characters = Array.from(caption.text);
    const from = captionTextBoundary(caption, Math.max(startMs, caption.startMs));
    const to = captionTextBoundary(caption, Math.min(endMs, caption.endMs));
    return to > from ? normalizeCaptionChunkSpacing(characters.slice(from, to).join("")) : [];
  });
  return chunks.reduce((text, chunk) => {
    const separator = text && needsCaptionWordSpace(text.split(/\s+/u).at(-1) ?? "", chunk) ? " " : "";
    return `${text}${separator}${chunk}`;
  }, "");
};

// 编辑器光标对应字幕内部的字符位置，字幕是整词时间戳时也能得到稳定的拆分时间。
export const timeForSpokenTextOffset = (captions: readonly Caption[], startMs: number, endMs: number, offset: number) => {
  let consumed = 0;
  for (const caption of captions) {
    if (caption.endMs <= startMs || caption.startMs >= endMs) continue;
    const from = captionTextBoundary(caption, Math.max(startMs, caption.startMs));
    const to = captionTextBoundary(caption, Math.min(endMs, caption.endMs));
    const visibleLength = to - from;
    if (offset <= consumed + visibleLength) {
      const characterOffset = clamp(from + offset - consumed, from, to);
      return Math.round(caption.startMs + (caption.endMs - caption.startMs) * characterOffset / Math.max(1, Array.from(caption.text).length));
    }
    consumed += visibleLength;
  }
  return null;
};

// 只归一通用 content；不再解析或迁移任何模板专用数据。
export const normalizeVisualPlanVisibleText = (plan: VisualPlan, narrationSegments: SpokenSegment[]): VisualPlan => {
  const spokenById = new Map(narrationSegments.map((segment) => [segment.id, comparableVisualText(segment.spokenText)]));
  return {...plan, scenes: plan.scenes.map((scene) => {
    const spoken = spokenById.get(scene.segmentId) ?? "";
    // 主标题需要保留编辑器中的显式换行，交给 ProtectedText 在画面中渲染。
    const title = normalizeMultilineVisualText(scene.content.title);
    const subtitle = normalizeMultilineVisualText(scene.content.subtitle);
    const text = normalizeMultilineVisualText(scene.content.text);
    return {...scene, content: {
      title,
      subtitle: comparableVisualText(subtitle) === spoken ? "" : subtitle,
      text: [spoken, comparableVisualText(subtitle), comparableVisualText(title)].includes(comparableVisualText(text)) ? "" : text,
      keywords: scene.content.keywords.map(normalizeSingleLineVisualText).filter(Boolean),
      // 重点词绑定随画面内容保存，不从关键词或口播自动推断。
      ...(scene.content.emphasisBindings ? {emphasisBindings: scene.content.emphasisBindings.map((binding) => ({text: binding.text.trim(), cueText: binding.cueText.trim()}))} : {}),
    }};
  })};
};
