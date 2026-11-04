const TOKEN_RE = /([A-Za-z][A-Za-z0-9._+#/-]*)/g;
const ENGLISH_TOKEN_RE = /^[A-Za-z][A-Za-z0-9._+#/-]*$/;
const VISUAL_TOKEN_RE = /[A-Za-z][A-Za-z0-9._+#/-]*|[\s\S]/gu;

const protectLineEnd = (value: string, lineIndex: number, renderText: (text: string) => React.ReactNode) => {
  const parts = value.split(TOKEN_RE);
  let lastContentIndex = -1;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index]?.trim().length) {
      lastContentIndex = index;
      break;
    }
  }
  return parts.map((part, index) => {
    if (ENGLISH_TOKEN_RE.test(part)) return <span key={`${part}-${lineIndex}-${index}`} style={{whiteSpace: "nowrap"}}>{renderText(part)}</span>;
    if (index !== lastContentIndex) return <span key={`${part}-${lineIndex}-${index}`}>{renderText(part)}</span>;
    const trailing = part.match(/\s*$/u)?.[0] ?? "";
    const core = trailing ? part.slice(0, -trailing.length) : part;
    const characters = Array.from(core);
    if (characters.length < 2) return <span key={`${part}-${lineIndex}-${index}`}>{renderText(part)}</span>;
    return <span key={`${part}-${lineIndex}-${index}`}>{renderText(characters.slice(0, -2).join(""))}<span style={{whiteSpace: "nowrap"}}>{renderText(characters.slice(-2).join(""))}</span>{renderText(trailing)}</span>;
  });
};

/** Split near the visual midpoint without cutting a Latin product name or acronym. */
export const splitProtectedText = (value: string): [string, string] => {
  const tokens = value.match(VISUAL_TOKEN_RE) ?? [];
  if (tokens.length <= 1) return [value, ""];
  const target = Array.from(value).length / 2;
  let length = 0;
  let bestIndex = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < tokens.length; index += 1) {
    length += Array.from(tokens[index - 1]).length;
    const rightStartsWithPunctuation = /^[，。！？、；：,.!?;:]/.test(tokens[index]);
    const distance = Math.abs(length - target) + (rightStartsWithPunctuation ? 100 : 0);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return [
    tokens.slice(0, bestIndex).join("").trimEnd(),
    tokens.slice(bestIndex).join("").trimStart(),
  ];
};

/** 英文术语保持完整；显式换行真实生效，并把每行末尾两字绑定以避免单字孤行。 */
export const ProtectedText: React.FC<{children: string; visibleCharacters?: number}> = ({children, visibleCharacters}) => {
  const lines = children.replaceAll("\\n", "\n").split("\n");
  // 隐藏未到时机的字符但保留占位，逐字显示时仍保持英文词组和换行位置稳定。
  let characterIndex = 0;
  const renderText = (text: string) => visibleCharacters === undefined ? text : Array.from(text).map((character) => {
    const index = characterIndex++;
    return <span key={index} style={{visibility: index < visibleCharacters ? "visible" : "hidden"}}>{character}</span>;
  });
  return <>{lines.map((line, index) => {
    const content = protectLineEnd(line, index, renderText);
    // 显式换行也计入全文字符索引，避免后续行提前显示。
    if (index < lines.length - 1) characterIndex++;
    return <span key={`${line}-${index}`}>{content}{index < lines.length - 1 ? <br /> : null}</span>;
  })}</>;
};
