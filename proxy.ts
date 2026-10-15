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
  if (artifactMatch && verifyRenderArtifactToken(artifactMatch[1], request.nextUrl.searchParams.get("renderToken"))) {
    return NextResponse.next();
  }
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({error: "请先登录"}, {status: 401});
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
