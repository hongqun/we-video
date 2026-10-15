import {NextResponse} from "next/server";
import {requireAuth} from "@/lib/auth";
import {readLoginFailures} from "@/lib/login-failures";

export const runtime = "nodejs";

export async function GET() {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json({failures: await readLoginFailures()});
  } catch (error) {
    console.error("读取登录失败日志失败", error);
    return NextResponse.json({error: "读取登录失败日志失败"}, {status: 500});
  }
}
