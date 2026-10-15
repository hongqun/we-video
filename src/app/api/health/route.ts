import {NextResponse} from "next/server";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ok: true, service: "talk-video", port: 3100}, {
    headers: {"Cache-Control": "no-store"},
  });
}
