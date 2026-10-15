import {z} from "zod";

export const relationGraphNodeTypeSchema = z.enum(["default", "input", "output", "group", "frame", "text"]);
export const relationGraphEdgeTypeSchema = z.enum(["default", "straight", "step", "smoothstep", "simplebezier"]);
export const relationGraphHandleDirectionSchema = z.enum(["top", "right", "bottom", "left"]);
export const relationGraphNodePresentationSchema = z.enum(["card", "large-icon"]);
export const relationGraphLabelPlacementSchema = z.enum(["top", "bottom"]);
export const relationGraphTextAnimationSchema = z.enum(["direct", "typewriter"]);
export const relationGraphTextStyleSchema = z.enum(["bubble-left", "bubble-right", "message", "plain"]);
export const relationGraphStrokeStyleSchema = z.enum(["solid", "dashed"]);
export const relationGraphArrowTypeSchema = z.enum(["none", "end", "both"]);
export const relationGraphStrokeColorValues = ["#7DA894", "#26372F", "#4F6BFF", "#E05252", "#E58A3A", "#C6A43A", "#8B6FB8", "#AEB8B1"] as const;
export const relationGraphStrokeColorSchema = z.enum(relationGraphStrokeColorValues);
export const relationGraphStrokeColorOptions = [
  {value: "#7DA894", label: "薄荷绿"},
  {value: "#26372F", label: "深墨绿"},
  {value: "#4F6BFF", label: "蓝色"},
  {value: "#E05252", label: "红色"},
  {value: "#E58A3A", label: "橙色"},
  {value: "#C6A43A", label: "金色"},
  {value: "#8B6FB8", label: "紫色"},
  {value: "#AEB8B1", label: "灰色"},
] as const;
export const relationGraphTextColorOptions = [
  {value: "#26372F", label: "深墨绿"},
  {value: "#237A58", label: "森林绿"},
  {value: "#4F6BFF", label: "蓝色"},
  {value: "#E05252", label: "红色"},
  {value: "#E58A3A", label: "橙色"},
  {value: "#8B6FB8", label: "紫色"},
  {value: "#5C6670", label: "石墨灰"},
  {value: "#9A6A00", label: "暗金色"},
] as const;

