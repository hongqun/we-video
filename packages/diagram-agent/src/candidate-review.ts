import {diagramCandidateHash} from "../../../src/lib/diagram/candidate";
import type {DiagramCandidate} from "../../../src/lib/diagram/store";

type ReviewContext = {requestId: string; fingerprint: string; reviewedHash: string; saves: number; maxSaves: number};

// 只有本次请求完整校验且复查过的同一份候选，才能进入人工预览和采用状态。
export function assertDiagramCandidateReady(candidate: DiagramCandidate | null, context: ReviewContext): asserts candidate is DiagramCandidate {
  if (!candidate || candidate.requestId !== context.requestId || candidate.fingerprint !== context.fingerprint || !candidate.validation?.valid || candidate.validation.errors.length) {
    throw new Error(context.saves >= context.maxSaves ? `图表保存达到 ${context.maxSaves} 次预算，当前候选仍未通过校验，请继续对话修改` : "Agent 未提交有效图表，请继续对话");
  }
  const hash = diagramCandidateHash(candidate.data, candidate.loopEvidence);
  if (candidate.hash !== hash || context.reviewedHash !== hash) throw new Error("当前图表尚未执行 inspect_diagram 复查，请继续对话完成检查");
}
