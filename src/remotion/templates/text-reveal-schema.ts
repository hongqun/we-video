import {z} from "zod";

// 按镜头保存音效选择；未配置的任务默认开启，预览与成片共用该约定。
export const textRevealSettingsSchema = z.object({typingSound: z.boolean().optional()}).strict();
export const textRevealSoundEnabled = (value: unknown) => value !== false;
