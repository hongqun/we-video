import {NextResponse} from "next/server";
import {requireAuth} from "@/lib/auth";
import {deleteVisualResourceImage, saveVisualResourceImage} from "@/lib/visual-resources";

export const runtime = "nodejs";
export async function POST(request: Request, context: {params: Promise<{id: string; segmentId: string}>}) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const {id, segmentId} = await context.params;
    const form = await request.formData();
    const value = form.get("image");
    if (!(value instanceof File)) throw new Error("请选择图片文件");
    const sceneIdValue = form.get("sceneId");
    const sceneId = typeof sceneIdValue === "string" && sceneIdValue.trim() ? sceneIdValue.trim() : undefined;
    const image = await saveVisualResourceImage(id, segmentId, value, sceneId);
    return NextResponse.json({segmentId, ...(sceneId ? {sceneId} : {}), ...image, path: `/api/jobs/${encodeURIComponent(id)}/artifacts/${image.imagePath}`});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "图片上传失败"}, {status: 400});
  }
}

export async function DELETE(request: Request, context: {params: Promise<{id: string; segmentId: string}>}) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const {id, segmentId} = await context.params;
    const body = await request.json().catch(() => ({})) as {sceneId?: unknown};
    const sceneId = typeof body.sceneId === "string" && body.sceneId.trim() ? body.sceneId.trim() : undefined;
    await deleteVisualResourceImage(id, segmentId, sceneId);
    return NextResponse.json({segmentId, ...(sceneId ? {sceneId} : {})});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "图片删除失败"}, {status: 400});
  }
}
