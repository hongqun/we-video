import {NextResponse} from "next/server";
import {publicPlatformProfile, readPlatformProfile} from "@/lib/profile";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    // 任务预览按任务快照读取专题；未指定时仍使用工作台的默认 profile。
    const url = new URL(request.url);
    const accountId = url.searchParams.get("accountId") ?? undefined;
    const seriesId = url.searchParams.get("seriesId") ?? undefined;
    return NextResponse.json(publicPlatformProfile(await readPlatformProfile(accountId, seriesId)));
  }
  catch (error) { return NextResponse.json({error: error instanceof Error ? error.message : "读取 profile 失败"}, {status: 500}); }
}
