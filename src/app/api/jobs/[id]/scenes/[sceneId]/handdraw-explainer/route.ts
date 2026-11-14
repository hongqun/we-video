import {NextResponse} from "next/server";
import {z} from "zod";
import {requireAuth} from "@/lib/auth";
import {adoptExplainer, cancelExplainer, readExplainerSnapshot, submitExplainer} from "@/lib/handdraw-explainer/service";

export const runtime = "nodejs";
type Context = {params: Promise<{id: string; sceneId: string}>};
const failure = (error: unknown) => NextResponse.json({error: error instanceof Error ? error.message : "手绘讲解操作失败"}, {status: 400});

// 与任务附件共用登录鉴权；客户端只传镜头 ID 和用户指令，不传本地路径或模型凭据。
export async function GET(request: Request, route: Context) {
  const unauthorized = await requireAuth(); if (unauthorized) return unauthorized;
  try {
    const {id, sceneId} = await route.params;
    const initial = await readExplainerSnapshot(id, sceneId);
    if (new URL(request.url).searchParams.get("stream") !== "1") return NextResponse.json(initial);
    const encoder = new TextEncoder();
    let stopped = false;
    let wake: (() => void) | undefined;
    const stop = () => {stopped = true; wake?.();};
    const stream = new ReadableStream<Uint8Array>({
      async start(output) {
        request.signal.addEventListener("abort", stop, {once: true});
        if (request.signal.aborted) stop();
        const push = (event: string, data: unknown) => {if (!stopped) output.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));};
        let signature = JSON.stringify(initial);
        const started = Date.now();
        try {
          push("snapshot", initial);
          while (!stopped && Date.now() - started < 55000) {
            await new Promise<void>((resolve) => {const timer = setTimeout(done, 1200); function done() {clearTimeout(timer); wake = undefined; resolve();} wake = done;});
            if (stopped) break;
            const next = await readExplainerSnapshot(id, sceneId);
            const key = JSON.stringify(next);
            if (key !== signature) {signature = key; push("snapshot", next);}
          }
        } catch {push("stream-error", {error: "实时连接暂时中断，正在重新连接"});}
        finally {request.signal.removeEventListener("abort", stop); if (!stopped) output.close();}
      },
      cancel: stop,
    });
    return new Response(stream, {headers: {"Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"}});
  } catch (error) {return failure(error);}
}

export async function POST(request: Request, route: Context) {
  const unauthorized = await requireAuth(); if (unauthorized) return unauthorized;
  try {
    const {id, sceneId} = await route.params;
    const body = z.object({action: z.enum(["send", "retry", "cancel", "adopt", "withdraw"]), message: z.string().optional()}).strict().parse(await request.json());
    if (body.action === "send") await submitExplainer(id, sceneId, body.message ?? "");
    else if (body.action === "retry") {
      const snapshot = await readExplainerSnapshot(id, sceneId);
      const message = snapshot.session.messages.filter((item) => item.role === "user").at(-1)?.text;
      if (!message) throw new Error("没有可重试的制作指令");
      await submitExplainer(id, sceneId, message);
    } else if (body.action === "cancel") await cancelExplainer(id, sceneId);
    else return NextResponse.json({plan: await adoptExplainer(id, sceneId, body.action === "withdraw")});
    return NextResponse.json(await readExplainerSnapshot(id, sceneId), {status: body.action === "send" || body.action === "retry" ? 202 : 200});
  } catch (error) {return failure(error);}
}
