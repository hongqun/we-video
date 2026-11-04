import path from "node:path";
import {promises as fs} from "node:fs";
import {NextResponse} from "next/server";
import {jobDir, readJob, readJson, updateJobState} from "@/lib/jobs";
import {startRender} from "@/lib/processes";
import {requireAuth} from "@/lib/auth";
import {artifactManifestSchema} from "@/remotion/schema";

export const runtime = "nodejs";

export async function POST(request: Request, context: {params: Promise<{id: string}>}) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const {id} = await context.params;
    const job = await readJob(id);
    if (!new Set(["ready", "completed", "failed"]).has(job.state)) {
      throw new Error(`当前状态 ${job.state} 不能渲染`);
    }
    const directory = jobDir(id);
    const legacyManifestPath = path.join(directory, "manifest.json");
    const manifestPath = legacyManifestPath;
    const rawManifest = await readJson<unknown>(legacyManifestPath).catch(() => null);
    const manifest = rawManifest ? artifactManifestSchema.safeParse(rawManifest) : null;
    if (!manifest?.success || manifest.data.jobId !== id) {
      throw new Error("请先生产配音");
    }
    if (manifest.data.contentMode === "narration") {
      await fs.access(path.join(directory, "audio", "narration.wav")).catch(() => {
        throw new Error("请先生产配音");
      });
    }
    await updateJobState(id, {state: "rendering", error: null, renderProgress: 0});
    const renderOrigin = process.env.REMOTION_RENDER_ORIGIN?.trim() || new URL(request.url).origin;
    await startRender(id, manifestPath, renderOrigin);
    return NextResponse.json({jobId: id, state: "rendering"}, {status: 202});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "启动渲染失败"}, {status: 400});
  }
}
