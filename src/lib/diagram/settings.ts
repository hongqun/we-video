import {promises as fs} from "node:fs";
import path from "node:path";
import {z} from "zod";
import {readPipelineSettings} from "../pipeline-settings";
import type {PlatformProfile} from "../profile";

// 密钥只在 worker 内解析，绝不序列化进任务、日志或会话。
// 只有模型支持图像输入时才把检查截图送入模型；默认文本模型使用几何报告。
// 思考模式由根配置显式开启，兼容未提供该字段的历史配置。
// 保存预算独立于模型/工具步数，包含首次提交，避免修复次数散落硬编码。
const schema = z.object({supportsVision: z.boolean().default(false), thinking: z.boolean().default(false), enabled: z.boolean().default(false), model: z.string().optional(), timeoutMs: z.number().int().min(10000).max(900000).default(180000), maxSteps: z.number().int().min(6).max(100).default(36), maxSaves: z.number().int().min(1).max(10).default(5), maxTokens: z.number().int().min(1024).max(32000).default(12000)});
export const diagramSettings = async (profile?: PlatformProfile, credentials = false) => {
  const raw = JSON.parse(await fs.readFile(path.join(process.cwd(), "pipeline.config.json"), "utf8"));
  const config = schema.parse(raw.diagramAgent ?? {});
  const existing = await readPipelineSettings(profile, {requireCredentials: credentials ? "text" : false});
  return {...config, model: config.model ?? existing.defaultTextModel, baseURL: existing.deepseek.baseUrl, apiKey: existing.deepseek.apiKey};
};
