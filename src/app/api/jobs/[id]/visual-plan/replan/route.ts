import {NextResponse} from "next/server";
import {z} from "zod";
import {readJob, updateJobState} from "@/lib/jobs";
import {startVisualPlanWorker} from "@/lib/processes";
import {requireAuth} from "@/lib/auth";
import {assertVisualPlanEditableState} from "@/lib/visual-plan";
export const runtime = "nodejs";
export async function POST(request: Request, context: {params: Promise<{id: string}>}) { const unauthorized = await requireAuth(); if (unauthorized) return unauthorized; try { const {id} = await context.params; const job = await readJob(id); assertVisualPlanEditableState(job.state); const {feedback} = z.object({feedback: z.string().trim().min(4).max(4000)}).parse(await request.json()); await updateJobState(id, {state: "planning_visuals", error: null}); await startVisualPlanWorker("replan", id, feedback); return NextResponse.json({jobId: id, state: "planning_visuals"}, {status: 202}); } catch (error) { return NextResponse.json({error: error instanceof Error ? error.message : "重新规划失败"}, {status: 400}); } }
