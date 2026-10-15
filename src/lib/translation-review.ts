import {z} from "zod";

// 全文审核单独存储，不用伪造一个 narrationSegment 来承载尚未确认的译稿。
export const translationTextSchema = z.object({
  title: z.string(),
  shortTitle: z.string(),
  summary: z.string(),
  text: z.string(),
});
export type TranslationText = z.infer<typeof translationTextSchema>;
export type TranslationReview = {
  schemaVersion: "1.0";
  source: TranslationText;
  translated: TranslationText;
  updatedAt: string;
  confirmedAt?: string;
  // 画面失败时保留已完成的分段，页面提供对应阶段的重试入口。
  failedStage?: "segmentation" | "visual";
};

export const assertTranslationText = (text: TranslationText) => {
  if (!text.title.trim()) throw new Error("请填写英文标题");
  if (!text.text.trim()) throw new Error("请填写英文口播全文");
};

// 模型只选择非空白词元之间的位置；实际正文由程序切片，保留空格、换行和标点。
export const translationTokens = (text: string) => Array.from(text.matchAll(/\S+/gu), (match) => ({text: match[0], start: match.index}));
export const splitApprovedTranslation = (text: string, starts: number[], count: number): string[] => {
  const tokens = translationTokens(text);
  if (!text.trim() || count < 1 || starts.length !== count - 1 || starts.some((start, index) => !Number.isInteger(start) || start <= (starts[index - 1] ?? 0) || start >= tokens.length)) {
    throw new Error("英文全文无法对应原镜头，请调整译稿后重新分段");
  }
  const offsets = [0, ...starts.map((start) => tokens[start]!.start), text.length];
  const segments = offsets.slice(0, -1).map((start, index) => text.slice(start, offsets[index + 1]));
  if (segments.some((segment) => !segment.trim()) || segments.join("") !== text) throw new Error("分段必须完整保留确认稿，且不能生成空段");
  return segments;
};
