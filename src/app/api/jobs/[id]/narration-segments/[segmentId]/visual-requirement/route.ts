import {NextResponse} from "next/server";
import {generateVisualRequirement} from "@/lib/visual-requirement";
import {requireAuth} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request, context: {params: Promise<{id: string; segmentId: string}>}) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const {id, segmentId} = await context.params;
    const body = await request.json().catch(() => ({})) as {transparentBackground?: unknown; spokenText?: unknown};
    // 旧客户端不传参数时继续生成透明背景，避免已有调用方行为突变。
    const transparentBackground = typeof body.transparentBackground === "boolean" ? body.transparentBackground : true;
    // 镜头规划传入拆分后的当前口播；视觉资源准备页不传时保持完整段落行为。
    const spokenText = typeof body.spokenText === "string" ? body.spokenText : undefined;
    return NextResponse.json(await generateVisualRequirement(id, segmentId, transparentBackground, spokenText));
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "生成视觉要求失败"}, {status: 400});
  }
}
