import {NextResponse} from "next/server";
import {requireAuth} from "@/lib/auth";
import {activeOverrides, profileEditorData, scanProfiles, saveProfile, uploadProfileAsset, ProfileStoreError} from "@/lib/profile-store";

export const runtime = "nodejs";
export async function GET() {
  const unauthorized = await requireAuth(); if (unauthorized) return unauthorized;
  try {
    const scanned = await scanProfiles();
    const profiles = await Promise.all(scanned.map(async (item) => {
      try {return item.profile ? {accountId: item.accountId, seriesId: item.seriesId, data: await profileEditorData(item.profile)} : item;}
      catch (e) {return {accountId: item.accountId, seriesId: item.seriesId, error: e instanceof Error ? e.message : "读取失败"};}
    }));
    return NextResponse.json({profiles, overrides: activeOverrides()});
  } catch (e) {return failure(e);}
}
export async function POST(request: Request) {
  const unauthorized = await requireAuth(); if (unauthorized) return unauthorized;
  try {
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      // 请求体上限在读入前检查，图片解码后还会验证真实格式与像素数。
      if (Number(request.headers.get("content-length") ?? 0) > 11 * 1024 * 1024) throw new ProfileStoreError("图片不能超过 10MB", 413);
      const form = await request.formData(); const file = form.get("file");
      if (!(file instanceof File)) throw new ProfileStoreError("请选择图片");
      return NextResponse.json(await uploadProfileAsset(String(form.get("accountId")), String(form.get("kind")), String(form.get("accountVersion")), file));
    }
    return NextResponse.json({profile: await saveProfile(await request.json())});
  } catch (e) {return failure(e);}
}
const failure = (e: unknown) => NextResponse.json({error: e instanceof Error ? e.message : "配置操作失败"}, {status: e instanceof ProfileStoreError ? e.status : 400});
