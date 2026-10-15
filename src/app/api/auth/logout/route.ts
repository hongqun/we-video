import {NextResponse} from "next/server";
import {SESSION_COOKIE, sessionCookieOptions} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ok: true});
  response.cookies.set(SESSION_COOKIE, "", {...sessionCookieOptions, maxAge: 0});
  return response;
}
