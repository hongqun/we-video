import {promises as fs} from "node:fs";
import path from "node:path";
import {openBrowser} from "@remotion/renderer";
import {parseDiagramSvg, type DiagramData} from "../../remotion/templates/auto-diagram-schema";
import {DIAGRAM_INSPECTION_SCRIPT} from "./inspection-script";

// 检查器异常属于执行故障，不能作为可由模型修复的图表违规返回。
export class DiagramInspectionError extends Error {
  constructor() {super("图表浏览器检查器执行失败，请检查浏览器和本地字体；候选已保留，请勿通过重复修改 SVG 重试");}
}
export type DiagramInspection = {errors: string[]; nodes: Array<{id: string; x: number; y: number; width: number; height: number}>; edges: Array<{id: string; x: number; y: number}>};

export const inspectDiagram = async (data: DiagramData, safeArea: {x: number; y: number; width: number; height: number}, screenshotPath?: string): Promise<DiagramInspection> => {
  parseDiagramSvg(data);
  try {
    const fonts = await Promise.all(["NotoSansSC-Variable.woff2", "NotoSerifSC-Variable.woff2"].map(async (name) => (await fs.readFile(path.join(process.cwd(), "public", "fonts", name))).toString("base64")));
    const browser = await openBrowser("chrome", {logLevel: "error"});
    try {
      const page = await browser.newPage({context: () => null, logLevel: "error", indent: false, pageIndex: 0, onBrowserLog: null, onLog: () => undefined});
      await page.setViewport({width: 960, height: 800, deviceScaleFactor: 1});
      // 使用原始脚本字符串，避免 tsx/esbuild 注入的 __name 闭包泄漏到浏览器。
      const report = await page.evaluate(`(${DIAGRAM_INSPECTION_SCRIPT})(${JSON.stringify({svg: data.svg, bindings: data.bindings, area: safeArea, fonts})})`) as DiagramInspection;
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
