import type {DiagramData} from "../../remotion/templates/auto-diagram-schema";

// 只做可核实的回边证据门槛；完整关系语义仍需模型与人工预览判断。
export const validateDiagramMeaning = (data: DiagramData, spokenText: string, loopEvidence?: string) => {
  if (data.type !== "loop") return;
  const normalize = (text: string) => text.normalize("NFKC").replace(/[\s\p{P}]/gu, "").toLowerCase();
  const evidence = loopEvidence?.trim() ?? "";
  if (!evidence || !normalize(spokenText).includes(normalize(evidence))) throw new Error("循环图必须提供取自本镜头口播的 loopEvidence，说明最后一步为何返回前序步骤；否则使用 flowchart");
  if (!/(?:返回|回到|循环|反复|下一轮|反馈|迭代|再次|重新|周而复始|repeat|feedback|return|loop|iterat)/iu.test(evidence)) throw new Error("loopEvidence 未包含明确的返回、重复或反馈描述；“环环相扣”和持续时间不足以证明闭环，请使用 flowchart");
};
