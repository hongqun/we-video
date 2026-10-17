import {NextResponse} from "next/server";
import {requireAuth} from "@/lib/auth";
import {deleteVisualResourceModel, saveVisualResourceModel} from "@/lib/visual-resources";

export const runtime = "nodejs";

export async function POST(request: Request, context: {params: Promise<{id: string; segmentId: string}>}) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const {id, segmentId} = await context.params;
    const form = await request.formData();
    const file = form.get("model");
    const sceneId = form.get("sceneId");
    if (!(file instanceof File) || typeof sceneId !== "string") throw new Error("请选择 GLB 文件和目标镜头");
    return NextResponse.json(await saveVisualResourceModel(id, segmentId, sceneId, file));
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "模型上传失败"}, {status: 400});
  }
}

export async function DELETE(request: Request, context: {params: Promise<{id: string; segmentId: string}>}) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const {id, segmentId} = await context.params;
    const body = await request.json() as {sceneId?: string};
    if (!body.sceneId) throw new Error("缺少目标镜头");
    await deleteVisualResourceModel(id, segmentId, body.sceneId);
    return NextResponse.json({sceneId: body.sceneId});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "模型删除失败"}, {status: 400});
  }
}
