import {promises as fs} from "node:fs";
import {NextResponse} from "next/server";
import {z} from "zod";
import {assertTranslationReviewed, readJob, updateJobState} from "@/lib/jobs";
import {startTypeScriptNarration, writeRequestFile} from "@/lib/processes";
import {requireAuth} from "@/lib/auth";
import {readJobPlatformProfile} from "@/lib/profile";

export const runtime = "nodejs";

const requestSchema = z.object({
  draft: z.record(z.string(), z.unknown()),
  feedback: z.string().trim().min(4, "反馈内容至少需要 4 个字符").max(4000, "反馈内容不能超过 4000 个字符"),
});

// 与工作台 EDITOR_LOCKED_STATES 一致：只有任务正在跑（生成/合成/渲染）时才禁止提交。
// 单数据任务覆盖当前稿件；下游产物会在后续确认时重新生成。
const LOCKED_STATES: Record<string, string> = {
  drafting: "文稿生成",
  synthesizing: "语音合成",
  rendering: "视频渲染",
};

// 修订复用当前来源和草稿，但由后台 Worker 重新调用 DeepSeek。

export async function POST(request: Request, context: {params: Promise<{id: string}>}) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  let inputFile: string | null = null;
  try {
    const {id} = await context.params;
    // 全文审核未完成时，旧审稿接口不能绕过翻译与分段。
    await assertTranslationReviewed(id);
    const job = await readJob(id);
    const busy = LOCKED_STATES[job.state];
    if (busy) {
      throw new Error(`任务${busy}中，暂时无法提交 AI 修正，请稍后再试`);
    }
    const body = requestSchema.parse(await request.json());
    // 修订只使用任务已固定的配置，旧任务需先确认迁移。
    await readJobPlatformProfile(job.contentProfile, job.jobId);
    inputFile = await writeRequestFile(`${id}-feedback`, body);
    await updateJobState(id, {state: "drafting", error: null});
    await startTypeScriptNarration("revise", id, inputFile, {textModel: job.generation?.textModel});
    inputFile = null;
    return NextResponse.json({jobId: id, state: "drafting"}, {status: 202});
  } catch (error) {
    if (inputFile) await fs.unlink(inputFile).catch(() => undefined);
    return NextResponse.json({error: error instanceof Error ? error.message : "提交 AI 修正失败"}, {status: 400});
  }
}
