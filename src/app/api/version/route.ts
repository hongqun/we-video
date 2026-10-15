import {NextResponse} from "next/server";
import {requireAuth} from "@/lib/auth";
import {readAppVersion} from "@/lib/app-version";

export const runtime = "nodejs";

export async function GET() {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json({version: await readAppVersion()});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "读取版本信息失败"}, {status: 500});
  }
}
