import {promises as fs} from "node:fs";
import path from "node:path";
import {openBrowser} from "@remotion/renderer";
import {diagramEndpointKinds, parseDiagramSvg, type DiagramData} from "../../remotion/templates/auto-diagram-schema";
import {DIAGRAM_INSPECTION_SCRIPT} from "./inspection-script";

// 检查器异常属于执行故障，不能作为可由模型修复的图表违规返回。
export class DiagramInspectionError extends Error {
  constructor() {super("图表浏览器检查器执行失败，请检查浏览器和本地字体；候选已保留，请勿通过重复修改 SVG 重试");}
}
// 几何报告包含所有动画角色，文本模型也能复核区域、标记和标签的实际位置。
export type DiagramBox = {x: number; y: number; width: number; height: number};
type DiagramElementBox = DiagramBox & {id: string};
// 修复建议不自动改写语义；目标与包含关系仍由模型结合口播判断。
export type DiagramRepair = {groupId: string; instruction: string} & (
  | {code: "endpoint_off_boundary"; end: {x: number; y: number}; candidates: Array<{id: string; kind: DiagramData["bindings"][number]["kind"]; boundary: DiagramBox; nearestBoundaryPoint?: {x: number; y: number}}>; containingRegions: string[]}
  | {code: "edge_crosses_node"; path: string; obstructionId: string; obstructionBounds: DiagramBox}
  | {code: "text_overflow"; text: string; textBounds: DiagramBox; shapeBounds: DiagramBox}
  | {code: "outside_canvas" | "outside_safe_area" | "empty_geometry" | "text_too_small" | "node_overlap" | "missing_arrow" | "invalid_endpoints" | "invalid_path_length" | "connector_endpoints" | "endpoint_inside_node" | "arrow_direction"; bounds?: DiagramBox; relatedGroupIds?: string[]; safeArea?: DiagramBox}
);
export type DiagramInspection = {errors: string[]; repairs: DiagramRepair[]; elements: Array<DiagramElementBox & {kind: DiagramData["bindings"][number]["kind"]; boundary: DiagramBox}>; nodes: DiagramElementBox[]; edges: Array<{id: string; x: number; y: number}>};

export const inspectDiagram = async (data: DiagramData, safeArea: {x: number; y: number; width: number; height: number}, screenshotPath?: string): Promise<DiagramInspection> => {
  parseDiagramSvg(data);
  try {
    const fonts = await Promise.all(["NotoSansSC-Variable.woff2", "NotoSerifSC-Variable.woff2"].map(async (name) => (await fs.readFile(path.join(process.cwd(), "public", "fonts", name))).toString("base64")));
    const browser = await openBrowser("chrome", {logLevel: "error"});
    try {
      const page = await browser.newPage({context: () => null, logLevel: "error", indent: false, pageIndex: 0, onBrowserLog: null, onLog: () => undefined});
      await page.setViewport({width: 960, height: 800, deviceScaleFactor: 1});
      // 使用原始脚本字符串，避免 tsx/esbuild 注入的 __name 闭包泄漏到浏览器。
      const report = await page.evaluate(`(${DIAGRAM_INSPECTION_SCRIPT})(${JSON.stringify({svg: data.svg, bindings: data.bindings, endpointKinds: diagramEndpointKinds, area: safeArea, fonts})})`) as DiagramInspection;
      if (screenshotPath) {
        const shot = await page._client().send("Page.captureScreenshot", {format: "png", clip: {x: 0, y: 0, width: 960, height: 800, scale: 1}});
        await fs.writeFile(screenshotPath, Buffer.from(shot.value.data, "base64"));
      }
      return report;
    } finally {await browser.close({silent: true});}
  } catch {throw new DiagramInspectionError();}
};

// 服务端绑定编辑与 Agent 共用同一套几何规则。
export const inspectDiagramGeometry = async (data: DiagramData, safeArea: {x: number; y: number; width: number; height: number}) => (await inspectDiagram(data, safeArea)).errors;
