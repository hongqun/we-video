import {NextResponse} from "next/server";
import {readJob, updateJobState} from "@/lib/jobs";
import {readJobPlatformProfile} from "@/lib/profile";
import {assertVisualPlanEditableState, readVisualPlan, saveVisualPlan, visualPlanSaveInputSchema} from "@/lib/visual-plan";
import {requireAuth} from "@/lib/auth";

export const runtime = "nodejs";
// 允许已生成或已渲染任务继续修订镜头规划；仅由规划/定稿进行中的状态阻止并发覆盖。
export async function GET(_request: Request, context: {params: Promise<{id: string}>}) { const unauthorized = await requireAuth(); if (unauthorized) return unauthorized; try { const {id} = await context.params; return NextResponse.json({plan: await readVisualPlan(id)}); } catch (error) { return NextResponse.json({error: error instanceof Error ? error.message : "读取镜头规划失败"}, {status: 404}); } }
export async function PUT(request: Request, context: {params: Promise<{id: string}>}) { const unauthorized = await requireAuth(); if (unauthorized) return unauthorized; try { const {id} = await context.params; const job = await readJob(id); assertVisualPlanEditableState(job.state); const input = visualPlanSaveInputSchema.parse(await request.json()); const profile = await readJobPlatformProfile(job.contentProfile, job.jobId); const plan = await saveVisualPlan(id, input, profile); if (["ready", "completed", "failed"].includes(job.state)) await updateJobState(id, {state: "awaiting_visual_review", error: null}); return NextResponse.json({plan}); } catch (error) { return NextResponse.json({error: error instanceof Error ? error.message : "保存镜头规划失败"}, {status: 400}); } }
