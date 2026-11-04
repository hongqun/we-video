import {NextResponse} from "next/server";
import {z} from "zod";
import {requireAuth} from "@/lib/auth";
import {deriveEnglishTask} from "@/lib/derivation";
import {newJobId} from "@/lib/job-id";
import {readJob} from "@/lib/jobs";

export const runtime = "nodejs";
const requestSchema = z.object({seriesId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/)});

export async function POST(request: Request, context: {params: Promise<{id: string}>}) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const {id} = await context.params;
    const {seriesId} = requestSchema.parse(await request.json());
    const jobId = await deriveEnglishTask(id, seriesId, newJobId());
    // 创建后直接打开全文审核；后台翻译失败也保留可编辑、可重试的任务。
    return NextResponse.json({jobId, state: (await readJob(jobId)).state}, {status: 202});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "派生英文视频失败"}, {status: 400});
  }
}
