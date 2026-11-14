import {promises as fs} from "node:fs";
import path from "node:path";
import {z} from "zod";
import {readPipelineSettings} from "../pipeline-settings";
import type {PlatformProfile} from "../profile";

const schema = z.object({enabled: z.boolean().default(false), imageModel: z.string().min(1).default("qwen-image-2.0-pro"), visionModel: z.string().min(1).default("qwen3-vl-plus"), timeoutMs: z.number().int().min(30000).max(1800000).default(900000), maxSteps: z.number().int().min(8).max(80).default(32), maxArtworks: z.number().int().min(1).max(8).default(4)});
// 复用根百炼连接，只在 worker 内解析凭据，不另建包级配置或向客户端返回密钥。
export const explainerSettings = async (profile?: PlatformProfile, credentials = false) => {
  const raw = JSON.parse(await fs.readFile(path.join(process.cwd(), "pipeline.config.json"), "utf8"));
  const config = schema.parse(raw.handdrawAgent ?? {});
  const existing = await readPipelineSettings(profile, {requireCredentials: credentials ? "text" : false});
  const bailian = raw.bailian ?? {};
  const workspace = String(process.env.TALK_VIDEO_BAILIAN_WORKSPACE_ID ?? bailian.workspace_id ?? "");
  const apiKey = String(process.env[String(bailian.api_key_env ?? "DASHSCOPE_API_KEY")] ?? "");
  const baseURL = String(bailian.base_http_api_url ?? "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1").replaceAll("{workspace_id}", workspace).replace(/\/$/u, "");
  if (credentials && (!apiKey || baseURL.includes("{workspace") || !baseURL.startsWith("https://") || !workspace || workspace === "YOUR_WORKSPACE_ID")) throw new Error("手绘讲解缺少有效的根百炼连接配置");
  return {...config, text: {model: existing.defaultTextModel, apiKey: existing.deepseek.apiKey, baseURL: existing.deepseek.baseUrl}, bailian: {apiKey, baseURL}};
};
