import {NextResponse} from "next/server";
import {requireAuth} from "@/lib/auth";
import {listSourceProfiles} from "@/lib/profile";

export const runtime = "nodejs";

export async function GET() {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    // 只返回可直接输入素材的母稿专栏，派生专栏不出现在第一步。
    return NextResponse.json({profiles: await listSourceProfiles()});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "读取专栏失败"}, {status: 500});
  }
}
