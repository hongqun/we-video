import {NextResponse} from "next/server";
import {requireAuth} from "@/lib/auth";
import {readJob, updateJobState} from "@/lib/jobs";
import {deleteCoverImage, saveCoverImage} from "@/lib/cover-image";

export const runtime = "nodejs";

export async function POST(request: Request, context: {params: Promise<{id: string}>}) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const {id} = await context.params;
    const form = await request.formData();
    const value = form.get("image");
    if (!(value instanceof File)) throw new Error("请选择图片文件");
    const result = await saveCoverImage(id, value);
    const job = await readJob(id);
    if (["ready", "completed", "failed"].includes(job.state)) await updateJobState(id, {state: "awaiting_visual_review", error: null});
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "封面图片上传失败"}, {status: 400});
  }
}

export async function DELETE(_request: Request, context: {params: Promise<{id: string}>}) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const {id} = await context.params;
    const result = await deleteCoverImage(id);
    const job = await readJob(id);
    if (["ready", "completed", "failed"].includes(job.state)) await updateJobState(id, {state: "awaiting_visual_review", error: null});
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "封面图片删除失败"}, {status: 400});
  }
}
