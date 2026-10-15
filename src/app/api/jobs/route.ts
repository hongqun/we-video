import {promises as fs} from "node:fs";
import {NextResponse} from "next/server";
import {z} from "zod";
import {startTypeScriptNarration, writeRequestFile} from "@/lib/processes";
import {readPipelineSettings} from "@/lib/pipeline-settings";
import {JOBS_ROOT} from "@/lib/paths";
import {initializeNarrationJob, jobDir, readJob, readJson} from "@/lib/jobs";
import {requireAuth} from "@/lib/auth";
import {profileContext, readPlatformProfile} from "@/lib/profile";
import {atomicWriteJson} from "@/lib/jobs";
import {createMathDraft, mathResolutionSchema} from "@/math/service";
import {mathFormulaIdSchema} from "@/math/formulas";
import {newJobId} from "@/lib/job-id";

export const runtime = "nodejs";

const requestSchema = z.discriminatedUnion("type", [
  z.object({type: z.literal("text"), text: z.string().min(20), title: z.string().optional(), accountId: z.string().optional(), seriesId: z.string().optional(), sourceLanguage: z.enum(["auto", "zh", "en", "mixed"]).default("auto"), textModel: z.enum(["deepseek-v4-flash", "deepseek-v4-pro"])}),
  z.object({type: z.literal("url"), url: z.string().url(), accountId: z.string().optional(), seriesId: z.string().optional(), sourceLanguage: z.enum(["auto", "zh", "en", "mixed"]).default("auto"), textModel: z.enum(["deepseek-v4-flash", "deepseek-v4-pro"])}),
  z.object({type: z.literal("script"), text: z.string().min(20), accountId: z.string().optional(), seriesId: z.string().optional(), sourceLanguage: z.enum(["auto", "zh", "en", "mixed"]).default("auto"), textModel: z.enum(["deepseek-v4-flash", "deepseek-v4-pro"])}),
  z.object({type: z.literal("math"), accountId: z.string().optional(), seriesId: z.string().optional(), instruction: z.string().trim().max(1000).optional(), formulaId: z.union([mathFormulaIdSchema, z.literal("auto")]).optional(), resolution: mathResolutionSchema.default("1080x1260")}),
]);

// 文稿入口同时接受粘贴文本和网页地址；模型白名单由配置读取后再次校验。

export async function GET() {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const entries = await fs.readdir(JOBS_ROOT, {withFileTypes: true});
    const jobs = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      try {
        const job = await readJob(entry.name);
        const draft = await readJson<{title?: string}>(`${jobDir(entry.name)}/draft.json`).catch(() => null);
        // 全文审核尚无正式草稿，列表优先显示已翻译标题，再回退到母稿标题。
        const translation = draft ? null : await readJson<{source: {title: string}; translated: {title: string}}>(`${jobDir(entry.name)}/translation.json`).catch(() => null);
        return {
          jobId: job.jobId,
          title: draft?.title ?? (translation?.translated.title || translation?.source.title) ?? `任务 ${job.jobId.slice(0, 8)}`,
          state: job.state,
          updatedAt: job.updatedAt,
        };
      } catch {
        return null;
      }
    }));
    jobs.sort((left, right) => (left && right ? right.updatedAt.localeCompare(left.updatedAt) : 0));
    return NextResponse.json({jobs: jobs.filter((job): job is NonNullable<typeof job> => Boolean(job))});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "读取任务列表失败"}, {status: 500});
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const jobId = newJobId();
  let inputFile: string | null = null;
  try {
    const body = requestSchema.parse(await request.json());
    if (body.type === "math") {
      const profile = await readPlatformProfile(body.accountId, body.seriesId);
      if (profile.seriesId !== "math-beautiful") throw new Error("数学模式必须使用数学之美专题");
      const draft = await createMathDraft(profile.accountId, profile.seriesId, body.instruction ?? "", body.formulaId, body.resolution);
      const directory = jobDir(jobId);
      await atomicWriteJson(`${directory}/source.json`, {type: "math", instruction: body.instruction ?? "", detectedLanguage: "zh", originalText: ""});
      await atomicWriteJson(`${directory}/draft.json`, draft);
      await atomicWriteJson(`${jobDir(jobId)}/job.json`, {
        jobId, state: "awaiting_review", error: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        contentMode: "math", contentProfile: profileContext(profile),
      });
      return NextResponse.json({jobId, state: "awaiting_review", contentProfile: profileContext(profile), contentMode: "math"}, {status: 202});
    }
    const profile = await readPlatformProfile(body.accountId, body.seriesId);
    if (profile.kind !== "source") throw new Error("派生专栏不能直接输入素材，请先完成中文母稿视频");
    const settings = await readPipelineSettings(profile);
    if (!settings.textModels.includes(body.textModel)) throw new Error("不支持的 DeepSeek 文稿模型");
    inputFile = await writeRequestFile(jobId, body);
    // 在返回 jobId 前写好任务记录，避免前端轮询早于后台 worker 初始化。
    await initializeNarrationJob(jobId, profileContext(profile), {textModel: body.textModel});
    await startTypeScriptNarration("create", jobId, inputFile, {textModel: body.textModel, accountId: profile.accountId, seriesId: profile.seriesId});
    inputFile = null;
    inputFile = null;
    return NextResponse.json({jobId, state: "drafting", contentProfile: profileContext(profile)}, {status: 202});
  } catch (error) {
    return NextResponse.json({jobId, error: error instanceof Error ? error.message : "创建任务失败"}, {status: 400});
  } finally {
    if (inputFile) await fs.unlink(inputFile).catch(() => undefined);
  }
}
