import {NextResponse} from "next/server";
import {z} from "zod";
import {createSession, isAuthConfigured, passwordMatches, SESSION_COOKIE, sessionCookieOptions} from "@/lib/auth";
import {recordLoginFailure} from "@/lib/login-failures";

export const runtime = "nodejs";

const schema = z.object({password: z.string().min(1).max(512)});

const safeRecordLoginFailure = async (request: Request, reason: string) => {
  try {
    await recordLoginFailure(request, reason);
  } catch (error) {
    console.error("写入登录失败日志失败", error);
  }
};

export async function POST(request: Request) {
  if (!isAuthConfigured()) {
    await safeRecordLoginFailure(request, "auth_not_configured");
    return NextResponse.json({error: "服务端尚未配置 APP_PASSWORD 和 SESSION_SECRET"}, {status: 503});
  }
  try {
    const {password} = schema.parse(await request.json());
    if (!passwordMatches(password)) {
      await safeRecordLoginFailure(request, "invalid_password");
      return NextResponse.json({error: "密码错误"}, {status: 401});
    }
    const response = NextResponse.json({ok: true});
    response.cookies.set(SESSION_COOKIE, createSession(), sessionCookieOptions);
    return response;
  } catch (error) {
    await safeRecordLoginFailure(request, "invalid_login_request");
    return NextResponse.json({error: error instanceof Error ? error.message : "登录失败"}, {status: 400});
  }
}
