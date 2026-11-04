import {promises as fs} from "node:fs";
import path from "node:path";
import {NextResponse} from "next/server";
import {profilesRoot} from "@/lib/profile";
import {requireAuth} from "@/lib/auth";

export const runtime = "nodejs";
export async function GET(_request: Request, context: {params: Promise<{path: string[]}>}) {
  const unauthorized = await requireAuth(); if (unauthorized) return unauthorized;
  try {
    const parts = (await context.params).path;
    // 只服务品牌图片，不允许读取配置、提示词或符号链接指向的外部文件。
    if (parts.length < 3 || parts.some((p) => !/^[a-zA-Z0-9._-]+$/.test(p) || p.startsWith("."))) throw new Error("图片路径无效");
    const filename = parts.at(-1)!;
    const ext = path.extname(filename).toLowerCase();
    const types: Record<string, string> = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"};
    if (!types[ext]) throw new Error("图片类型无效");
    const root = await fs.realpath(profilesRoot());
    const file = await fs.realpath(path.join(root, ...parts));
    if (!file.startsWith(root + path.sep)) throw new Error("图片路径无效");
    return new Response(await fs.readFile(file), {headers: {"Content-Type": types[ext], "Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff"}});
  } catch {return NextResponse.json({error: "图片不存在"}, {status: 404});}
}
