// transition.kind 是视觉镜头边界的显式 Manifest 数据；none 表示硬切。
export const TRANSITION_KINDS = ["none", "fade", "slide-left", "slide-up", "zoom-in", "wipe-right"] as const;
export type TransitionKind = typeof TRANSITION_KINDS[number];
export type AnimatedTransitionKind = Exclude<TransitionKind, "none">;
export type TransitionSceneInput = {templateId: string};

/** 首尾淡化；中段按模板保持确定性，避免模型参与转场判断。 */
export const selectSceneTransition = (scene: TransitionSceneInput, index: number, total: number, previousKind?: AnimatedTransitionKind): AnimatedTransitionKind => {
  void previousKind;
  if (index === 0 || index === total - 1) return "fade";
  if (scene.templateId === "rve/text-highlight") return "wipe-right";
  if (scene.templateId === "rve/text-reveal") return "slide-up";
  return "fade";
};
