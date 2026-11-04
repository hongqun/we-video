import {NextResponse} from "next/server";
import {requireAuth} from "@/lib/auth";
import {readJob, updateJobState} from "@/lib/jobs";
import {startVisualPlanWorker} from "@/lib/processes";

export const runtime = "nodejs";

export async function POST(_request: Request, context: {params: Promise<{id: string}>}) {
  const unauthorized = await requireAuth(); if (unauthorized) return unauthorized;
  try {
    const {id} = await context.params; const job = await readJob(id);
    if (job.state !== "awaiting_visual_resources") throw new Error("当前状态不能开始镜头规划");
    // 规划入口只在资源准备完成后开放，避免音频确认时自动调用模型。
    await updateJobState(id, {state: "planning_visuals", error: null});
    await startVisualPlanWorker("generate", id);
    return NextResponse.json({jobId: id, state: "planning_visuals"}, {status: 202});
  } catch (error) { return NextResponse.json({error: error instanceof Error ? error.message : "启动镜头规划失败"}, {status: 400}); }
}
