import {z} from "zod";
// 注意：remotion 渲染打包（rspack）不解析 tsconfig 的 @/ 别名，此处必须用相对路径。
import {TRANSITION_KINDS} from "../lib/scene-transitions";
import {mathManifestSchema, type MathRenderManifest} from "./math-schema";
import {PRESENTER_FRAMINGS, PRESENTER_GESTURE_DIRECTIONS, PRESENTER_PLACEMENTS, PRESENTER_SAFE_SIDES} from "./presenter-config";
import {VISUAL_STYLE_IDS} from "./visual-style";

// 转场 kind 枚举：单一来源在 lib/scene-transitions.ts，schema 与渲染端共用。
export const transitionKindSchema = z.enum(TRANSITION_KINDS);
export const transitionSchema = z.union([
  z.object({kind: z.literal("none"), durationMs: z.literal(0)}).strict(),
  z.object({kind: transitionKindSchema.exclude(["none"]), durationMs: z.number().int().min(240).max(360)}).strict(),
]);

export const captionSchema = z.object({
  text: z.string().min(1),
  startMs: z.number().nonnegative(),
  endMs: z.number().positive(),
  timestampMs: z.number().nullable(),
  confidence: z.number().nullable(),
});

export const captionStyleSchema = z.enum(["narration", "clean", "impact"]);
export const visualStyleSchema = z.enum(VISUAL_STYLE_IDS);
export const rollTypeSchema = z.enum(["a-roll", "b-roll"]);
export const presenterModeSchema = z.enum(["hero", "companion", "hidden"]);
export const presenterPoseIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/);
export const presenterPlacementSchema = z.enum(PRESENTER_PLACEMENTS);
export const presenterFramingSchema = z.enum(PRESENTER_FRAMINGS);
// 封面只保存可编辑文案和人物姿势，布局仍由 CoverOpening 统一控制。
export const coverSchema = z.object({
  title: z.string().trim().min(1).max(40),
  subtitle: z.string().trim().max(120),
  keywords: z.array(z.string().trim().min(1).max(24)).max(8),
  presenterPoseId: presenterPoseIdSchema,
  imagePath: z.string().trim().min(1).optional(),
  imageWidth: z.number().int().positive().optional(),
  imageHeight: z.number().int().positive().optional(),
}).strict().superRefine((cover, context) => {
  const imageFields = [cover.imagePath, cover.imageWidth, cover.imageHeight].filter((value) => value !== undefined).length;
  if (imageFields !== 0 && imageFields !== 3) context.addIssue({code: "custom", path: ["imagePath"], message: "封面图片路径与真实尺寸必须同时保存"});
});
export const visualPlanContentSchema = z.object({
  // 第四步不限制镜头文案长度；仅保留非空和关键词数量约束。
  title: z.string().trim().min(1),
  subtitle: z.string(),
  text: z.string(),
  keywords: z.array(z.string().trim().min(1)),
  // 画面重点词与口播触发词独立保存；关键词只用于下方标签。
  emphasisBindings: z.array(z.object({text: z.string().trim().min(1), cueText: z.string().trim().min(1)}).strict()).optional(),
}).strict();

export const sceneSchema = z.object({
  id: z.string().min(1),
  segmentId: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  speechStartMs: z.number().int().nonnegative().optional(),
  speechEndMs: z.number().int().positive().optional(),
  pauseAfterMs: z.number().int().min(0).max(700).optional(),
  // This is manifest data, not a CSS transition.
  // eslint-disable-next-line @remotion/non-pure-animation
  transition: transitionSchema,
  spokenText: z.string(),
  // Manifest 只保留通用文字和模板 ID；模板专用数据仅在确认时临时装配。
  content: visualPlanContentSchema,
  templateId: z.string().min(1),
  templateData: z.record(z.string(), z.unknown()).optional(),
  // 首尾主讲与中段陪伴都是画面层数据，不参与口播时间轴推导。
  rollType: rollTypeSchema,
  presenterMode: presenterModeSchema,
  presenterPoseId: presenterPoseIdSchema,
  presenterPlacement: presenterPlacementSchema,
  presenterFraming: presenterFramingSchema.optional(),
}).strict();

