import type {Caption, VideoScene} from "../../remotion/schema";
import {diagramDataSchema, diagramTimingReport, parseDiagramSvg, type DiagramData, type DiagramTimingRepair} from "../../remotion/templates/auto-diagram-schema";
import {inspectDiagram, type DiagramBox, type DiagramInspection, type DiagramRepair} from "./geometry";
import {validateDiagramMeaning} from "./meaning";

export type DiagramValidationRepair = DiagramRepair | DiagramTimingRepair | {groupId: string; code: "unsafe_svg" | "meaning_invalid"; instruction: string};
export type DiagramValidationReport = {
  valid: boolean; errors: string[]; repairs: DiagramValidationRepair[];
  measurements: DiagramInspection["elements"]; edgeEndpoints: DiagramInspection["edges"]; safeArea: DiagramBox;
};
type ValidationContext = {scene: Pick<VideoScene, "startMs" | "endMs" | "speechStartMs" | "speechEndMs">; captions: Caption[]; spokenText: string; safeArea: DiagramBox; loopEvidence?: string};

// 白名单是浏览器执行前的硬门槛；通过后，语义、时间、几何互不短路。
export const validateDiagramCandidate = async (data: DiagramData, context: ValidationContext, inspect: () => Promise<DiagramInspection> = () => inspectDiagram(data, context.safeArea)): Promise<DiagramValidationReport> => {
  const report: DiagramValidationReport = {valid: false, errors: [], repairs: [], measurements: [], edgeEndpoints: [], safeArea: context.safeArea};
  try {data = diagramDataSchema.parse(data); parseDiagramSvg(data);}
  catch (error) {
    report.errors.push(error instanceof Error ? error.message : "SVG 安全校验失败");
    report.repairs.push({groupId: "opening", code: "unsafe_svg", instruction: "修正 SVG 白名单与分组结构后重新提交；不安全的 SVG 不会送入浏览器。"});
    return report;
  }
  const timing = diagramTimingReport(context.scene, context.captions, data);
  report.errors.push(...timing.errors); report.repairs.push(...timing.repairs);
  try {validateDiagramMeaning(data, context.spokenText, context.loopEvidence);}
  catch (error) {
    report.errors.push(error instanceof Error ? error.message : "图表语义校验失败");
    report.repairs.push({groupId: "opening", code: "meaning_invalid", instruction: "核对图型与本镜头口播；loop 必须提供真实回边原文证据。"});
  }
  const geometry = await inspect();
  report.errors.push(...geometry.errors); report.repairs.push(...geometry.repairs);
  report.measurements = geometry.elements; report.edgeEndpoints = geometry.edges;
  report.valid = report.errors.length === 0;
  return report;
};

// 模型仅接收失败分组及关联端点的几何，完整报告仍在候选中保留。
export const compactDiagramReport = (report: DiagramValidationReport, data: DiagramData) => {
  const affected = new Set(report.repairs.flatMap((repair) => [repair.groupId,
    ...("dependencyId" in repair && repair.dependencyId ? [repair.dependencyId] : []),
    ...("obstructionId" in repair ? [repair.obstructionId] : []),
    ...("relatedGroupIds" in repair ? repair.relatedGroupIds ?? [] : []),
    ...("candidates" in repair ? repair.candidates.map((candidate) => candidate.id) : []),
  ]));
  for (const binding of data.bindings) if (affected.has(binding.groupId)) for (const dependency of binding.after) affected.add(dependency);
  return {...report, measurements: report.measurements.filter((element) => affected.has(element.id)), edgeEndpoints: report.edgeEndpoints.filter((edge) => affected.has(edge.id))};
};
