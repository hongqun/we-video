import {promises as fs} from "node:fs";
import {randomInt} from "node:crypto";
import path from "node:path";
import {z} from "zod";
import {DATA_ROOT} from "@/lib/paths";
import {clampParameters, createMathSummary, ensureMathSummaryTags, formulaCatalog, formulaCatalogList, formulaSignature, mathFormulaIdSchema, type MathFormulaId, type MathFormulaParameters} from "./formulas";
import {MATH_BODY_DURATION_MS} from "./duration";
import {MATH_MUSIC_DEFAULT_SRC} from "./music";

export const mathResolutionSchema = z.enum(["1080x1260", "1080x1920"]);
export type MathResolution = z.infer<typeof mathResolutionSchema>;

export const mathDraftSchema = z.object({
  schemaVersion: z.literal("1.0"),
  contentMode: z.literal("math"),
  language: z.object({sourceLanguage: z.literal("zh"), outputLanguage: z.literal("zh-CN")}),
  scenes: z.array(z.unknown()),
  title: z.string().min(1),
  summary: z.string().min(1),
  resolution: mathResolutionSchema.optional(),
  formulaId: mathFormulaIdSchema,
  formulaLatex: z.string().min(1),
  parameters: z.record(z.string(), z.number()),
  plot: z.object({xMin: z.number(), xMax: z.number(), yMin: z.number(), yMax: z.number(), drawDurationMs: z.number().int().min(8000).max(30000)}),
  musicSrc: z.string().min(1),
});
export type MathDraft = z.infer<typeof mathDraftSchema>;

export type MathHistoryEntry = MathDraft & {signature: string; createdAt: string};

const historyPath = (accountId: string, seriesId: string) => path.join(DATA_ROOT, "math-history", `${accountId}__${seriesId}.json`);

export const readMathHistory = async (accountId: string, seriesId: string): Promise<MathHistoryEntry[]> => {
  try {
    const value = JSON.parse(await fs.readFile(historyPath(accountId, seriesId), "utf8"));
    return Array.isArray(value) ? value as MathHistoryEntry[] : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};

const writeMathHistory = async (accountId: string, seriesId: string, entries: MathHistoryEntry[]) => {
  const target = historyPath(accountId, seriesId);
  await fs.mkdir(path.dirname(target), {recursive: true});
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
};

export const chooseFormula = (instruction: string, history: MathHistoryEntry[], requested?: MathFormulaId | "auto"): MathFormulaId => {
  if (requested && requested !== "auto") return requested;
  const text = instruction.toLowerCase();
  const aliases: Array<[MathFormulaId, string[]]> = [
    ["double-heart", ["双重心形", "双心", "double heart", "double-heart"]],
    ["cardioid", ["心形", "cardioid"]], ["butterfly", ["蝴蝶", "butterfly", "fay"]], ["rose", ["玫瑰", "rose"]],
    ["limacon", ["帕斯卡", "蜗线", "limacon"]], ["trifolium", ["三叶", "trifolium"]], ["quadrifolium", ["四叶", "quadrifolium"]],
    ["lemniscate", ["伯努利", "双连线", "lemniscate"]], ["cannabis", ["大麻叶", "cannabis"]], ["chrysanthemum", ["菊花", "chrysanthemum"]], ["sunflower", ["太阳花", "sunflower"]],
    ["astroid", ["星形线", "astroid"]], ["nephroid", ["肾形线", "nephroid"]], ["deltoid", ["戴尔特", "三角内摆线", "deltoid"]],
    ["epitrochoid", ["外旋轮", "epitrochoid"]], ["hypotrochoid", ["内旋轮", "hypotrochoid"]], ["cycloid", ["平摆线", "cycloid"]],
    ["involute", ["渐开线", "involute"]], ["tractrix", ["曳物线", "tractrix"]], ["pentaspoid", ["五角内摆线", "pentaspoid"]], ["gear", ["齿轮", "gear"]],
    ["lissajous", ["利萨如", "lissajous"]], ["sine", ["正弦", "sine"]], ["polar", ["极坐标", "花瓣", "组合", "复杂"]],
  ];
  const matched = [...aliases, ...formulaCatalogList.map((definition) => [definition.id, [definition.name.toLowerCase()]] as [MathFormulaId, string[]])]
    .find(([, terms]) => terms.some((term) => text.includes(term)));
  if (matched) return matched[0];
  const counts = new Map<MathFormulaId, number>();
  for (const item of history) counts.set(item.formulaId, (counts.get(item.formulaId) ?? 0) + 1);
  const ordered = formulaCatalogList.filter((item) => item.id !== "sine").sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0));
  const recentIds = new Set(history.slice(0, 3).map((item) => item.formulaId));
  const alternatives = ordered.filter((item) => !recentIds.has(item.id));
  const candidates = alternatives.length ? alternatives : ordered;
  const lowest = candidates.filter((item) => (counts.get(item.id) ?? 0) === (counts.get(candidates[0].id) ?? 0));
  return lowest[randomInt(lowest.length)]?.id ?? "polar";
};

const createParameters = (id: MathFormulaId, instruction: string) => {
  const definition = formulaCatalog[id];
  const parameters = {...definition.parameterDefaults};
  if (/慢|缓/.test(instruction)) {
    if ("frequency" in parameters) parameters.frequency = Math.max(0.5, parameters.frequency * 0.75);
    if ("b" in parameters) parameters.b = Math.max(1, parameters.b - 1);
  }
  if (/复杂|密集|冲击/.test(instruction)) {
    if ("b" in parameters) parameters.b = Math.min(definition.parameterRanges.b.max, parameters.b + 2);
    if ("petals" in parameters) parameters.petals = Math.min(definition.parameterRanges.petals.max, parameters.petals + 1);
  }
  return clampParameters(definition, parameters);
};