const logoAssetSchema = z.object({
  brandId: z.string().min(1),
  label: z.string().min(1),
  src: z.string().optional(),
  source: z.enum(["official", "simple-icons", "github", "favicon", "fallback"]).optional(),
  status: z.enum(["resolved", "fallback", "missing"]).optional(),
  sourceUrl: z.string().url().optional(),
  resolvedUrl: z.string().url().optional(),
  license: z.string().optional(),
});
const mapAssetSchema = z.object({
  id: z.string().min(1),
  source: z.literal("bundled"),
  status: z.enum(["resolved", "missing"]),
});

export const renderManifestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  contentMode: z.literal("narration").default("narration"),
  jobId: z.string().min(1),
  // 单数据任务不再具有可选历史版本，恒为 1 仅兼容现有 Player props。
  revision: z.number().int().positive().default(1),
  contentProfile: z.object({
    accountId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
    seriesId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
    accountVersion: z.string().min(1),
    seriesVersion: z.string().min(1),
    outputLanguage: z.enum(["zh-CN", "en-US"]).optional(),
  }).optional(),
  title: z.string().min(1),
  // 新任务显式保存全片风格；历史 Manifest 缺失时由渲染端保持旧漫画风格。
  visualStyle: visualStyleSchema.optional(),
  // 短标题用于发布交付信息；历史 Manifest 可继续省略。
  shortTitle: z.string().trim().min(1).optional(),
  // 封面配置属于当前任务的视觉规划；渲染端可为缺失字段回退。
  cover: coverSchema.optional(),
  summary: z.string().trim().min(1).optional(),
  captionStyle: captionStyleSchema.default("narration"),
  video: z.object({
    width: z.literal(1080),
    height: z.literal(1260),
    fps: z.literal(30),
    outroDurationMs: z.literal(3000),
  }),
  narration: z.object({
    text: z.string().min(1),
    audioSrc: z.string(),
    spokenDurationMs: z.number().int().positive().optional(),
    durationMs: z.number().int().positive(),
    model: z.string(),
    voice: z.string(),
  }),
  captions: z.array(captionSchema).min(1),
  scenes: z.array(sceneSchema).min(1),
  brand: z.object({
    logoSrc: z.string().min(1),
    title: z.string().min(1),
    subtitle: z.string().min(1),
    // 固定品牌片尾的可选文案；历史 Manifest 缺失时由片尾组件回退到旧中文文案。
    outro: z.object({title: z.string().min(1), subtitle: z.string().min(1), prompt: z.string().min(1)}).strict().optional(),
    label: z.string().min(1).optional(),
    downloadPrefix: z.string().min(1).optional(),
  }),
  presenter: z.object({
    poses: z.array(z.object({
      id: presenterPoseIdSchema,
      // 历史 Manifest 没有 label，渲染仍可读取；新任务由账号配置写入。
      label: z.string().trim().min(1).optional(),
      src: z.string().min(1),
      semanticTags: z.array(z.string().trim().min(1)).min(1),
      gestureDirection: z.enum(PRESENTER_GESTURE_DIRECTIONS),
      safeSide: z.enum(PRESENTER_SAFE_SIDES),
    }).strict()).min(1),
  }).strict().optional(),
  media: z.object({logos: z.array(logoAssetSchema).default([]), maps: z.array(mapAssetSchema).default([])}).optional(),
}).superRefine((manifest, context) => {
  // 中文短标题保留 16 个 Unicode 字符限制；英文派生视频不做标题长度检测。
  if (manifest.contentProfile?.outputLanguage !== "en-US" && manifest.shortTitle && Array.from(manifest.shortTitle).length > 16) {
    context.addIssue({code: "too_big", maximum: 16, inclusive: true, origin: "string", path: ["shortTitle"], message: "Too big: expected string to have <=16 characters"});
  }
  if (manifest.scenes[0]?.startMs !== 0) {
    context.addIssue({code: "custom", path: ["scenes", 0, "startMs"], message: "首个场景必须从 0ms 开始"});
  }
  manifest.scenes.forEach((scene, index) => {
    if (scene.endMs <= scene.startMs) {
      context.addIssue({code: "custom", path: ["scenes", index, "endMs"], message: "场景时长无效"});
    }
    if (index > 0 && scene.startMs !== manifest.scenes[index - 1].endMs) {
      context.addIssue({code: "custom", path: ["scenes", index, "startMs"], message: "场景时间轴必须连续"});
    }
    if ((scene.speechStartMs === undefined) !== (scene.speechEndMs === undefined)) {
      context.addIssue({code: "custom", path: ["scenes", index], message: "口播区间字段不完整"});
    }
    if (
      scene.speechStartMs !== undefined && scene.speechEndMs !== undefined &&
      !(scene.startMs <= scene.speechStartMs && scene.speechStartMs < scene.speechEndMs && scene.speechEndMs <= scene.endMs)
    ) {
      context.addIssue({code: "custom", path: ["scenes", index], message: "口播区间无效"});
    }
    const rhythmFields = [scene.speechStartMs, scene.speechEndMs, scene.pauseAfterMs, scene.transition];
    if (rhythmFields.some((value) => value !== undefined) && rhythmFields.some((value) => value === undefined)) {
      context.addIssue({code: "custom", path: ["scenes", index], message: "动态节奏字段不完整"});
    }
    if (scene.speechEndMs !== undefined && scene.pauseAfterMs !== undefined) {
      const boundaryEnd = manifest.scenes[index + 1]?.speechStartMs ?? manifest.narration.durationMs;
      if (boundaryEnd !== scene.speechEndMs + scene.pauseAfterMs) {
        context.addIssue({code: "custom", path: ["scenes", index, "pauseAfterMs"], message: "停顿与口播时间轴不一致"});
      }
    }
  });
  const rhythmicScenes = manifest.scenes.filter(
    (scene) => scene.speechStartMs !== undefined && scene.speechEndMs !== undefined,
  );
  if (rhythmicScenes.length === manifest.scenes.length && manifest.narration.spokenDurationMs !== undefined) {
    const sceneSpeechDuration = rhythmicScenes.reduce(
      (total, scene) => total + scene.speechEndMs! - scene.speechStartMs!,
      0,
    );
    if (Math.abs(sceneSpeechDuration - manifest.narration.spokenDurationMs) > manifest.scenes.length + 2) {
      context.addIssue({code: "custom", path: ["narration", "spokenDurationMs"], message: "纯口播时长与场景不一致"});
    }
    manifest.captions.forEach((caption, captionIndex) => {
      const insideSpeech = rhythmicScenes.some(
        (scene) => caption.startMs >= scene.speechStartMs! && caption.endMs <= scene.speechEndMs!,
      );
      if (!insideSpeech) {
        context.addIssue({code: "custom", path: ["captions", captionIndex], message: "字幕不能出现在场景停顿中"});
      }
    });
  }
  const finalScene = manifest.scenes.at(-1);
  if (finalScene && Math.abs(finalScene.endMs - manifest.narration.durationMs) > 80) {
    context.addIssue({code: "custom", path: ["scenes"], message: "场景必须覆盖完整口播"});
  }
  const finalCaption = manifest.captions.at(-1);
  if (finalCaption && finalCaption.endMs > manifest.narration.durationMs + 80) {
    context.addIssue({code: "custom", path: ["captions"], message: "字幕超出音频时长"});
  }
});

export type RenderManifest = z.infer<typeof renderManifestSchema>;
export type CoverConfig = z.infer<typeof coverSchema>;
export type VideoScene = z.infer<typeof sceneSchema>;
export type Caption = z.infer<typeof captionSchema>;
export type CaptionStyle = z.infer<typeof captionStyleSchema>;
export type VisualStyle = z.infer<typeof visualStyleSchema>;
export const artifactManifestSchema = z.union([renderManifestSchema, mathManifestSchema]);
export type ArtifactManifest = RenderManifest | MathRenderManifest;
