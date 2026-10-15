import {NextResponse} from "next/server";
import {readPipelineSettings} from "@/lib/pipeline-settings";
import {readJob} from "@/lib/jobs";
import {readJobPlatformProfile, readPlatformProfile} from "@/lib/profile";
import {requireAuth} from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    // 页面与 worker 读取同一任务专题；已保存的人工音色和语速单独返回。
    const query = new URL(request.url).searchParams;
    const job = query.get("jobId") ? await readJob(query.get("jobId")!) : undefined;
    const profile = job ? await readJobPlatformProfile(job.contentProfile)
      : await readPlatformProfile(query.get("accountId") || undefined, query.get("seriesId") || undefined);
    const settings = await readPipelineSettings(profile);
    return NextResponse.json({
      textModels: settings.textModels,
      defaultTextModel: settings.defaultTextModel,
      voices: settings.voices,
      defaultVoiceId: settings.defaultVoiceId,
      defaultRate: settings.tts.rate,
      generation: job?.generation,
    });
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "读取配置失败"}, {status: 500});
  }
}
