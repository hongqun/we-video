import type {VideoScene} from "../schema";
import type {PresenterFraming, PresenterPlacement} from "../presenter-config";
import {visualImageDataSchema} from "./visual-image";
import {relationGraphDataSchema} from "./relation-graph-schema";

export type TemplateCategory = "presenter" | "text" | "content" | "media";
export type TemplatePresentationMode = "standard" | "immersive" | "visual-first";
export type SupportingTextPlacement = "header" | "content" | "hidden";
export type TitleMotion = "reveal" | "typewriter";
export type TemplateRenderer = "opening-stage" | "closing-stage" | "text-reveal" | "visual-image" | "text-highlight" | "generic-content" | "relation-graph";

export type TemplateDefinition = {
  id: string;
  label: string;
  description: string;
  category: TemplateCategory;
  requiresMedia: boolean;
  resourceType?: "image";
  renderer: TemplateRenderer;
  minDurationMs: number;
  fields: string[];
  adapted: boolean;
  availableProfiles?: Array<{accountId: string; seriesId: string}>;
  presentationMode: TemplatePresentationMode;
  supportingTextPlacement: SupportingTextPlacement;
  titleMotion: TitleMotion;
  rollRole: "a-roll" | "b-roll";
  companionPlacements: Exclude<PresenterPlacement, "hero">[];
  companionFraming: PresenterFraming;
};

const bRollDefaults = {adapted: true, rollRole: "b-roll" as const, companionPlacements: ["right-lower", "left-lower", "right-mid", "left-mid"] as Exclude<PresenterPlacement, "hero">[], companionFraming: "waist" as const};

// 注册表只保留当前产品允许选择的模板；模板能力不再绑定场景分类。
export const templateRegistry: TemplateDefinition[] = [
  {id: "ip/opening-stage", label: "IP 动态开场舞台", description: "默认首镜头，可按需替换。", category: "presenter", requiresMedia: false, renderer: "opening-stage", minDurationMs: 1800, fields: [], adapted: true, presentationMode: "immersive", supportingTextPlacement: "hidden", titleMotion: "reveal", rollRole: "a-roll", companionPlacements: [], companionFraming: "full"},
  {id: "rve/text-reveal", label: "揭示文字", description: "逐步揭示核心文字。", category: "text", requiresMedia: false, renderer: "text-reveal", minDurationMs: 1800, fields: [], presentationMode: "immersive", supportingTextPlacement: "hidden", titleMotion: "reveal", ...bRollDefaults},
  {id: "rve/visual-image", label: "视觉要求图片", description: "按口播时间揭示人工审核配图。", category: "media", requiresMedia: true, resourceType: "image", renderer: "visual-image", minDurationMs: 1800, fields: [], presentationMode: "visual-first", supportingTextPlacement: "hidden", titleMotion: "reveal", ...bRollDefaults},
  {id: "rve/text-highlight", label: "文字重点标注", description: "按口播锚点依次高亮关键词。", category: "content", requiresMedia: false, renderer: "text-highlight", minDurationMs: 2200, fields: [], presentationMode: "standard", supportingTextPlacement: "hidden", titleMotion: "reveal", ...bRollDefaults},
  {id: "rve/generic-content", label: "通用内容卡", description: "承载主标题、副标题、正文和关键词。", category: "content", requiresMedia: false, renderer: "generic-content", minDurationMs: 1800, fields: [], presentationMode: "standard", supportingTextPlacement: "header", titleMotion: "reveal", ...bRollDefaults},
  {id: "rve/relation-graph", label: "关系图", description: "拖拽节点并按口播关键词逐步呈现关系。", category: "content", requiresMedia: false, renderer: "relation-graph", minDurationMs: 1800, fields: [], presentationMode: "visual-first", supportingTextPlacement: "hidden", titleMotion: "reveal", ...bRollDefaults},
  {id: "ip/closing-stage", label: "IP 动态结论舞台", description: "固定尾镜头。", category: "presenter", requiresMedia: false, renderer: "closing-stage", minDurationMs: 1800, fields: [], adapted: true, presentationMode: "immersive", supportingTextPlacement: "hidden", titleMotion: "reveal", rollRole: "a-roll", companionPlacements: [], companionFraming: "full"},
];
export const SUPPORTED_TEMPLATE_IDS = new Set(templateRegistry.map((item) => item.id));
export const templateById = new Map(templateRegistry.map((item) => [item.id, item]));

export const isTemplateAvailableForProfile = (definition: TemplateDefinition, profile?: {accountId?: string; seriesId?: string}) => !definition.availableProfiles?.length || definition.availableProfiles.some((item) => item.accountId === profile?.accountId && item.seriesId === profile?.seriesId);
export const isTemplateCompatible = (scene: Pick<VideoScene, "rollType" | "content">, definition: TemplateDefinition) => definition.rollRole === (scene.rollType ?? "b-roll") && (definition.id !== "rve/text-highlight" || scene.content.keywords.length >= 2);

export const getTemplateStatus = (scene: VideoScene) => {
  const definition = templateById.get(scene.templateId);
  if (!definition) return {definition: undefined, reason: "模板不存在", usable: false};
  if (!definition.adapted) return {definition, reason: "模板尚未完成适配", usable: false};
  if (!isTemplateCompatible(scene, definition)) return {definition, reason: "模板不允许用于当前镜头", usable: false};
  if (scene.endMs - scene.startMs < definition.minDurationMs) return {definition, reason: `镜头不足 ${(definition.minDurationMs / 1000).toFixed(1)} 秒`, usable: false};
  if (definition.requiresMedia && !visualImageDataSchema.safeParse(scene.templateData).success) return {definition, reason: "缺少完整图片资源", usable: false};
  if (definition.renderer === "relation-graph" && !relationGraphDataSchema.safeParse(scene.templateData).success) return {definition, reason: "关系图尚未编排", usable: false};
  return {definition, reason: "可用", usable: true};
};
