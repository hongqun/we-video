export type EditableNarrationSegment = {
  id: string;
  spokenText: string;
  ttsText?: string;
  pauseAfter: "none" | "short" | "medium" | "long";
};

const segmentLength = (text: string) => Array.from(text).length;
const normalizeSegmentText = (text: string) => text.trim();
const needsBoundarySpace = (left: string, right: string) => /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);

const assertSegmentLength = (text: string, label: string) => {
  const length = segmentLength(text);
  if (length < 4 || length > 150) throw new Error(`${label}必须为 4–150 字，当前为 ${length} 字`);
};

// 第二步只调整已确认口播的段落边界；ID 在保存时统一重新编号。
export const splitNarrationSegment = (segments: readonly EditableNarrationSegment[], index: number, cursor: number, selectionStart?: number) => {
  const current = segments[index];
  if (!current) throw new Error("未找到要拆分的口播段落");
  if (current.ttsText?.trim()) throw new Error("该段设置了特殊发音文本，请先清空后再拆分");
  const boundary = selectionStart ?? cursor;
  if (!Number.isInteger(boundary) || boundary <= 0 || boundary >= current.spokenText.length) throw new Error("拆分位置必须位于段落文字中间");
  const leftText = normalizeSegmentText(current.spokenText.slice(0, boundary));
  const rightText = normalizeSegmentText(current.spokenText.slice(boundary));
  assertSegmentLength(leftText, "拆分后的前一段");
  assertSegmentLength(rightText, "拆分后的后一段");
  return [
    ...segments.slice(0, index),
    {...current, spokenText: leftText, pauseAfter: "medium" as const},
    {...current, spokenText: rightText},
    ...segments.slice(index + 1),
  ];
};

export const mergeNarrationSegmentWithPrevious = (segments: readonly EditableNarrationSegment[], index: number) => {
  const previous = segments[index - 1];
  const current = segments[index];
  if (!previous || !current) throw new Error("第一段不能与上一段合并");
  if (previous.ttsText?.trim() || current.ttsText?.trim()) throw new Error("包含特殊发音文本的段落不能合并，请先清空后再合并");
  const separator = needsBoundarySpace(previous.spokenText.trimEnd(), current.spokenText.trimStart()) ? " " : "";
  const spokenText = normalizeSegmentText(`${previous.spokenText}${separator}${current.spokenText}`);
  // 合并后的总字数不再限制，由后续文稿流程统一处理内容长度。
  return [...segments.slice(0, index - 1), {...previous, spokenText, pauseAfter: current.pauseAfter}, ...segments.slice(index + 1)];
};

// 至少保留一个口播段落，避免删除后无法合成音频或建立视觉时间轴；ID 由保存层统一重排。
export const deleteNarrationSegment = (segments: readonly EditableNarrationSegment[], index: number) => {
  if (!segments[index]) throw new Error("未找到要删除的口播段落");
  if (segments.length <= 1) throw new Error("至少需要保留一个口播段落");
  return [...segments.slice(0, index), ...segments.slice(index + 1)];
};
