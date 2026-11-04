import path from "node:path";
import {NextResponse} from "next/server";
import {requireAuth} from "@/lib/auth";
import {atomicWriteJson, jobDir, readJob, readJson} from "@/lib/jobs";
import {deliveryMetadataSchema} from "@/lib/delivery-metadata";
import {artifactManifestSchema} from "@/remotion/schema";

export const runtime = "nodejs";

export async function PUT(request: Request, context: {params: Promise<{id: string}>}) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const {id} = await context.params;
    const job = await readJob(id);
    const manifest = artifactManifestSchema.parse(await readJson(path.join(jobDir(id), "manifest.json")));
    const parsed = deliveryMetadataSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({error: parsed.error.issues[0]?.message ?? "发布信息无效"}, {status: 400});
    const deliveryMetadata = parsed.data;
    // 中文按 Unicode 字符计数；英文发布短标题沿用不限制长度的约定。
    if (job.contentProfile.outputLanguage !== "en-US" && manifest.contentProfile?.outputLanguage !== "en-US" && Array.from(deliveryMetadata.shortTitle).length > 16) {
      return NextResponse.json({error: "短标题不能超过 16 字"}, {status: 400});
    }
    await atomicWriteJson(path.join(jobDir(id), "delivery.json"), deliveryMetadata);
    return NextResponse.json({deliveryMetadata});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "保存发布信息失败"}, {status: 400});
  }
}
