import {NextResponse} from "next/server";
import {requireAuth} from "@/lib/auth";
import {changeHanddrawImage, handdrawPrompts, readHanddrawResources, startHanddraw} from "@/lib/handdraw";
import {readVisualResources} from "@/lib/visual-resources";

export const runtime = "nodejs";
type Context = {params: Promise<{id: string; sceneId: string}>};
const failure = (error: unknown) => NextResponse.json({error: error instanceof Error ? error.message : "手绘资源操作失败"}, {status: 400});
const parseKind = (kind: unknown): "lineart" | "color" => {
  if (kind !== "lineart" && kind !== "color") throw new Error("图片类型必须是 lineart 或 color");
  return kind;
};

// 手绘资源始终以已保存的镜头为边界，复用任务附件的登录和签名访问机制。
export async function GET(request: Request, context: Context) {
  const unauthorized = await requireAuth(); if (unauthorized) return unauthorized;
  try {
    const {id, sceneId} = await context.params;
    if (new URL(request.url).searchParams.has("prompts")) return NextResponse.json(await handdrawPrompts(id, sceneId));
    return NextResponse.json({resources: await readHanddrawResources(id, sceneId)});
  } catch (error) {return failure(error);}
}
export async function POST(request: Request, context: Context) {
  const unauthorized = await requireAuth(); if (unauthorized) return unauthorized;
  try {
    const {id, sceneId} = await context.params;
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData(); const file = form.get("image");
      if (!(file instanceof File)) throw new Error("请选择图片文件");
      return NextResponse.json({resources: await changeHanddrawImage(id, sceneId, parseKind(form.get("kind")), file)});
    }
    const resource = (await readVisualResources(id)).resources.find((item) => item.sceneId === sceneId)?.handdraw;
    if (!resource?.lineart || !resource.color) throw new Error("请先上传线稿和上色图");
    await startHanddraw(id, sceneId);
    return NextResponse.json({resources: await readVisualResources(id)}, {status: 202});
  } catch (error) {return failure(error);}
}
export async function DELETE(request: Request, context: Context) {
  const unauthorized = await requireAuth(); if (unauthorized) return unauthorized;
  try {
    const {id, sceneId} = await context.params;
    const body = await request.json() as {kind?: unknown};
    return NextResponse.json({resources: await changeHanddrawImage(id, sceneId, parseKind(body.kind))});
  } catch (error) {return failure(error);}
}
