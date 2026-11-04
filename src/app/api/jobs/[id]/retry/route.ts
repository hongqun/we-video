import {promises as fs} from "node:fs";
import {NextResponse} from "next/server";
import {startTypeScriptNarration, writeRequestFile} from "@/lib/processes";
import {readPipelineSettings} from "@/lib/pipeline-settings";
import {jobDir, readJob, readJson, initializeNarrationJob} from "@/lib/jobs";
import {requireAuth} from "@/lib/auth";
import {freezeProfile} from "@/lib/profile-snapshot";
import {profileContext} from "@/lib/profile";
import {readJobPlatformProfile} from "@/lib/profile";
import {newJobId} from "@/lib/job-id";

export const runtime = "nodejs";

type Source = {
  type?: "text" | "url" | "script";
  originalText?: string;
  url?: string;
  effectiveLanguage?: string;
  detectedLanguage?: string;
};

// 重试沿用已保存的原文入口和语言识别结果，避免重新依赖前端输入状态。

export async function POST(_request: Request, context: {params: Promise<{id: string}>}) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  let inputFile: string | null = null;
  try {
    const {id} = await context.params;
    const job = await readJob(id);
    if (job.state !== "failed") throw new Error("只有生成失败的任务可以重试");

    const source = await readJson<Source>(
      `${jobDir(id)}/source.json`,
    );
    const profile = await readJobPlatformProfile(job.contentProfile, job.jobId);
    const settings = await readPipelineSettings(profile, {requireCredentials: "text"});
    const generation = job.generation && typeof job.generation === "object" ? job.generation : {};
    const textModel = typeof generation.textModel === "string"
      ? generation.textModel
      : settings.defaultTextModel;
    if (!settings.textModels.includes(textModel as typeof settings.textModels[number])) {
      throw new Error("任务使用的文稿模型当前不可用");
    }

    const sourceLanguage = source.effectiveLanguage ?? source.detectedLanguage ?? "auto";
    const request = source.type === "url"
      ? {type: "url", url: source.url, sourceLanguage, textModel}
      : {type: source.type === "script" ? "script" : "text", text: source.originalText, sourceLanguage, textModel};
    if (request.type === "url" && !request.url) throw new Error("任务缺少原始网页链接");
    if ((request.type === "text" || request.type === "script") && (!request.text || request.text.length < 20)) {
      throw new Error("任务缺少足够的原始正文");
    }

    const retryJobId = newJobId();
    inputFile = await writeRequestFile(retryJobId, request);
    // 重试任务固定原任务的配置与素材副本，先初始化再交给 worker。
    await freezeProfile(retryJobId, profile, id);
    await initializeNarrationJob(retryJobId, profileContext(profile), {textModel});
    await startTypeScriptNarration("create", retryJobId, inputFile, {textModel, accountId: profile.accountId, seriesId: profile.seriesId});
    inputFile = null;
    return NextResponse.json({jobId: retryJobId, state: "drafting"}, {status: 202});
  } catch (error) {
    if (inputFile) await fs.unlink(inputFile).catch(() => undefined);
    return NextResponse.json({error: error instanceof Error ? error.message : "重新生成口播稿失败"}, {status: 400});
  }
}
