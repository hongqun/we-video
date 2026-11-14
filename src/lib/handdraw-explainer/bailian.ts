import {z} from "zod";
import sharp from "sharp";
import {setTimeout as pause} from "node:timers/promises";
import {explainerBoxSchema} from "../../remotion/templates/handdraw-explainer-schema";

export class ExplainerMediaError extends Error {}
// 仅记录字段路径、类别和四个有限数值，供应商正文、密钥与签名链接不落盘。
export class ExplainerReviewError extends ExplainerMediaError {
  constructor(readonly diagnostic: {kind: "json" | "schema"; issues: Array<{path: string; code: string; values?: number[]}>}) {
    super(`视觉模型复核报告${diagnostic.kind === "json" ? "不是有效 JSON" : `字段无效：${diagnostic.issues.map((item) => `${item.path} (${item.code}${item.values ? `，坐标=${JSON.stringify(item.values)}` : ""})`).join("；")}`}，已停止本轮制作，素材已保留`);
  }
}
const reviewSchema = z.object({pass: z.boolean(), evidence: z.string().min(1).max(3000), issues: z.array(z.string().max(500)).max(12), parts: z.array(z.object({id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/), name: z.string().min(1).max(60), box: explainerBoxSchema}).strict()).min(1).max(12)}).strict();
// 百炼定位使用显式 0–1000 角点坐标；内部统一转换成归一化的左、上、宽、高，不猜测格式。
const cornerBox = z.tuple([z.number().min(0).max(1000), z.number().min(0).max(1000), z.number().min(0).max(1000), z.number().min(0).max(1000)]).refine(([x1, y1, x2, y2]) => x2 > x1 && y2 > y1, "右下角必须位于左上角之后");
const wireReviewSchema = z.object({coordinateSystem: z.literal("xyxy-1000"), pass: z.boolean(), evidence: z.string().min(1).max(3000), issues: z.array(z.string().max(500)).max(12), parts: z.array(z.object({id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/), name: z.string().min(1).max(60), bbox: cornerBox}).strict()).min(1).max(12)}).strict();
export const parseExplainerReview = (text: string) => {
  let value: unknown;
  try {value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, ""));} catch {throw new ExplainerReviewError({kind: "json", issues: []});}
  // 必须声明坐标类型，不能因越界就猜测宽高、角点或比例尺。
  const parsed = wireReviewSchema.safeParse(value);
  if (!parsed.success) {
    const parts = value && typeof value === "object" && "parts" in value && Array.isArray(value.parts) ? value.parts : [];
    throw new ExplainerReviewError({kind: "schema", issues: parsed.error.issues.slice(0, 12).map((issue) => {
      const part = typeof issue.path[1] === "number" ? parts[issue.path[1]] : undefined;
      const box = part && typeof part === "object" ? (part.bbox ?? part.box) : undefined;
      return {path: issue.path.map((key) => typeof key === "number" ? key : String(key).replace(/[^a-zA-Z0-9_-]/gu, "").slice(0, 48)).join("."), code: issue.code, values: Array.isArray(box) && box.length === 4 && box.every((n) => typeof n === "number" && Number.isFinite(n)) ? box : undefined};
    })});
  }
  const review = parsed.data;
  return reviewSchema.parse({pass: review.pass, evidence: review.evidence, issues: review.issues, parts: review.parts.map(({bbox: [x1, y1, x2, y2], ...part}) => ({...part, box: [x1 / 1000, y1 / 1000, (x2 - x1) / 1000, (y2 - y1) / 1000]}))});
};
const REVIEW_FORMAT = '只返回 JSON：{"coordinateSystem":"xyxy-1000","pass":true,"evidence":"具体看图结论","issues":[],"parts":[{"id":"main-object","name":"主体","bbox":[100,200,800,900]}]}。bbox 严格为 [左上角x,左上角y,右下角x,右下角y]，整张图左上角[0,0]、右下角[1000,1000]，必须满足 0<=x1<x2<=1000 和 0<=y1<y2<=1000。例子表示左10%、上20%、右80%、下90%，不是宽高，不使用0–1或像素值。复杂人物按头、躯干、四肢等语义部位划分，简单物体可以只有一部位。失败时仍给出可用部位建议。禁止 Markdown。';
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const imageURL = (raw: string) => {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !(url.hostname.endsWith(".aliyuncs.com") || url.hostname.endsWith(".alicdn.com"))) throw new ExplainerMediaError("百炼返回的图片下载地址无效");
  return url;
};

