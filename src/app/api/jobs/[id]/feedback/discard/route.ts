import {NextResponse} from "next/server";
import {discardNarration} from "@/lib/narration";
import {requireAuth} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(_request: Request, context: {params: Promise<{id: string}>}) {
  // 丢弃候选稿只清理待确认状态，不修改当前已保存的正式文稿。
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const {id} = await context.params;
    return NextResponse.json(await discardNarration(id));
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "保留当前稿失败"}, {status: 400});
  }
}
