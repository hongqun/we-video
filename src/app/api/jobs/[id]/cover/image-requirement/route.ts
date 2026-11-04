import {NextResponse} from "next/server";
import {requireAuth} from "@/lib/auth";
import {generateCoverImageRequirement} from "@/lib/visual-requirement";

export const runtime = "nodejs";

export async function POST(_request: Request, context: {params: Promise<{id: string}>}) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const {id} = await context.params;
    return NextResponse.json(await generateCoverImageRequirement(id));
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "生成封面图片要求失败"}, {status: 400});
  }
}