const relationGraphIconSchema = z.object({src: z.string().trim().min(1), name: z.string().trim().min(1).optional(), aspectRatio: z.number().finite().positive().default(1)}).strict();
const relationGraphCardScaleSchema = z.number().finite().transform((value) => Math.min(2, Math.max(0.7, value))).default(1);
const relationGraphLabelFontSizeSchema = z.number().finite().transform((value) => Math.min(48, Math.max(12, value))).default(12);
const relationGraphStrokeWidthSchema = z.number().finite().transform((value) => Math.min(12, Math.max(1, value))).default(3);
const relationGraphTextColorSchema = z.string().regex(/^#[0-9a-f]{6}$/iu, "文字颜色必须是六位十六进制颜色").default("#26372F");
const relationGraphTextFontSizeSchema = z.number().finite().transform((value) => Math.min(72, Math.max(12, value))).default(24);

export const relationGraphNodeDataSchema = z.object({
  // 新元素显式选择外观；缺失时保留历史节点，不自动换肤。
  shape: z.enum(["card", "ellipse", "pill", "rectangle", "diamond", "hexagon", "cylinder", "document", "stack", "info", "image-card", "list"]).optional(),
  palette: z.enum(["mint", "blue", "amber", "violet", "slate"]).optional(),
  items: z.array(z.string()).optional(),
  // 节点标签是展示文本，只校验去掉空白后非空，不改写用户输入的空格。
  label: z.string().refine((value) => value.trim().length > 0, "节点文字不能为空").optional(),
  icon: relationGraphIconSchema.optional(),
  // 新样式字段均有默认值，旧任务无需迁移即可继续按卡片节点渲染。
  presentation: relationGraphNodePresentationSchema.default("card"),
  labelPlacement: relationGraphLabelPlacementSchema.default("bottom"),
  iconSize: z.number().finite().transform((value) => Math.min(240, Math.max(48, value))).default(120),
  // 宽高可选以兼容旧任务；缺失时由 cardScale 或大图标内容推导，不设上限交给用户决定。
  width: z.number().finite().transform((value) => Math.max(1, value)).optional(),
  height: z.number().finite().transform((value) => Math.max(1, value)).optional(),
  cardScale: relationGraphCardScaleSchema,
  cueText: z.string().trim().min(1).optional(),
  cueOccurrence: z.number().int().positive().optional(),
  // 文本框内容和节点标签分开保存，便于编辑器用短名称识别节点、画面显示完整文案。
  text: z.string().refine((value) => value.trim().length > 0, "文本框内容不能为空").optional(),
  textAnimation: relationGraphTextAnimationSchema.default("direct"),
  textStyle: relationGraphTextStyleSchema.default("message"),
  textColor: relationGraphTextColorSchema,
  textFontSize: relationGraphTextFontSizeSchema,
  // 外框标题独立控制字号，旧关系图默认使用 24px。
  frameFontSize: relationGraphTextFontSizeSchema,
  // frame 通过成员 ID 关联多个节点，成员移动时外框仍保持独立可编辑。
  memberIds: z.array(z.string().trim().min(1)).default([]),
}).strict();

export const relationGraphNodeSchema = z.object({
  id: z.string().trim().min(1),
  type: relationGraphNodeTypeSchema,
  position: z.object({x: z.number().finite(), y: z.number().finite()}).strict(),
  data: relationGraphNodeDataSchema,
}).strict().superRefine((node, context) => {
  if (node.type === "group" && !node.data.label) context.addIssue({code: "custom", path: ["data", "label"], message: "分组节点必须填写文字"});
  if (node.type === "text" && !node.data.text) context.addIssue({code: "custom", path: ["data", "text"], message: "文本框节点必须填写内容"});
  if (node.type !== "group" && node.type !== "text" && !node.data.label && !node.data.icon) context.addIssue({code: "custom", path: ["data", "label"], message: "没有图标时必须填写节点文字"});
});

export const relationGraphEdgeSchema = z.object({
  id: z.string().trim().min(1),
  source: z.string().trim().min(1),
  target: z.string().trim().min(1),
  sourceHandle: relationGraphHandleDirectionSchema.default("right"),
  targetHandle: relationGraphHandleDirectionSchema.default("left"),
  labelFontSize: relationGraphLabelFontSizeSchema,
  showLabelBox: z.boolean().default(true),
  type: relationGraphEdgeTypeSchema.default("smoothstep"),
  strokeStyle: relationGraphStrokeStyleSchema.default("dashed"),
  strokeWidth: relationGraphStrokeWidthSchema,
  // 只更新缺省配色，不替换已保存的颜色值。
  strokeColor: relationGraphStrokeColorSchema.default("#26372F"),
  arrowType: relationGraphArrowTypeSchema.default("none"),
  // 连线标签同样保留原始空格，避免展示层把多词标签拼接或改写。
  label: z.string().refine((value) => value.trim().length > 0, "连线标签不能为空").optional(),
  cueText: z.string().trim().min(1).optional(),
  cueOccurrence: z.number().int().positive().optional(),
}).strict();

export const relationGraphDataSchema = z.object({
  kind: z.literal("relation-graph"),
  nodes: z.array(relationGraphNodeSchema),
  edges: z.array(relationGraphEdgeSchema),
}).strict().superRefine((data, context) => {
  const ids = new Set<string>();
  data.nodes.forEach((node, index) => {
    if (ids.has(node.id)) context.addIssue({code: "custom", path: ["nodes", index, "id"], message: "节点 ID 不能重复"});
    ids.add(node.id);
  });
  data.edges.forEach((edge, index) => {
    if (!ids.has(edge.source) || !ids.has(edge.target)) context.addIssue({code: "custom", path: ["edges", index], message: "连线引用了不存在的节点"});
    if (edge.source === edge.target) context.addIssue({code: "custom", path: ["edges", index], message: "节点不能连接自身"});
  });
});

export type RelationGraphData = z.infer<typeof relationGraphDataSchema>;
export type RelationGraphHandleDirection = z.infer<typeof relationGraphHandleDirectionSchema>;
export type RelationGraphNode = z.infer<typeof relationGraphNodeSchema>;
export type RelationGraphEdge = z.infer<typeof relationGraphEdgeSchema>;
