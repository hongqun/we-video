import {promises as fs} from "node:fs";
import path from "node:path";
import {z} from "zod";
import {REPO_ROOT} from "./paths";
import {readPlatformProfile, profileTtsSchema, type PlatformProfile} from "./profile";

const settingsSchema = z.object({
  deepseek: z.object({
    models: z.array(z.enum(["deepseek-v4-flash", "deepseek-v4-pro"])).min(1),
    default_model: z.enum(["deepseek-v4-flash", "deepseek-v4-pro"]),
  }).refine((value) => value.models.includes(value.default_model), {message: "默认文稿模型不在列表中"}),
  bailian: z.object({
    // 模型清单是语音接入的唯一白名单，新增模型无需修改业务代码。
    models: z.array(z.string().min(1)).min(1),
    default_voice: z.string().min(1),
    voices: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string().min(1),
      // 同一配置可登记不同 CosyVoice 模型的音色，工作台只展示当前模型可用项。
      models: z.array(z.string().min(1)).min(1).optional(),
    })).min(1),
  }).refine((value) => value.voices.some((voice) => voice.id === value.default_voice), {message: "默认音色不在列表中"}),
});

export type PipelineSettings = {
  deepseek: {
    apiKey: string;
    baseUrl: string;
  };
  textModels: Array<"deepseek-v4-flash" | "deepseek-v4-pro">;
  defaultTextModel: "deepseek-v4-flash" | "deepseek-v4-pro";
  voices: Array<{id: string; name: string; description: string}>;
  defaultVoiceId: string;
  tts: {
    apiKey: string;
    websocketUrl: string;
    model: string;
    sampleRate: number;
    volume: number;
    rate: number;
    pitch: number;
    instruction: string;
    seed: number;
    languageHints: string[];
    pauseMs?: {short?: number; medium?: number; long?: number};
  };
};

export const readPipelineSettings = async (profile?: PlatformProfile): Promise<PipelineSettings> => {
  // 配置文件提供默认值，环境变量可覆盖模型和密钥，但不把密钥写入任务文件。
  const selectedProfile = profile ?? await readPlatformProfile();
  const configuredFile = process.env.TALK_VIDEO_PIPELINE_CONFIG?.trim();
  const file = configuredFile
    ? path.resolve(REPO_ROOT, configuredFile)
    : path.join(REPO_ROOT, "pipeline.config.json");
  const raw = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, Record<string, unknown>>;
  const textModels = process.env.TALK_VIDEO_TEXT_MODELS?.trim();
  const defaultTextModel = process.env.TALK_VIDEO_DEFAULT_TEXT_MODEL?.trim() || selectedProfile.defaultTextModel;
  const defaultVoice = selectedProfile.defaultVoiceId || process.env.TALK_VIDEO_DEFAULT_VOICE?.trim();
  const config = settingsSchema.parse({
    ...raw,
    deepseek: {
      ...raw.deepseek,
      ...(textModels ? {models: textModels.split(",").map((value) => value.trim()).filter(Boolean)} : {}),
      ...(defaultTextModel ? {default_model: defaultTextModel} : {}),
    },
    bailian: {
      ...raw.bailian,
      ...(defaultVoice ? {default_voice: defaultVoice} : {}),
    },
  });
  const bailian = raw.bailian ?? {};
  const deepseek = raw.deepseek ?? {};
  const deepseekApiKeyEnv = String(deepseek.api_key_env ?? "DEEPSEEK_API_KEY");
  const deepseekApiKey = String(process.env[deepseekApiKeyEnv] ?? "").trim();
  const workspaceId = String(process.env.TALK_VIDEO_BAILIAN_WORKSPACE_ID ?? bailian.workspace_id ?? "").trim();
  const apiKeyEnv = String(bailian.api_key_env ?? "DASHSCOPE_API_KEY");
  const apiKey = String(process.env[apiKeyEnv] ?? "").trim();
  const websocketTemplate = String(
    process.env.TALK_VIDEO_BAILIAN_WS_API_URL ??
      process.env.TALK_VIDEO_BAILIAN_WEBSOCKET_URL ??
      bailian.base_websocket_api_url ??
      "",
  ).trim();
  if (!apiKey) throw new Error(`环境变量 ${apiKeyEnv} 未设置`);
  if (!workspaceId || workspaceId === "YOUR_WORKSPACE_ID") throw new Error("百炼配置缺少真实 workspace_id");
  if (!websocketTemplate) throw new Error("百炼配置缺少 base_websocket_api_url");
  const websocketUrl = websocketTemplate.replaceAll("{workspace_id}", workspaceId);
  if (!websocketUrl.startsWith("wss://")) throw new Error("百炼 WebSocket 地址必须使用 WSS");
  const numericSetting = (envName: string, configName: string, fallback: number) => {
    const value = Number(process.env[envName] ?? bailian[configName] ?? fallback);
    if (!Number.isFinite(value)) throw new Error(`百炼配置 ${configName} 必须是数字`);
    return value;
  };
  const model = selectedProfile.tts?.model ?? String(process.env.TALK_VIDEO_TTS_MODEL ?? bailian.model ?? "");
  if (!config.bailian.models.includes(model)) throw new Error(`专题配置的 TTS 模型 ${model || "（空）"} 不在 pipeline.config.json 的 bailian.models 中`);
  // 专题覆盖全局声音参数；语言默认跟随任务输出语言，避免英文沿用全局中文提示。
  const voiceSettings = profileTtsSchema.parse({
    rate: numericSetting("TALK_VIDEO_TTS_RATE", "rate", 0.95),
    pitch: numericSetting("TALK_VIDEO_TTS_PITCH", "pitch", 1),
    volume: numericSetting("TALK_VIDEO_TTS_VOLUME", "volume", 50),
    instruction: String(process.env.TALK_VIDEO_TTS_INSTRUCTION ?? bailian.instruction ?? ""),
    seed: numericSetting("TALK_VIDEO_TTS_SEED", "seed", 0),
    languageHints: selectedProfile.outputLanguage
      ? [selectedProfile.outputLanguage === "en-US" ? "en" : "zh"]
      : (bailian.language_hints ?? ["zh"]),
    ...selectedProfile.tts,
  });
  const availableVoices = config.bailian.voices.filter((voice) => !voice.models || voice.models.includes(model));
  if (!availableVoices.some((voice) => voice.id === config.bailian.default_voice)) throw new Error(`模型 ${model} 没有配置默认音色 ${config.bailian.default_voice}`);
  return {
    deepseek: {
      apiKey: deepseekApiKey,
      baseUrl: String(process.env.TALK_VIDEO_DEEPSEEK_BASE_URL ?? deepseek.base_url ?? "https://api.deepseek.com").replace(/\/$/, ""),
    },
    textModels: config.deepseek.models,
    defaultTextModel: config.deepseek.default_model,
    voices: availableVoices,
    defaultVoiceId: config.bailian.default_voice,
    tts: {
      apiKey,
      websocketUrl,
      model,
      sampleRate: numericSetting("TALK_VIDEO_TTS_SAMPLE_RATE", "sample_rate", 24000),
      volume: voiceSettings.volume!,
      rate: voiceSettings.rate!,
      pitch: voiceSettings.pitch!,
      instruction: voiceSettings.instruction!,
      seed: voiceSettings.seed!,
      languageHints: voiceSettings.languageHints!,
      pauseMs: voiceSettings.pauseMs,
    },
  };
};
