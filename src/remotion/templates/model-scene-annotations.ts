import type {ModelScenePlan} from "./model-scene-schema";

export const MODEL_WIDTH = 952;
export const MODEL_HEIGHT = 700;
export type ModelAnnotation = ModelScenePlan["annotations"][number];
export type AnnotationPatch = Pick<Partial<ModelAnnotation>, "anchor" | "labelOffset">;
export const ANNOTATION_PRESETS = {
  tag: {label: "简洁标签", accentColor: "#267b64", textColor: "#ffffff", backgroundColor: "#267b64", fontSize: 26, showLine: false},
  callout: {label: "引线卡片", accentColor: "#267b64", textColor: "#26372f", backgroundColor: "#fffef6", fontSize: 28, showLine: true},
  bubble: {label: "强调气泡", accentColor: "#ffbf24", textColor: "#182331", backgroundColor: "#ffcf48", fontSize: 32, showLine: true},
} as const;
export const annotationStyle = (annotation: ModelAnnotation) => {
  const preset = annotation.style?.preset ?? "callout";
  return {...ANNOTATION_PRESETS[preset], ...annotation.style, preset};
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const textWidth = (text: string, size: number) => Array.from(text).reduce((width, char) => width + ((char.codePointAt(0) ?? 0) > 255 ? size * 1.05 : /[WM@%]/.test(char) ? size : /[ilI1.,:;!|]/.test(char) ? size * 0.4 : size * 0.65), 0);

// SVG 文本逐行排版，不依赖 DOM 测量；缩放预览和正式输出共用同一画幅坐标。
export const annotationLayout = (annotation: ModelAnnotation, anchor: {x: number; y: number}) => {
  const style = annotationStyle(annotation);
  const maxWidth = 350;
  const lines: string[] = [];
  let line = "";
  for (const char of Array.from(annotation.text || "未填写标注")) {
    if (char === "\n" || (line && textWidth(line + char, style.fontSize) > maxWidth - 32)) {lines.push(line); line = "";}
    if (char !== "\n") line += char;
  }
  if (line || !lines.length) lines.push(line);
  if (lines.length > 6) {lines.splice(6); lines[5] = Array.from(lines[5]!).slice(0, -1).join("") + "…";}
  const width = Math.min(maxWidth, Math.max(64, ...lines.map((text) => textWidth(text, style.fontSize) + 32)));
  const lineHeight = style.fontSize * 1.3;
  const height = lines.length * lineHeight + 22;
  const offset = annotation.labelOffset ?? {x: 0.16, y: -0.12};
  const center = {
    x: clamp(anchor.x + offset.x * MODEL_WIDTH, width / 2 + 8, MODEL_WIDTH - width / 2 - 8),
    y: clamp(anchor.y + offset.y * MODEL_HEIGHT, height / 2 + 8, MODEL_HEIGHT - height / 2 - 8),
  };
  const x = center.x - width / 2, y = center.y - height / 2;
  const end = {x: clamp(anchor.x, x, x + width), y: clamp(anchor.y, y, y + height)};
  return {style, lines, lineWidths: lines.map((text) => Math.min(width - 32, textWidth(text, style.fontSize))), lineHeight, width, height, center, x, y, end};
};
export const dragLabelOffset = (annotation: ModelAnnotation, anchor: {x: number; y: number}, center: {x: number; y: number}) => {
  const proposed = {...annotation, labelOffset: {x: (center.x - anchor.x) / MODEL_WIDTH, y: (center.y - anchor.y) / MODEL_HEIGHT}};
  const layout = annotationLayout(proposed, anchor);
  return {x: (layout.center.x - anchor.x) / MODEL_WIDTH, y: (layout.center.y - anchor.y) / MODEL_HEIGHT};
};
// 屏幕指针换算为设计画幅坐标，窗口大小或浏览器缩放不影响存储结果。
export const annotationPointer = (client: {x: number; y: number}, rect: {left: number; top: number; width: number; height: number}) => ({x: (client.x - rect.left) / Math.max(1, rect.width) * MODEL_WIDTH, y: (client.y - rect.top) / Math.max(1, rect.height) * MODEL_HEIGHT});
