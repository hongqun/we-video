import {NextResponse} from "next/server";
import {z} from "zod";
import {acceptNarration} from "@/lib/narration";
import {requireAuth} from "@/lib/auth";

export const runtime = "nodejs";

const requestSchema = z.object({draft: z.record(z.string(), z.unknown()).optional()});

// 接受接口允许提交用户编辑后的候选稿，由领域层再次归一化和校验。

export async function POST(request: Request, context: {params: Promise<{id: string}>}) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const {id} = await context.params;
    const body = await request.json().catch(() => ({}));
    const input = requestSchema.parse(body);
    return NextResponse.json(await acceptNarration(id, input.draft));
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "采用候选稿失败"}, {status: 400});
  }
}