const modelParameters = async (id: MathFormulaId, instruction: string, history: MathHistoryEntry[]) => {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return null;
  const definition = formulaCatalog[id];
  const endpoint = `${(process.env.TALK_VIDEO_DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/$/, "")}/chat/completions`;
  const prompt = [
    "你是数学动画公式参数设计器。目标是生成兼具数学美感、结构辨识度和工程可实现性的复杂曲线动画。玫瑰线、利萨如曲线、极坐标花瓣曲线只是目录中的不同示例，不是固定首选；必须结合近期历史换用不同的公式结构。",
    "去重按公式结构判断，不按参数判断。同一个公式只更换频率比、相位、振幅、花瓣数或其他参数，仍是同一种公式，不能算新公式；例如 Lissajous 2:3 与 Lissajous 3:4 不能当作两种公式。只能使用给定的公式 ID、LaTeX 和参数，不能发明公式、修改 LaTeX 或添加目录外函数。",
    `公式 ID：${id}`,
    `公式：${definition.latex}`,
    `参数默认值：${JSON.stringify(definition.parameterDefaults)}`,
    `参数范围：${JSON.stringify(definition.parameterRanges)}`,
    `用户微调要求：${instruction || "无；保持经典、优雅、具有明显结构且可稳定绘制的复杂曲线参数，并避开近期已用类型"}`,
    `近期历史签名：${history.slice(0, 12).map((item) => item.signature).join("、") || "无"}`,
    "近期已经使用过的公式结构处于冷却期，不得通过改变参数提前复用；只有没有其他候选结构时才允许复用最久未使用的结构。禁止把单独正弦波、余弦波、直线、圆等基础图形作为最终结果。参数优先使用整数或简单有理数频率比，保持适中复杂度、连续轨迹和良好画面占比；不要只靠高频制造噪点。只返回 JSON：{parameters:{...},title:string}。动画时长由系统固定，不要生成 drawDurationMs。不要生成公式历史、人物经历或其他事实性介绍；公式介绍由系统目录提供。",
  ].join("\n");
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {"Content-Type": "application/json", Authorization: `Bearer ${apiKey}`},
      body: JSON.stringify({model: process.env.TALK_VIDEO_DEFAULT_TEXT_MODEL?.trim() || "deepseek-v4-flash", messages: [{role: "system", content: "严格输出 JSON，不要解释。"}, {role: "user", content: prompt}], response_format: {type: "json_object"}, stream: false}),
    });
    if (!response.ok) return null;
    const payload = await response.json() as {choices?: Array<{message?: {content?: string}}>};
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;
    const value = JSON.parse(content) as {parameters?: Record<string, number>; title?: string; summary?: string};
    return {
      parameters: clampParameters(definition, value.parameters ?? {}),
      title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : undefined,
      summary: typeof value.summary === "string" && value.summary.trim() ? value.summary.trim() : undefined,
    };
  } catch {
    return null;
  }
};

export const createMathDraft = async (
  accountId: string,
  seriesId: string,
  instruction = "",
  requestedFormula?: MathFormulaId | "auto",
  resolution: MathResolution = "1080x1260",
) => {
  const history = await readMathHistory(accountId, seriesId);
  const id = chooseFormula(instruction, history, requestedFormula);
  const definition = formulaCatalog[id];
  const generated = await modelParameters(id, instruction, history);
  let parameters: MathFormulaParameters = generated?.parameters ?? createParameters(id, instruction);
  let signature = formulaSignature(id, parameters);
  const same = new Set(history.map((item) => item.signature));
  if (same.has(signature)) {
    for (const candidate of formulaCatalogList.filter((item) => item.id !== "sine")) {
      const candidateParams = clampParameters(candidate, {...candidate.parameterDefaults, ...(candidate.id === id ? {frequency: (candidate.parameterDefaults.frequency ?? 1) + 0.5} : {})});
      const candidateSignature = formulaSignature(candidate.id, candidateParams);
      if (!same.has(candidateSignature)) { parameters = candidateParams; signature = candidateSignature; break; }
    }
  }
  const draft: MathDraft = mathDraftSchema.parse({
    schemaVersion: "1.0",
    contentMode: "math",
    language: {sourceLanguage: "zh", outputLanguage: "zh-CN"},
    scenes: [],
    title: definition.name,
    summary: ensureMathSummaryTags(createMathSummary(definition), definition),
    resolution,
    formulaId: id,
    formulaLatex: definition.latex,
    parameters,
    plot: {...definition.plot, drawDurationMs: MATH_BODY_DURATION_MS},
    musicSrc: MATH_MUSIC_DEFAULT_SRC,
  });
  await writeMathHistory(accountId, seriesId, [{...draft, signature, createdAt: new Date().toISOString()}, ...history.filter((item) => item.signature !== signature)].slice(0, 100));
  return draft;
};

export const removeMathHistory = async (accountId: string, seriesId: string, signature?: string) => {
  const history = await readMathHistory(accountId, seriesId);
  await writeMathHistory(accountId, seriesId, signature ? history.filter((item) => item.signature !== signature) : []);
};
