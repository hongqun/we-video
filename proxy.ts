import {NextRequest, NextResponse} from "next/server";
import {SESSION_COOKIE, verifySession} from "@/lib/auth";
import {verifyRenderArtifactToken} from "@/lib/render-access";

const isPublic = (pathname: string) =>
  pathname === "/login" ||
  pathname === "/api/health" ||
  pathname.startsWith("/api/auth/") ||
  pathname.startsWith("/_next/") ||
  pathname === "/favicon.ico";

export function proxy(request: NextRequest) {
  if (isPublic(request.nextUrl.pathname)) return NextResponse.next();
  if (verifySession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const artifactMatch = request.nextUrl.pathname.match(/^\/api\/jobs\/([^/]+)\/artifacts\//);
  if (artifactMatch) {
    // 路径中的任务 ID 带空格和冒号，验签必须与路由参数使用同一解码值。
    let artifactJobId: string | undefined;
    try {artifactJobId = decodeURIComponent(artifactMatch[1]);} catch { /* 无效编码按未授权处理。 */ }
    if (artifactJobId && verifyRenderArtifactToken(artifactJobId, request.nextUrl.searchParams.get("renderToken"))) {
      return NextResponse.next();
    }
  }
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({error: "请先登录"}, {status: 401});
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
