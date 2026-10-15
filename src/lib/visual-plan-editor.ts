import type {VisualPlan, VisualPlanScene} from "./visual-plan";

export type TimedNarrationSegment = {id: string; startMs: number; endMs: number; speechStartMs?: number; speechEndMs?: number};

// 列表与外框成员同样是可编辑数组，拆分时必须逐层复制。
const cloneVisualPlanScene = (scene: VisualPlanScene): VisualPlanScene => ({
  ...scene,
  // 拆分镜头时独立复制重点词绑定，避免编辑副本影响原镜头。
  content: {...scene.content, keywords: [...scene.content.keywords], ...(scene.content.emphasisBindings ? {emphasisBindings: scene.content.emphasisBindings.map((binding) => ({...binding}))} : {})},
  transition: {...scene.transition},
  presenter: {...scene.presenter},
  ...(scene.visualData ? {
    visualData: {
      ...scene.visualData,
      nodes: scene.visualData.nodes.map((node) => ({...node, position: {...node.position}, data: {...node.data, memberIds: [...(node.data.memberIds ?? [])], ...(node.data.items ? {items: [...node.data.items]} : {}), ...(node.data.icon ? {icon: {...node.data.icon}} : {})}})),
      edges: scene.visualData.edges.map((edge) => ({...edge})),
    },
  } : {}),
});

// 一个视觉镜头只归属一个口播段落；同一段落可以拆成多个连续视觉镜头。
export const visualPlanSceneIndexAtTime = (
  scenes: readonly VisualPlanScene[],
  timeMs: number,
) => scenes.findIndex((scene) => timeMs >= scene.startMs && timeMs < scene.endMs);

export const splitVisualPlanScene = (scenes: readonly VisualPlanScene[], index: number, splitAtMs: number): VisualPlanScene[] => {
  const current = scenes[index];
  if (!current) throw new Error("未找到要拆分的视觉镜头");
  if (!Number.isInteger(splitAtMs) || splitAtMs <= current.startMs || splitAtMs >= current.endMs) throw new Error("拆分位置必须位于当前视觉镜头中间");
  const nextId = `${current.id}-split`;
  if (scenes.some((scene) => scene.id === nextId)) throw new Error("视觉镜头 ID 冲突，请刷新后重试");
  // 首尾舞台只能各保留一个；拆分时把新增的边缘副本降为中段隐藏人物镜头。
  const middlePresenter = {rollType: "b-roll" as const, mode: "hidden" as const, poseId: current.presenter.poseId, placement: "right-lower" as const, framing: "waist" as const};
  const noneTransition: VisualPlanScene["transition"] = {kind: "none", durationMs: 0};
  // 拆分后的两个镜头必须拥有独立的可编辑数据，避免关系图或文字修改串到另一镜头。
  const inserted: VisualPlanScene = {
    ...cloneVisualPlanScene(current),
    id: nextId,
    startMs: splitAtMs,
    ...(current.templateId === "ip/opening-stage" ? {templateId: "rve/generic-content", presenter: middlePresenter} : {}),
    transition: {...noneTransition},
  };
  const retained: VisualPlanScene = {...cloneVisualPlanScene(current), endMs: splitAtMs, transition: {...noneTransition}};
  if (current.templateId === "ip/closing-stage") {
    return [...scenes.slice(0, index), {...retained, templateId: "rve/generic-content", presenter: middlePresenter}, inserted, ...scenes.slice(index + 1)];
  }
  return [...scenes.slice(0, index), retained, inserted, ...scenes.slice(index + 1)];
};

export const visualPlanChanged = (current: VisualPlan, saved: VisualPlan) =>
  JSON.stringify({visualStyle: current.visualStyle, cover: current.cover, scenes: current.scenes}) !== JSON.stringify({visualStyle: saved.visualStyle, cover: saved.cover, scenes: saved.scenes});

export const visualPlanFinalizeDecision = (
  current: VisualPlan,
  saved: VisualPlan,
  pendingReviewCount: number,
) => ({
  canFinalize: pendingReviewCount === 0,
  saveBeforeFinalize: visualPlanChanged(current, saved),
});

export const canAcknowledgeVisualPlanScene = (
  sceneId: string,
  reviewIds: ReadonlySet<string>,
  correctedIds: ReadonlySet<string>,
) => reviewIds.has(sceneId) && correctedIds.has(sceneId);
