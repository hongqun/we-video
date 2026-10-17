import {NextResponse} from "next/server";
import {z} from "zod";
import {requireAuth} from "@/lib/auth";
import {generateGlbModelPrompt} from "@/lib/glb-model-prompt";

export const runtime = "nodejs";
const inputSchema = z.object({segmentId: z.string().trim().min(1), spokenText: z.string(), includeNarration: z.boolean()}).strict();

// 只读取任务与专题模板，返回临时文本，不写规划或模型资源。
export async function POST(request: Request, context: {params: Promise<{id: string}>}) {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  try {
    const {id} = await context.params;
    const input = inputSchema.parse(await request.json());
    return NextResponse.json(await generateGlbModelPrompt(id, input.segmentId, input.spokenText, input.includeNarration));
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "读取 GLB 提示词失败"}, {status: 400});
  }
}
