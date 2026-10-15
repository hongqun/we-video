import {createHash} from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MIN_TEXT_LENGTH = 20;
const CJK_RE = /[\u3400-\u9fff]/g;
const LATIN_WORD_RE = /[A-Za-z]+(?:[-'][A-Za-z]+)*/g;
const CODE_FENCE_RE = /```([A-Za-z0-9_+#./-]*)\s*\n([\s\S]*?)```/g;

const cleanText = (value: string) => value.replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`~]+/g, " ").replace(/\s+/g, " ").trim();
const normalizeCode = (value: string) => value.replace(/\r\n?/g, "\n").trim();

const assertPublicUrl = async (value: string) => {
  // 抓取前解析 DNS 并拦截内网地址，防止网页输入被利用为 SSRF 通道。
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("网页地址必须是有效的 HTTP 或 HTTPS URL"); }
  if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname) throw new Error("网页地址必须是有效的 HTTP 或 HTTPS URL");
  const addresses = net.isIP(parsed.hostname) ? [parsed.hostname] : await dns.lookup(parsed.hostname, {all: true}).then((items) => items.map((item) => item.address));
  for (const address of addresses) {
    const normalized = address.toLowerCase();
    if (net.isIPv4(address) && (normalized.startsWith("10.") || normalized.startsWith("127.") || normalized.startsWith("192.168.") || normalized.startsWith("169.254.") || normalized.startsWith("172.") && Number(address.split(".")[1]) >= 16 && Number(address.split(".")[1]) <= 31)) throw new Error("不允许抓取本机、内网或保留地址");
    if (net.isIPv6(address) && (normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:"))) throw new Error("不允许抓取本机、内网或保留地址");
  }
};

const extractCodeBlocks = (text: string) => {
  const blocks: Array<Record<string, unknown>> = [];
  for (const match of text.matchAll(CODE_FENCE_RE)) {
    const code = normalizeCode(match[2]);
    if (!code) continue;
    const start = match.index ?? 0;
    blocks.push({id: `code-${String(blocks.length + 1).padStart(2, "0")}`, language: match[1].trim().toLowerCase() || "text", code, startLine: text.slice(0, start).split("\n").length + 1, endLine: text.slice(0, start).split("\n").length + code.split("\n").length});
  }
  return blocks;
};

const cleanTextPreservingCode = (value: string) => {
  const matches = [...value.matchAll(CODE_FENCE_RE)];
  if (!matches.length) return cleanText(value);
  const parts: string[] = [];
  let cursor = 0;
  for (const match of matches) {
    const before = cleanText(value.slice(cursor, match.index));
    const code = normalizeCode(match[2]);
    if (before) parts.push(before);
    if (code) parts.push("```" + match[1].trim() + "\n" + code + "\n```");
    cursor = (match.index ?? 0) + match[0].length;
  }
  const after = cleanText(value.slice(cursor));
  if (after) parts.push(after);
  return parts.join("\n\n").trim();
};

const stripMarkdownToPlainText = (value: string) => value
  // 链接和图片只保留用户真正要读出的文字。
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  // 去除围栏、行首标题/引用/列表标记以及删除线。
  .replace(/^\s{0,3}#{1,6}\s+/gm, "")
  .replace(/^\s{0,3}>\s?/gm, "")
  .replace(/^\s{0,3}(?:[-+*]|\d+[.)])\s+/gm, "")
  .replace(/^\s{0,3}(?:\*\s*){3,}$/gm, "")
  .replace(/```[^\n]*\n?/g, "")
  .replace(/~~([^~]+)~~/g, "$1")
  // 加粗、斜体和行内代码只移除 Markdown 标记，不改动其中的文字。
  .replace(/\*\*([^*]+)\*\*/g, "$1")
  .replace(/__([^_]+)__/g, "$1")
  .replace(/`([^`]+)`/g, "$1")
  .replace(/(^|[\s([{])[*_](?=\S)/g, "$1")
  .replace(/(?<=\S)[*_](?=$|[\s\])}.,!?;:])/g, "")
  .replace(/\r\n?/g, "\n")
  .trim();

const extractScriptTitle = (value: string) => {
  // Markdown 一级标题只取第一个；其余 # 号仍按用户原稿保留在正文中。
  const match = value.match(/^(?:\uFEFF)?[ \t]*#[ \t]+(.+?)[ \t]*(?:\r?\n|$)/m);
  if (!match) return {title: "", text: value};
  const headingStart = match.index ?? 0;
  const textAfterHeading = `${value.slice(0, headingStart)}${value.slice(headingStart + match[0].length)}`;
  // 标题后的空行只是 Markdown 分隔符，不属于需要配音的正文。
  return {title: stripMarkdownToPlainText(match[1]!.trim()), text: textAfterHeading.replace(/^\r?\n/, "")};
};

const detectLanguage = (text: string) => {
  const cjk = (text.match(CJK_RE) ?? []).length;
  const latin = (text.match(LATIN_WORD_RE) ?? []).reduce((total, item) => total + item.length, 0);
  const meaningful = cjk + latin;
  if (!meaningful) return "mixed" as const;
  if (cjk >= 4 && latin >= 5 && Math.min(cjk, latin) / meaningful >= 0.2) return "mixed" as const;
  if (cjk / meaningful >= 0.35) return "zh" as const;
  if (cjk / meaningful <= 0.05 && latin >= 20) return "en" as const;
  return "mixed" as const;
};

const extractHtml = (html: string) => {
  // 页面正文去除脚本等非内容节点，同时单独保留代码块供后续提示词引用。
  const title = cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const body = html.replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
  const prose = cleanText(body);
  const code = [...html.matchAll(/<pre[^>]*>[\s\S]*?<code[^>]*>([\s\S]*?)<\/code>[\s\S]*?<\/pre>/gi)].map((match) => `\`\`\`text\n${normalizeCode(match[1].replace(/<[^>]+>/g, " "))}\n\`\`\``);
  return {title, text: [prose, ...code].filter(Boolean).join("\n\n")};
};

