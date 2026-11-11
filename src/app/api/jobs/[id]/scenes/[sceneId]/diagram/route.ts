import {NextResponse} from "next/server";
import {z} from "zod";
import {requireAuth} from "@/lib/auth";
import {adoptDiagram, cancelDiagram, changeDiagramBindings, changeDiagramDrawing, readDiagramSnapshot, submitDiagram} from "@/lib/diagram/service";
import {readDiagramSession} from "@/lib/diagram/store";

export const runtime = "nodejs";
type Context = {params: Promise<{id: string; sceneId: string}>};
const failure = (error: unknown) => NextResponse.json({error: error instanceof Error ? error.message : "图表操作失败"}, {status: 400});
// 与任务资源入口共用登录鉴权；镜头必须属于当前已保存规划，路径由服务端限制。
export async function GET(request: Request, context: Context) {
  const unauthorized = await requireAuth(); if (unauthorized) return unauthorized;
  try {
    const {id, sceneId} = await context.params;
    const initial = await readDiagramSnapshot(id, sceneId);
    if (new URL(request.url).searchParams.get("stream") !== "1") return NextResponse.json(initial);
    // SSE 只推送发生变化的快照；断开浏览器连接不取消独立 worker。
    const encoder = new TextEncoder();
    let stopped = false;
    let wake: (() => void) | undefined;
    const stop = () => {stopped = true; wake?.();};
    const stream = new ReadableStream<Uint8Array>({
      async start(output) {
        request.signal.addEventListener("abort", stop, {once: true});
        if (request.signal.aborted) stop();
        const push = (event: string, data: unknown) => {if (!stopped) output.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));};
        let signature = JSON.stringify(initial.session);
        let running = initial.session.status === "running";
        const started = Date.now();
        let heartbeat = started;
        try {
          push("snapshot", initial);
          // 定期结束连接交给 EventSource 重连，避免长期占用单次请求。
          while (!stopped && Date.now() - started < 55000) {
            await new Promise<void>((resolve) => {
              const timer = setTimeout(done, running ? 150 : 1000);
              function done() {clearTimeout(timer); wake = undefined; resolve();}
              wake = done;
            });
            if (stopped) break;
            const session = await readDiagramSession(id, sceneId);
            const nextSignature = JSON.stringify(session);
            // 无消息变化时仍定期检查 worker 中断和镜头上下文变化。
            if (nextSignature !== signature || Date.now() - heartbeat >= 15000) {
              const next = await readDiagramSnapshot(id, sceneId);
              signature = JSON.stringify(next.session); running = next.session.status === "running";
              push("snapshot", next); heartbeat = Date.now();
            }
          }
        } catch {push("stream-error", {error: "实时连接暂时中断，正在重新连接"});}
        finally {request.signal.removeEventListener("abort", stop); if (!stopped) output.close();}
      },
      cancel: stop,
    });
    return new Response(stream, {headers: {"Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"}});
  } catch (error) {return failure(error);}
}
export async function POST(request: Request, context: Context) {
  const unauthorized = await requireAuth(); if (unauthorized) return unauthorized;
  try {
    const {id, sceneId} = await context.params;
    // 手工保存携带原候选，服务端检查并发修改后再执行完整校验。
    const body = z.object({action: z.enum(["send", "retry", "cancel", "bindings", "drawing", "adopt", "withdraw"]), message: z.string().optional(), bindings: z.unknown().optional(), drawing: z.unknown().optional()}).strict().parse(await request.json());
    if (body.action === "send") return NextResponse.json(await submitDiagram(id, sceneId, body.message ?? ""), {status: 202});
    if (body.action === "retry") {
      const snapshot = await readDiagramSnapshot(id, sceneId);
      const text = snapshot.session.messages.filter((item) => item.role === "user").at(-1)?.text;
      if (!text) throw new Error("没有可重试的指令");
      return NextResponse.json(await submitDiagram(id, sceneId, text), {status: 202});
    }
    if (body.action === "cancel") {await cancelDiagram(id, sceneId); return NextResponse.json(await readDiagramSnapshot(id, sceneId));}
    if (body.action === "bindings") return NextResponse.json(await changeDiagramBindings(id, sceneId, body.bindings));
    if (body.action === "drawing") return NextResponse.json(await changeDiagramDrawing(id, sceneId, body.drawing));
    return NextResponse.json({plan: await adoptDiagram(id, sceneId, body.action === "withdraw")});
  } catch (error) {return failure(error);}
}
