import {NextResponse} from "next/server";
import {requireAuth} from "@/lib/auth";
import {readPlatformProfile} from "@/lib/profile";
import {readMathHistory, removeMathHistory} from "@/math/service";

export const runtime = "nodejs";

export async function GET() {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const profile = await readPlatformProfile("tech123", "math-beautiful");
    return NextResponse.json({history: await readMathHistory(profile.accountId, profile.seriesId)});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "读取公式历史失败"}, {status: 500});
  }
}

export async function DELETE(request: Request) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const profile = await readPlatformProfile("tech123", "math-beautiful");
    const signature = new URL(request.url).searchParams.get("signature") ?? undefined;
    await removeMathHistory(profile.accountId, profile.seriesId, signature);
    return NextResponse.json({deleted: true});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "删除公式历史失败"}, {status: 400});
  }
}
