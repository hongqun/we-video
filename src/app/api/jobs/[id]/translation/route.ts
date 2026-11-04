import {NextResponse} from "next/server";
import {z} from "zod";
import {requireAuth} from "@/lib/auth";
import {submitTranslation} from "@/lib/derivation";
import {translationTextSchema} from "@/lib/translation-review";
import {snapshot} from "@/lib/jobs";

export const runtime = "nodejs";
// 保存允许暂存空稿，确认时才检查标题和正文，避免用户编辑途中丢失内容。
const requestSchema = z.discriminatedUnion("action", [
  z.object({action: z.literal("save"), translated: translationTextSchema}),
  z.object({action: z.literal("confirm"), translated: translationTextSchema}),
  z.object({action: z.literal("generate")}),
]);

export async function POST(request: Request, context: {params: Promise<{id: string}>}) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const {id} = await context.params;
    const body = requestSchema.parse(await request.json());
    await submitTranslation(id, body.action, "translated" in body ? body.translated : undefined);
    return NextResponse.json(await snapshot(id), {status: body.action === "save" ? 200 : 202});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "处理译稿失败"}, {status: 400});
  }
}
