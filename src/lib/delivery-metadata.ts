import {z} from "zod";

// 发布文案独立于渲染清单保存，交付时改字不影响已生成的画面和音频。
export const deliveryMetadataSchema = z.object({
  title: z.string().trim().min(1, "视频标题不能为空"),
  shortTitle: z.string().trim(),
  summary: z.string().trim(),
}).strict();

export type DeliveryMetadata = z.infer<typeof deliveryMetadataSchema>;
