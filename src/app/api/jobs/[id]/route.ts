import {promises as fs} from "node:fs";
import {NextResponse} from "next/server";
import {assertJobId, jobDir, readJob, snapshot, updateJobState} from "@/lib/jobs";
import {requireAuth} from "@/lib/auth";

export const runtime = "nodejs";

// 翻译、分段、合成和渲染中的任务禁止删除，避免后台子进程继续写入已删除目录。
const ACTIVE_STATES = new Set(["synthesizing", "rendering", "translating", "segmenting_translation"]);

const requestOrigin = (request: Request) => {
  const configuredOrigin = process.env.APP_PUBLIC_ORIGIN?.trim();
  if (configuredOrigin) {
    const configuredUrl = new URL(configuredOrigin);
    if (configuredUrl.protocol !== "http:" && configuredUrl.protocol !== "https:") {
      throw new Error("APP_PUBLIC_ORIGIN 必须使用 HTTP 或 HTTPS");
    }
    return configuredUrl.origin;
  }

  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto === "http" || forwardedProto === "https"
    ? forwardedProto
    : url.protocol.slice(0, -1);
  const host = request.headers.get("host") || url.host;
  return `${protocol}://${host}`;
};

export async function GET(request: Request, context: {params: Promise<{id: string}>}) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const {id} = await context.params;
    const job = await readJob(id);
    // 兼容已经完成音频、但停留在旧资源准备状态的派生任务，打开时直接进入母稿规划审核。
    if (job.derivationKind === "translation" && job.state === "awaiting_visual_resources") {
      await Promise.all([
        fs.access(`${jobDir(id)}/visual-plan.json`),
        fs.access(`${jobDir(id)}/audio/narration.json`),
      ]);
      await updateJobState(id, {state: "awaiting_visual_review", error: null});
    }
    return NextResponse.json(await snapshot(id, requestOrigin(request)));
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "读取任务失败"}, {status: 404});
  }
}

export async function DELETE(_request: Request, context: {params: Promise<{id: string}>}) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const {id} = await context.params;
    assertJobId(id);
    try {
      if (ACTIVE_STATES.has((await readJob(id)).state)) {
        return NextResponse.json({error: "任务正在生成中，请稍后再试"}, {status: 409});
      }
    } catch {
      // 无 job.json 或读取失败：继续删除已存在的目录
    }
    await fs.rm(jobDir(id), {recursive: true, force: true});
    return NextResponse.json({deleted: true});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "删除任务失败"}, {status: 500});
  }
}
