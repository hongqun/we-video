import {NextResponse} from "next/server";
import {requireAuth} from "@/lib/auth";
import {saveSegmentPolygons} from "@/lib/visual-requirement";

export const runtime = "nodejs";

// 第四步只保存当前 revision 的独立多边形资源，不回写已确认口播稿。
export async function PUT(request: Request, context: {params: Promise<{id: string; segmentId: string}>}) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const {id, segmentId} = await context.params;
    const body = await request.json() as unknown;
    const polygons = Array.isArray(body) ? body : body && typeof body === "object" ? (body as {polygons?: unknown}).polygons : undefined;
    const sceneId = body && typeof body === "object" && !Array.isArray(body) && typeof (body as {sceneId?: unknown}).sceneId === "string"
      ? ((body as {sceneId: string}).sceneId.trim() || undefined)
      : undefined;
    const resources = await saveSegmentPolygons(id, segmentId, polygons, sceneId);
    return NextResponse.json({resources});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "保存多边形失败"}, {status: 400});
  }
}
