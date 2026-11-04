import {NextResponse} from "next/server";
import {readJob, updateJobState} from "@/lib/jobs";
import {requireAuth} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(_request: Request, context: {params: Promise<{id: string}>}) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const {id} = await context.params;
    const job = await readJob(id);
    if (job.state !== "awaiting_audio_review") throw new Error("当前没有可退回的待确认音频");
    await updateJobState(id, {state: "awaiting_script_review", error: null});
    return NextResponse.json({jobId: id, state: "awaiting_script_review"});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "退回口播稿失败"}, {status: 400});
  }
}
