import {relationGraphNodeSchema, type RelationGraphNode} from "./relation-graph-schema";

export type GraphShape = NonNullable<RelationGraphNode["data"]["shape"]>;
export type GraphPalette = NonNullable<RelationGraphNode["data"]["palette"]>;
// 配色成套选择，确保填充、轮廓和文字始终有清晰层级。
export const graphPalettes = {
  mint: {label: "薄荷绿", fill: "#E8F3ED", stroke: "#6C9E86", ink: "#244D3B"},
  blue: {label: "晴空蓝", fill: "#EBF0FF", stroke: "#7C91CD", ink: "#334D87"},
  amber: {label: "暖杏色", fill: "#FFF2DE", stroke: "#C69A57", ink: "#785526"},
  violet: {label: "紫藤色", fill: "#F1ECF8", stroke: "#A28ABC", ink: "#64507E"},
  slate: {label: "石墨灰", fill: "#EEF1F2", stroke: "#91A0A6", ink: "#45565E"},
} as const;
export type GraphElement = {id: string; label: string; category: string; width: number; height: number; type?: RelationGraphNode["type"]; shape?: GraphShape; presentation?: "large-icon"; text?: string; items?: string[]};
// 元素按表达用途分类，领域词仅用于搜索，不给形状限定语义。
export const graphElements: GraphElement[] = [
  {id: "card", label: "卡片", category: "概念与主体", shape: "card", width: 220, height: 100},
  {id: "circle", label: "圆形", category: "概念与主体", shape: "ellipse", width: 180, height: 180},
  {id: "ellipse", label: "椭圆", category: "概念与主体", shape: "ellipse", width: 240, height: 140},
  {id: "pill", label: "胶囊", category: "概念与主体", shape: "pill", width: 240, height: 90},
  {id: "icon", label: "大图标", category: "概念与主体", presentation: "large-icon", width: 180, height: 168},
  {id: "rectangle", label: "处理矩形", category: "流程与判断", shape: "rectangle", width: 240, height: 120},
  {id: "diamond", label: "判断菱形", category: "流程与判断", shape: "diamond", width: 240, height: 180},
  {id: "hexagon", label: "六边形", category: "流程与判断", shape: "hexagon", width: 240, height: 140},
  {id: "cylinder", label: "圆柱", category: "载体与集合", shape: "cylinder", width: 200, height: 170},
  {id: "document", label: "文档形", category: "载体与集合", shape: "document", width: 210, height: 170},
  {id: "stack", label: "堆叠卡片", category: "载体与集合", shape: "stack", width: 240, height: 160},
  {id: "info", label: "标题正文卡", category: "信息与说明", shape: "info", width: 300, height: 180, text: "在这里补充说明"},
  {id: "image-card", label: "图文卡", category: "信息与说明", shape: "image-card", width: 300, height: 240, text: "在这里补充说明"},
  {id: "list", label: "列表卡", category: "信息与说明", shape: "list", width: 300, height: 220, items: ["第一项", "第二项", "第三项"]},
  {id: "frame", label: "分组外框", category: "分组与关系", type: "frame", width: 420, height: 260},
  {id: "text", label: "文本气泡", category: "分组与关系", type: "text", width: 280, height: 96, text: "文本内容"},
];
export const graphShapeOptions = graphElements.filter((item) => item.shape && item.id !== "circle");
// 通用图示作为新图文元素的起点，不使用远程素材或暗示品牌归属。
const defaultElementIcon = {src: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect x="8" y="8" width="46" height="46" rx="12" fill="#6C9E86"/><circle cx="89" cy="31" r="23" fill="#7C91CD"/><rect x="66" y="66" width="46" height="46" rx="12" fill="#C69A57"/><circle cx="31" cy="89" r="23" fill="#A28ABC"/></svg>')}`, name: "通用图示", aspectRatio: 1};
export const createGraphElement = (element: GraphElement, id: string, position: {x: number; y: number}) => relationGraphNodeSchema.parse({
  id, type: element.type ?? "default", position,
  data: {label: element.label, ...(element.id === "icon" || element.id === "image-card" ? {icon: {...defaultElementIcon}} : {}), width: element.width, height: element.height, shape: element.shape, palette: "mint", presentation: element.presentation ?? "card", text: element.text, items: element.items ? [...element.items] : undefined},
});

// 路径和安全区均使用归一化坐标；缩放不改变语义，圆形自由拉伸后成为椭圆。
export const graphShapePaths = (shape: GraphShape): string[] => {
  switch (shape) {
    case "ellipse": return ["M50 0 A50 50 0 1 1 50 100 A50 50 0 1 1 50 0Z"];
    case "diamond": return ["M50 0 L100 50 L50 100 L0 50Z"];
    case "hexagon": return ["M20 0 H80 L100 50 L80 100 H20 L0 50Z"];
    case "cylinder": return ["M0 14 C0 -4.666667 100 -4.666667 100 14 V86 C100 104.666667 0 104.666667 0 86Z", "M0 14 C0 32 100 32 100 14"];
    case "document": return ["M0 0 H100 V90 C65 60 35 120 0 90Z"];
    case "stack": return ["M8 8 H100 V100 H8Z", "M4 4 H96 V96 H4Z", "M0 0 H92 V92 H0Z"];
    default: return [];
  }
};
export const graphShapeInsets = (shape: GraphShape) => shape === "diamond" ? {x: .26, y: .26} : shape === "ellipse" ? {x: .18, y: .18} : shape === "hexagon" ? {x: .23, y: .16} : shape === "cylinder" ? {x: .12, y: .28} : shape === "document" ? {x: .12, y: .20} : {x: .09, y: .12};
// 文档下沿在中心穿过 90%；堆叠卡片连在前景卡上，避免连接到装饰层。
export const graphShapeAnchor = (shape: GraphShape | undefined, direction: "top" | "right" | "bottom" | "left") => {
  const points = {top: {x: .5, y: 0}, right: {x: 1, y: .5}, bottom: {x: .5, y: 1}, left: {x: 0, y: .5}};
  const point = points[direction];
  if (shape === "document" && direction === "bottom") return {...point, y: .9};
  if (shape === "stack") return {x: point.x * .92, y: point.y * .92};
  return point;
};