const fetchUrl = async (url: string, userAgent: string) => {
  await assertPublicUrl(url);
  const response = await fetch(url, {headers: {"User-Agent": `Mozilla/5.0 (compatible; Talk/1.0; +${userAgent})`, Accept: "text/html,application/xhtml+xml,text/plain"}, redirect: "manual"});
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new Error("网页重定向缺少目标地址");
    return fetchUrl(new URL(location, url).toString(), userAgent);
  }
  if (!response.ok) throw new Error(`网页抓取失败：HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0] ?? "";
  if (!["text/html", "application/xhtml+xml", "text/plain"].includes(contentType)) throw new Error(`暂不支持网页类型：${contentType}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_RESPONSE_BYTES) throw new Error("网页正文超过 2MB 限制");
  const raw = buffer.toString("utf8");
  if (contentType === "text/plain") return {title: "", text: cleanText(raw), url: response.url || url};
  const extracted = extractHtml(raw);
  return {...extracted, url: response.url || url};
};

export type NarrationSourceRequest = {type: "text" | "url" | "script"; text?: string; title?: string; url?: string; sourceLanguage?: "auto" | "zh" | "en" | "mixed"};

export const prepareNarrationSource = async (request: NarrationSourceRequest, userAgent: string) => {
  // 统一文本和网页输入的数据形状，后续模型只消费这份已清洗、已识别语言的来源。
  let originalText: string;
  let title = cleanText(request.title ?? "");
  let url: string | null = null;
  if (request.type === "text") originalText = cleanTextPreservingCode(request.text ?? "");
  // 口播稿是用户已确认的配音文字，必须保存正文原始字符，不能复用正文清洗逻辑。
  else if (request.type === "script") {
    const parsed = extractScriptTitle(request.text ?? "");
    title = parsed.title;
    originalText = stripMarkdownToPlainText(parsed.text);
  }
  else if (request.type === "url") { const fetched = await fetchUrl((request.url ?? "").trim(), userAgent); title = title || fetched.title; originalText = fetched.text; url = fetched.url; }
  else throw new Error("type 必须是 text、url 或 script");
  if (originalText.length < MIN_TEXT_LENGTH) throw new Error("正文过短，请至少提供 20 个字符");
  if (originalText.length > 200_000) throw new Error("正文超过 20 万字符限制");
  const detectedLanguage = detectLanguage(originalText);
  const effectiveLanguage = request.sourceLanguage && request.sourceLanguage !== "auto" ? request.sourceLanguage : detectedLanguage;
  return {type: request.type, url, title, originalText, codeBlocks: extractCodeBlocks(originalText), detectedLanguage, effectiveLanguage, sha256: createHash("sha256").update(originalText, "utf8").digest("hex")};
};
