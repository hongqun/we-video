import {z} from "zod";
import {DOMParser, XMLSerializer, type Element} from "@xmldom/xmldom";
import type {Caption, VideoScene} from "../schema";
import {sceneFrameSpan} from "../timeline";
import {resolveNarrationCue} from "./narration-cue";

// 图表只保存语义触发词，时间由当前字幕重新计算，不接受模型编造的毫秒值。
export const diagramBindingSchema = z.object({
  groupId: z.string().regex(/^[a-zA-Z][\w-]{0,63}$/),
  name: z.string().trim().min(1).max(120),
  cueText: z.string().trim().min(1).max(200),
  occurrence: z.number().int().min(1).max(100).default(1),
  after: z.array(z.string()).max(40).default([]),
  // 连线必须同时依赖两端节点；业务循环与出现依赖相互独立。
  kind: z.enum(["node", "edge"]).default("node"),
}).strict();
export const diagramDataSchema = z.object({
  type: z.enum(["flow", "architecture", "hierarchy", "cycle", "timeline"]),
  svg: z.string().min(1).max(300000),
  bindings: z.array(diagramBindingSchema).min(1).max(40),
}).strict();
export const adoptedDiagramSchema = diagramDataSchema.extend({contextFingerprint: z.string().min(1)}).strict();
export type DiagramData = z.infer<typeof diagramDataSchema>;
export type AdoptedDiagram = z.infer<typeof adoptedDiagramSchema>;
export const diagramResourceSchema = z.object({status: z.enum(["idle", "running", "ready", "failed", "cancelled", "interrupted", "stale"]), requestId: z.string().optional(), message: z.string().optional(), traceId: z.string().optional()}).strict();
export const DIAGRAM_WIDTH = 960;
export const DIAGRAM_HEIGHT = 800;
const tags = new Set(["svg", "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "linearGradient", "radialGradient", "stop", "marker", "clipPath", "title", "desc"]);
// 无障碍属性只允许本地 ID 引用，不开放任意 aria 属性或事件。
const attrs = new Set(["role", "aria-labelledby", "aria-describedby", "aria-hidden", "xmlns", "id", "viewBox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "opacity", "transform", "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "dx", "dy", "letter-spacing", "marker-start", "marker-end", "marker-mid", "markerWidth", "markerHeight", "refX", "refY", "orient", "markerUnits", "gradientUnits", "gradientTransform", "offset", "stop-color", "stop-opacity", "clip-path", "clipPathUnits", "preserveAspectRatio", "fill-rule", "clip-rule", "vector-effect"]);

// 兼容 CSS 字体引号和项目回退栈，但首选字体必须是已内置的本地字体。
const localFonts = new Set(["Studio Sans", "Studio Serif"]);
const fallbackFonts = new Set([...localFonts, "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "PingFang SC", "Microsoft YaHei", "sans-serif", "ui-serif", "Songti SC", "STSong", "SimSun", "serif"]);
const isLocalFontFamily = (value: string) => {
  const families = value.split(",").map((family) => {
    const match = /^(?:"([^"']+)"|'([^"']+)'|([^"']+))$/u.exec(family.trim());
    return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
  });
  return localFonts.has(families[0]!) && families.every((family) => fallbackFonts.has(family));
};

// 白名单使用 XML 解析树检查，拒绝整个输入，绝不以字符串清洗后直接信任 SVG。
export const parseDiagramSvg = (data: DiagramData) => {
  const errors: string[] = [];
  if (/<!|<\?/u.test(data.svg)) throw new Error("SVG 不允许声明、实体、注释或处理指令");
  const doc = new DOMParser({onError: (level, message) => {errors.push(`${level}: ${message}`);}}).parseFromString(data.svg, "image/svg+xml");
  if (errors.length || !doc.documentElement) throw new Error(`SVG 解析失败：${errors.join("；")}`);
  const root = doc.documentElement;
  if (root.tagName !== "svg" || root.getAttribute("viewBox")?.trim().replace(/\s+/g, " ") !== `0 0 ${DIAGRAM_WIDTH} ${DIAGRAM_HEIGHT}`) throw new Error(`SVG 必须使用 viewBox="0 0 ${DIAGRAM_WIDTH} ${DIAGRAM_HEIGHT}"`);
  if (root.getAttribute("xmlns") !== "http://www.w3.org/2000/svg") throw new Error("SVG 必须声明标准命名空间");
  const groups = new Set(data.bindings.map((item) => item.groupId));
  if (groups.size !== data.bindings.length || groups.has("opening")) throw new Error("动画分组 ID 重复或占用了 opening");
  const ids = new Map<string, {defs: boolean; tag: string}>();
  const references: string[] = [];
  const accessibleReferences: string[] = [];
  const found = new Set<string>();
  const walk = (element: Element, owner: string | null, inDefs: boolean) => {
    const tag = element.tagName;
    if (!tags.has(tag)) throw new Error(`不允许的 SVG 标签：${tag}`);
    if (tag === "svg" && element !== root) throw new Error("不允许嵌套 SVG");
    const id = element.getAttribute("id");
    inDefs ||= tag === "defs";
    if (id) {
      if (!/^[a-zA-Z][\w-]{0,63}$/u.test(id) || ids.has(id)) throw new Error(`SVG ID 无效或重复：${id}`);
      ids.set(id, {defs: inDefs, tag});
    }
    if (id && (groups.has(id) || id === "opening")) {
      if (tag !== "g" || owner || inDefs) throw new Error(`动画或开场分组不可嵌套：${id}`);
      owner = id; found.add(id);
    }
    if (!inDefs && !["svg", "g", "defs", "title", "desc"].includes(tag) && !owner) throw new Error(`可见元素 ${tag} 必须归属 opening 或唯一动画组`);
    if (["linearGradient", "radialGradient", "stop", "marker", "clipPath"].includes(tag) && !inDefs) throw new Error(`${tag} 必须放在 defs 内`);
    for (let i = 0; i < element.attributes.length; i++) {
      const attr = element.attributes.item(i)!;
      if (attr.name === "xmlns" && (element !== root || attr.value !== "http://www.w3.org/2000/svg")) throw new Error("SVG 命名空间无效");
      if (attr.name === "role" && attr.value !== "img") throw new Error("SVG role 只允许 img");
      if (attr.name === "aria-hidden" && !["true", "false"].includes(attr.value)) throw new Error("aria-hidden 值无效");
      if (["aria-labelledby", "aria-describedby"].includes(attr.name)) {
        const targets = attr.value.trim().split(/\s+/u);
        if (!targets.every((target) => /^[a-zA-Z][\w-]{0,63}$/u.test(target))) throw new Error("无障碍引用必须使用本地 ID");
        accessibleReferences.push(...targets);
      }
      if (!attrs.has(attr.name)) throw new Error(`不允许的 SVG 属性：${attr.name}`);
      if ([...attr.value].some((character) => character === "\\" || character.charCodeAt(0) <= 8) || /(?:javascript:|data:|https?:|@import|expression\s*\()/iu.test(attr.name === "xmlns" ? "" : attr.value)) throw new Error(`SVG 属性包含外部或可执行内容：${attr.name}`);
      if (/url\s*\(/iu.test(attr.value)) {
        if (!/^url\(#[a-zA-Z][\w-]{0,63}\)$/u.test(attr.value)) throw new Error("只允许本地 defs 引用");
        references.push(attr.value.slice(5, -1));
      }
      if (attr.name === "font-family" && !isLocalFontFamily(attr.value)) throw new Error(`SVG 只能以项目本地字体 Studio Sans / Studio Serif 为首选字体，收到：${attr.value}`);
    }
    for (let node = element.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === 1) walk(node as Element, owner, inDefs);
      else if (node.nodeType !== 3 || (node.nodeValue?.trim() && !["text", "tspan", "title", "desc"].includes(tag))) throw new Error("SVG 包含无效文本或节点");
    }
  };
  walk(root, null, false);
  for (const id of groups) if (!found.has(id)) throw new Error(`SVG 缺少动画分组：${id}`);
  for (const ref of references) if (!ids.get(ref)?.defs) throw new Error(`引用必须指向 defs 内的有效资源：${ref}`);
  for (const ref of accessibleReferences) if (!ids.has(ref)) throw new Error(`无障碍引用不存在：${ref}`);
  return {doc, root};
};

export const diagramSchedule = (scene: Pick<VideoScene, "startMs" | "endMs" | "speechStartMs" | "speechEndMs">, captions: Caption[], data: DiagramData, fps = 30) => {
  const byId = new Map(data.bindings.map((binding) => [binding.groupId, binding]));
  const times = new Map<string, number>();
  const visiting = new Set<string>();
  const lastFrame = Math.max(0, sceneFrameSpan(scene, fps).durationInFrames - 1);
  const visit = (id: string): number => {
    if (times.has(id)) return times.get(id)!;
    const binding = byId.get(id);
    if (!binding) throw new Error(`前置元素不存在：${id}`);
    if (visiting.has(id)) throw new Error(`显现依赖成环：${id}`);
    visiting.add(id);
    const cue = resolveNarrationCue({scene, captions, text: binding.cueText, occurrence: binding.occurrence});
    if (!cue) throw new Error(`“${binding.name}”的触发词“${binding.cueText}”第 ${binding.occurrence} 次未在本镜头匹配`);
    if (binding.kind === "edge" && new Set(binding.after).size < 2) throw new Error(`连线“${binding.name}”必须依赖两端节点`);
    for (const dependency of binding.after) {
      if (visit(dependency) > cue.startMs) throw new Error(`“${binding.name}”触发早于前置元素 ${dependency}`);
    }
    visiting.delete(id); times.set(id, cue.startMs); return cue.startMs;
  };
  return data.bindings.map((binding) => {
    const startMs = visit(binding.groupId);
    const startFrame = Math.min(lastFrame, Math.max(0, Math.round(startMs * fps / 1000) - sceneFrameSpan(scene, fps).from));
    return {...binding, startMs, startFrame, fadeFrames: Math.min(Math.round(fps * 0.24), lastFrame - startFrame)};
  });
};

export const validateDiagram = (scene: Pick<VideoScene, "startMs" | "endMs" | "speechStartMs" | "speechEndMs">, captions: Caption[], input: unknown) => {
  const data = diagramDataSchema.parse(input);
  parseDiagramSvg(data);
  diagramSchedule(scene, captions, data);
  return data;
};

export const diagramSvgAtFrame = (data: DiagramData, schedule: ReturnType<typeof diagramSchedule>, frame: number, complete = false, namespace = "") => {
  const {doc, root} = parseDiagramSvg(data);
  if (complete) for (const binding of data.bindings) doc.getElementById(binding.groupId)?.setAttribute("opacity", "1");
  for (const item of schedule) {
    const opacity = complete ? 1 : frame < item.startFrame ? 0 : item.fadeFrames === 0 ? 1 : Math.min(1, (frame - item.startFrame) / item.fadeFrames);
    doc.getElementById(item.groupId)?.setAttribute("opacity", String(opacity));
  }
  // 同页可能同时显示已采用图与候选图，引用加实例前缀，避免渐变和箭头串图。
  if (namespace) {
    const elements = [root, ...Array.from({length: root.getElementsByTagName("*").length}, (_, index) => root.getElementsByTagName("*").item(index)!)];
    for (const element of elements) {
      if (element.hasAttribute("id")) element.setAttribute("id", `${namespace}-${element.getAttribute("id")}`);
      // 无障碍 ID 与渐变、箭头引用一样必须随预览实例隔离。
      for (const name of ["aria-labelledby", "aria-describedby"]) {
        if (element.hasAttribute(name)) element.setAttribute(name, element.getAttribute(name)!.trim().split(/\s+/u).map((id) => `${namespace}-${id}`).join(" "));
      }
      for (let i = 0; i < element.attributes.length; i++) {
        const attribute = element.attributes.item(i)!;
        if (attribute.value.startsWith("url(#")) element.setAttribute(attribute.name, `url(#${namespace}-${attribute.value.slice(5, -1)})`);
      }
    }
  }
  root.setAttribute("width", "100%"); root.setAttribute("height", "100%");
  root.setAttribute("font-family", "Studio Sans");
  return new XMLSerializer().serializeToString(root);
};
