import {z} from "zod";
import {DOMParser, XMLSerializer, type Element} from "@xmldom/xmldom";
import type {Caption, VideoScene} from "../schema";
import {sceneFrameSpan} from "../timeline";
import {resolveNarrationCue} from "./narration-cue";
import {diagramTypeIds} from "../diagram-types";

// 有向/无向关系都可以连接实体、区域或数据标记；标签和其他连线不能作为端点。
export const diagramEndpointKinds = ["node", "region", "mark"] as const;

// 图表只保存语义触发词，时间由当前字幕重新计算，不接受模型编造的毫秒值。
export const diagramBindingSchema = z.object({
  groupId: z.string().regex(/^[a-zA-Z][\w-]{0,63}$/),
  name: z.string().trim().min(1).max(120),
  cueText: z.string().trim().min(1).max(200),
  occurrence: z.number().int().min(1).max(100).default(1),
  after: z.array(z.string()).max(40).default([]),
  // 区域与数据标记允许有意重叠；有向边和无向连接仍受端点依赖约束。
  kind: z.enum(["node", "edge", "region", "mark", "label", "connector"]).default("node"),
}).strict();
export const diagramDataSchema = z.object({
  type: z.enum(diagramTypeIds),
  svg: z.string().min(1).max(300000),
  bindings: z.array(diagramBindingSchema).min(1).max(40),
  // 缺省保持旧图表行为；开场总览不改变口播触发时间。
  showFullDiagramFirst: z.boolean().optional(),
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

export type DiagramTimingRepair = {
  groupId: string; code: "cue_missing" | "dependency_missing" | "dependency_cycle" | "invalid_endpoints" | "cue_before_dependency";
  instruction: string; dependencyId?: string; cueText?: string; dependencyCueText?: string; cueStartMs?: number; dependencyStartMs?: number;
};

// 一次收集全部绑定问题，时间错误不能阻止后续独立几何检查。
export const diagramTimingReport = (scene: Pick<VideoScene, "startMs" | "endMs" | "speechStartMs" | "speechEndMs">, captions: Caption[], data: DiagramData) => {
  const byId = new Map(data.bindings.map((binding) => [binding.groupId, binding]));
  const errors: string[] = [], repairs: DiagramTimingRepair[] = [];
  const times = new Map<string, number>();
  const issue = (message: string, repair: DiagramTimingRepair) => {errors.push(message); repairs.push(repair);};
  for (const binding of data.bindings) {
    const cue = resolveNarrationCue({scene, captions, text: binding.cueText, occurrence: binding.occurrence});
    if (cue) times.set(binding.groupId, cue.startMs);
    else issue(`“${binding.name}”的触发词“${binding.cueText}”第 ${binding.occurrence} 次未在本镜头匹配`, {groupId: binding.groupId, code: "cue_missing", cueText: binding.cueText, instruction: "使用本镜头原文中的触发词，并核对 occurrence。"});
    if (binding.kind === "edge" || binding.kind === "connector") {
      const endpoints = [...new Set(binding.after)].filter((id) => diagramEndpointKinds.some((kind) => kind === byId.get(id)?.kind));
      if (endpoints.length < 2) issue(`连线“${binding.name}”必须依赖两个不同的 node/region/mark 端点元素；当前依赖：${binding.after.map((id) => `${id}（${byId.get(id)?.kind ?? "不存在"}）`).join("、") || "无"}`, {groupId: binding.groupId, code: "invalid_endpoints", instruction: "保留两个真实端点的依赖，不要用标签或其他连线替代端点。"});
    }
  }
  for (const binding of data.bindings) for (const dependencyId of binding.after) {
    const dependency = byId.get(dependencyId);
    if (!dependency) {issue(`前置元素不存在：${dependencyId}`, {groupId: binding.groupId, code: "dependency_missing", dependencyId, instruction: "修正不存在的依赖 ID。"}); continue;}
    const cueStartMs = times.get(binding.groupId), dependencyStartMs = times.get(dependencyId);
    if (cueStartMs !== undefined && dependencyStartMs !== undefined && dependencyStartMs > cueStartMs) issue(`“${binding.name}”触发早于前置元素 ${dependencyId}`, {groupId: binding.groupId, code: "cue_before_dependency", dependencyId, cueText: binding.cueText, dependencyCueText: dependency.cueText, cueStartMs, dependencyStartMs, instruction: "通过 update_binding 将本组触发词改为依赖出现时或更后的原文；不要删除真实依赖或编造时间。"});
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id) || !byId.has(id)) return;
    if (visiting.has(id)) {issue(`显现依赖成环：${id}`, {groupId: id, code: "dependency_cycle", instruction: "显现依赖必须无环；业务回边也不能形成显现依赖环。"}); return;}
    visiting.add(id);
    for (const dependency of byId.get(id)!.after) visit(dependency);
    visiting.delete(id); visited.add(id);
  };
  for (const binding of data.bindings) visit(binding.groupId);
  return {errors, repairs, times};
};

export const diagramSchedule = (scene: Pick<VideoScene, "startMs" | "endMs" | "speechStartMs" | "speechEndMs">, captions: Caption[], data: DiagramData, fps = 30) => {
  const {errors, times} = diagramTimingReport(scene, captions, data);
  if (errors.length) throw new Error(errors.join("；"));
  const lastFrame = Math.max(0, sceneFrameSpan(scene, fps).durationInFrames - 1);
  return data.bindings.map((binding) => {
    const startMs = times.get(binding.groupId)!;
    const startFrame = Math.min(lastFrame, Math.max(0, Math.round(startMs * fps / 1000) - sceneFrameSpan(scene, fps).from));
    // 总览淡出长度独立保存，避免被镜头末尾截短的单组淡入影响。
    return {...binding, startMs, startFrame, overviewFadeFrames: Math.max(1, Math.round(fps * 0.24)), fadeFrames: Math.min(Math.round(fps * 0.24), lastFrame - startFrame)};
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
  // 总览在首个触发前淡出，之后沿用逐组淡入；所有状态只由当前帧决定。
  const firstFrame = Math.min(...schedule.map((item) => item.startFrame));
  const overviewFadeFrames = Math.min(firstFrame, schedule[0]?.overviewFadeFrames ?? 0);
  const overviewOpacity = data.showFullDiagramFirst && firstFrame > 0 && frame < firstFrame && overviewFadeFrames > 0
    ? Math.min(1, (firstFrame - frame) / overviewFadeFrames) : null;
  for (const item of schedule) {
    const opacity = complete ? 1 : overviewOpacity !== null ? overviewOpacity : frame < item.startFrame ? 0 : item.fadeFrames === 0 ? 1 : Math.min(1, (frame - item.startFrame) / item.fadeFrames);
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
