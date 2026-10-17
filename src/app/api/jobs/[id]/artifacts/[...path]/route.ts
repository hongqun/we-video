import {createReadStream} from "node:fs";
import {promises as fs} from "node:fs";
import {Readable} from "node:stream";
import {NextResponse} from "next/server";
import {jobStateAllowsOutput, readJob, safeArtifactPath} from "@/lib/jobs";
import {verifyRenderArtifactToken} from "@/lib/render-access";
import {videoDownloadAsciiFallback, videoDownloadFilename} from "@/lib/filename";
import {requireAuth} from "@/lib/auth";

export const runtime = "nodejs";

const contentType = (file: string) => file.endsWith(".wav") ? "audio/wav" : file.endsWith(".mp4") ? "video/mp4" : file.endsWith(".json") ? "application/json; charset=utf-8" : file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".png") ? "image/png" : file.endsWith(".jpg") || file.endsWith(".jpeg") ? "image/jpeg" : file.endsWith(".webp") ? "image/webp" : "application/octet-stream";
// 页面预览和长时成片共用验签入口，令牌有效期由签名内容限定。
const renderAccess = (request: Request, id: string) => verifyRenderArtifactToken(id, new URL(request.url).searchParams.get("renderToken"));

// 预览音视频依赖 HTTP Range 跳转到指定时间；仅支持浏览器常用的单区间请求。
const byteRangeForRequest = (rangeHeader: string | null, size: number): {start: number; end: number} | null | "invalid" => {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(rangeHeader.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return "invalid";
  const requestedStart = match[1] ? Number(match[1]) : undefined;
  const requestedEnd = match[2] ? Number(match[2]) : undefined;
  if ((requestedStart !== undefined && !Number.isSafeInteger(requestedStart)) || (requestedEnd !== undefined && !Number.isSafeInteger(requestedEnd))) return "invalid";
  if (requestedStart === undefined) {
    const length = requestedEnd!;
    if (length <= 0) return "invalid";
    return {start: Math.max(0, size - length), end: size - 1};
  }
  if (requestedStart >= size) return "invalid";
  const end = Math.min(requestedEnd ?? size - 1, size - 1);
  return end < requestedStart ? "invalid" : {start: requestedStart, end};
};

export async function OPTIONS(request: Request, context: {params: Promise<{id: string; path: string[]}>}) {
  const {id} = await context.params;
  if (!renderAccess(request, id)) return new Response(null, {status: 401});
  return new Response(null, {status: 204, headers: {"Access-Control-Allow-Origin": request.headers.get("origin") ?? "*", "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": request.headers.get("access-control-request-headers") ?? "Range", "Vary": "Origin"}});
}

export async function GET(request: Request, context: {params: Promise<{id: string; path: string[]}>}) {
  const params = await context.params;
  const unauthorized = renderAccess(request, params.id) ? null : await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const isOutput = params.path.length === 1 && params.path[0] === "output.mp4";
    if (isOutput && !jobStateAllowsOutput(await readJob(params.id))) return NextResponse.json({error: "成片尚未发布完成"}, {status: 409});
    const file = safeArtifactPath(params.id, params.path);
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error("文件不存在");
    const range = byteRangeForRequest(request.headers.get("range"), stat.size);
    if (range === "invalid") return new Response(null, {status: 416, headers: {"Accept-Ranges": "bytes", "Content-Range": `bytes */${stat.size}`}});
    const stream = Readable.toWeb(createReadStream(file, range ?? undefined)) as ReadableStream;
    const length = range ? range.end - range.start + 1 : stat.size;
    // 离线渲染会从 Remotion 的独立页面读取任务附件；允许带令牌的资源跨源读取，透明图片才能完成扫描区域分析。
    const headers: Record<string, string> = {"Accept-Ranges": "bytes", "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Origin": request.headers.get("origin") ?? "*", "Cache-Control": isOutput ? "private, no-store" : "private, no-cache", "Content-Length": String(length), "Content-Type": contentType(file), "Vary": "Origin"};
    if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${stat.size}`;
    if (isOutput) {
      const manifest = JSON.parse(await fs.readFile(safeArtifactPath(params.id, ["manifest.json"]), "utf8")) as {title?: unknown; brand?: {downloadPrefix?: string}};
      const title = typeof manifest.title === "string" ? manifest.title : "";
      const prefix = manifest.brand?.downloadPrefix ?? "tech123-video";
      const filename = videoDownloadFilename(title, prefix);
      // 兼容不识别 filename* 的浏览器，也不能再写死为 video.mp4。
      headers["Content-Disposition"] = `attachment; filename="${videoDownloadAsciiFallback(title, prefix)}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
    }
    return new Response(stream, {status: range ? 206 : 200, headers});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "读取文件失败"}, {status: 404});
  }
}
