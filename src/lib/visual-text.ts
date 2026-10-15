const LATIN_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._+/#:-]*$/;
const VISUAL_TOKEN_RE = /[A-Za-z0-9][A-Za-z0-9._+/#:-]*|\s+|./gu;

/** 英文技术词按完整 token 处理，避免收缩或动画换行产生 TypeScri 一类残词。 */
export const visualTextTokens = (value: string): string[] => value.match(VISUAL_TOKEN_RE) ?? [];

export const isLatinVisualToken = (value: string): boolean => LATIN_TOKEN.test(value);

/** 优先在标点结束短句，否则按完整 token 收缩；max 是软上限，单个技术词可完整保留。 */
export const compactVisualText = (value: string, max = 32): string => {
  const text = value.trim();
  if ([...text].length <= max) return text;
  const punctuation = [...text].slice(0, max + 1).join("").match(/^.*[。！？!?；;，,：:]/u)?.[0]?.replace(/[，,：:]$/u, "").trim();
  if (punctuation && [...punctuation].length >= Math.min(8, max)) return punctuation;
  let output = "";
  for (const token of visualTextTokens(text)) {
    const next = output + token;
    if ([...next].length > max && output.trim()) break;
    output = next;
  }
  return output.trim() || visualTextTokens(text)[0] || text;
};
