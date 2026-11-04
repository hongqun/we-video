import {NextResponse} from "next/server";
import {publicPlatformProfile, readPlatformProfile, readJobPlatformProfile, profileContext, builtinEnglishProfile} from "@/lib/profile";
import {requireAuth} from "@/lib/auth";
import {readJob, resolveArtifactValues, atomicWriteJson, jobDir} from "@/lib/jobs";
import {freezeCurrentProfile, hasProfileSnapshot} from "@/lib/profile-snapshot";
import {scanProfiles} from "@/lib/profile-store";
import {createRenderArtifactToken} from "@/lib/render-access";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const unauthorized = await requireAuth(); if (unauthorized) return unauthorized;
  try {
    const url = new URL(request.url); const jobId = url.searchParams.get("jobId");
    const job = jobId ? await readJob(jobId) : undefined;
    const needsMigration = Boolean(job && !await hasProfileSnapshot(job.jobId));
    const profile = job ? needsMigration ? await readPlatformProfile(job.contentProfile.accountId, job.contentProfile.seriesId) : await readJobPlatformProfile(job.contentProfile, job.jobId)
      : await readPlatformProfile(url.searchParams.get("accountId") || undefined, url.searchParams.get("seriesId") || undefined);
    const targets = job ? (await scanProfiles(profile.accountId)).flatMap((item) => item.profile?.kind === "derived" && !item.profile.archived && item.profile.sourceSeriesId === profile.seriesId && item.profile.outputLanguage === "en-US" ? [{seriesId: item.seriesId, title: item.profile.seriesTitle}] : []) : [];
    // 内置通用配置没有账号目录，单独加入可实际读取和派生的英文目标。
    if (job && profile.accountId === "builtin" && profile.seriesId === "general") {
      const target = builtinEnglishProfile();
      if (!targets.some((item) => item.seriesId === target.seriesId)) targets.unshift({seriesId: target.seriesId, title: target.seriesTitle});
    }
    const data = publicPlatformProfile(profile);
    // 与 Manifest 使用同一资源解析器，预览及离线渲染均读取任务内的图片副本。
    const resolved = job ? resolveArtifactValues(data, job.jobId, url.origin, createRenderArtifactToken(job.jobId)) : data;
    return NextResponse.json({...resolved, profileMigrationRequired: needsMigration, derivedTargets: targets});
  } catch (error) {return NextResponse.json({error: error instanceof Error ? error.message : "读取配置失败"}, {status: 400});}
}
export async function POST(request: Request) {
  const unauthorized = await requireAuth(); if (unauthorized) return unauthorized;
  try {
    const body = await request.json();
    if (body.confirm !== true || typeof body.jobId !== "string") throw new Error("请确认采用当前配置");
    const job = await readJob(body.jobId);
    if (["drafting", "synthesizing", "rendering", "translating", "segmenting_translation"].includes(job.state)) throw new Error("任务正在处理中，请结束后再采用当前配置");
    const adopted = await freezeCurrentProfile(job.jobId, job.contentProfile);
    // 明确采用当前版本后更新任务上下文，不将原先版本号冒充为历史配置快照。
    const latest = await readJob(job.jobId);
    await atomicWriteJson(`${jobDir(job.jobId)}/job.json`, {...latest, contentProfile: profileContext(adopted), profileAdoptedAt: new Date().toISOString()});
    return NextResponse.json({ok: true});
  } catch (e) {return NextResponse.json({error: e instanceof Error ? e.message : "固定配置失败"}, {status: 400});}
}