// 原始供应商响应不进入会话或日志，避免请求头、签名地址和 SDK 配置泄漏。
export class BailianDrawingClient {
  constructor(private readonly connection: {baseURL: string; apiKey: string}, private readonly request: typeof fetch = fetch) {}
  private async call(model: string, content: Array<{text: string} | {image: string}>, parameters: Record<string, unknown>, signal: AbortSignal, retrySafe = false) {
    let response: Response;
    // 视觉调用可有限重试；生图请求断线时可能已计费，不自动重复提交。
    for (let attempt = 0; ; attempt++) {
      try {
        response = await this.request(`${this.connection.baseURL}/services/aigc/multimodal-generation/generation`, {method: "POST", headers: {Authorization: `Bearer ${this.connection.apiKey}`, "Content-Type": "application/json"}, body: JSON.stringify({model, input: {messages: [{role: "user", content}]}, parameters}), signal});
      } catch {
        if (retrySafe && attempt < 2 && !signal.aborted) {await pause(500 * 2 ** attempt, undefined, {signal}); continue;}
        throw new ExplainerMediaError(signal.aborted ? "百炼调用已取消或超时" : "百炼连接失败，已完成素材已保留，请稍后重试");
      }
      if (retrySafe && attempt < 2 && [429, 500, 502, 503, 504].includes(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        await pause(500 * 2 ** attempt, undefined, {signal}); continue;
      }
      break;
    }
    if (!response.ok) throw new ExplainerMediaError(response.status === 429 ? "百炼调用限流，请稍后重试" : response.status === 401 || response.status === 403 ? "百炼鉴权失败，请检查根配置的业务空间、地域和模型权限" : `百炼调用失败（HTTP ${response.status}），请检查模型配置后重试`);
    let data: {code?: string; output?: {choices?: Array<{message?: {content?: Array<{image?: string; text?: string}>}}>}};
    try {data = await response.json();} catch {throw new ExplainerMediaError("百炼返回了无法读取的结果");}
    if (data.code || !data.output?.choices?.[0]?.message?.content) throw new ExplainerMediaError("百炼未返回有效结果，请检查模型配置与输入要求");
    return data.output.choices[0].message.content;
  }
  private async download(raw: string, signal: AbortSignal) {
    if (raw.startsWith("data:image/")) {
      const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/u.exec(raw);
      if (!match || match[1]!.length > MAX_IMAGE_BYTES * 1.4) throw new ExplainerMediaError("百炼返回的图片编码无效或过大");
      return Buffer.from(match[1]!, "base64");
    }
    let url = imageURL(raw);
    for (let redirect = 0; redirect < 4; redirect++) {
      let response: Response;
      try {response = await this.request(url, {signal, redirect: "manual"});}
      catch {throw new ExplainerMediaError(signal.aborted ? "百炼图片下载已取消或超时" : "百炼图片下载连接失败，已完成素材已保留");}
      if ([301, 302, 303, 307, 308].includes(response.status)) {url = imageURL(new URL(response.headers.get("location") ?? "", url).href); continue;}
      if (!response.ok || !response.body || Number(response.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) throw new ExplainerMediaError("百炼图片下载失败或图片过大，已保留本轮制作记录");
      const chunks: Uint8Array[] = []; let length = 0;
      const reader = response.body.getReader();
      try {
        while (true) {const next = await reader.read(); if (next.done) break; length += next.value.byteLength; if (length > MAX_IMAGE_BYTES) throw new ExplainerMediaError("百炼图片超过大小限制"); chunks.push(next.value);}
      } finally {await reader.cancel().catch(() => undefined);}
      return Buffer.concat(chunks);
    }
    throw new ExplainerMediaError("百炼图片下载重定向过多");
  }
  async generate(model: string, prompt: string, signal: AbortSignal, reference?: Buffer) {
    const content = [...(reference ? [{image: `data:image/png;base64,${reference.toString("base64")}`}] : []), {text: prompt}];
    const result = await this.call(model, content, {n: 1, size: "1024*1024", watermark: false, ...(!reference ? {prompt_extend: false} : {})}, signal);
    const image = result.find((item) => item.image)?.image;
    if (!image) throw new ExplainerMediaError("百炼图片模型未返回图片");
    const bytes = await this.download(image, signal);
    try {
      const metadata = await sharp(bytes, {limitInputPixels: 16_000_000}).metadata();
      if (!metadata.width || !metadata.height || !["png", "jpeg", "webp"].includes(metadata.format ?? "")) throw new ExplainerMediaError("百炼图片格式或尺寸无效");
      // 重编码为本地无损素材，运行时不依赖短期签名 URL 或图片元数据。
      return await sharp(bytes, {limitInputPixels: 16_000_000}).rotate().png().toBuffer();
    } catch (error) {
      if (error instanceof ExplainerMediaError) throw error;
      throw new ExplainerMediaError("百炼图片解码或转存失败，请检查图片格式与尺寸，已保存素材不受影响");
    }
  }
  async review(model: string, prompt: string, images: Buffer[], signal: AbortSignal) {
    let correction = "";
    // 同一图片最多一次带具体字段反馈的格式修正；无效报告绝不触发重新生图。
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await this.call(model, [...images.map((bytes) => ({image: `data:image/png;base64,${bytes.toString("base64")}`})), {text: `${prompt}\n${REVIEW_FORMAT}${correction}`}], {max_tokens: 3000, temperature: .1, enable_thinking: false}, signal, true);
      try {return parseExplainerReview(result.map((item) => item.text ?? "").join(""));}
      catch (error) {
        if (!(error instanceof ExplainerReviewError) || attempt === 1) throw error;
        correction = `\n上次报告解析失败：${JSON.stringify(error.diagnostic)}。请重新检查同一图片，用上述明确的 bbox 角点格式返回完整报告；不要复制无效坐标。`;
      }
    }
    throw new ExplainerMediaError("视觉复核未完成");
  }
}
