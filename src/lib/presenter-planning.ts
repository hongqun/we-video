import type {VisualPlanScene} from "./visual-plan";
import {type PresenterFraming, type PresenterPlacement, type PresenterPoseDefinition, type PresenterPoseId} from "../remotion/presenter-config";
import {templateById} from "../remotion/templates/registry";

/** 陪伴位优先沿用上一场，只在模板安全区冲突时换边。 */
export const companionPlacementForTemplate = (templateId: string, pose: PresenterPoseDefinition, previous?: PresenterPlacement, sameSideCount = 0): Exclude<PresenterPlacement, "hero"> => {
  const candidates = templateById.get(templateId)?.companionPlacements ?? ["right-lower", "left-lower"];
  const safe = candidates.filter((candidate) => pose.safeSide === "both" || candidate.startsWith(pose.safeSide));
  const usable = safe.length ? safe : candidates;
  if (previous && previous !== "hero" && sameSideCount < 2 && usable.includes(previous)) return previous;
  return usable.find((candidate) => !previous || candidate.split("-")[0] !== previous.split("-")[0]) ?? usable[0] ?? "right-lower";
};

export const compatiblePoseForPlacement = (poseId: PresenterPoseId, placement: PresenterPlacement, poses: PresenterPoseDefinition[]): PresenterPoseId => {
  const fallback = poses.find((pose) => pose.id === "neutral") ?? poses[0];
  const pose = poses.find((candidate) => candidate.id === poseId) ?? fallback;
  if (!pose) return "neutral";
  if (placement === "hero" || pose.safeSide === "both" || placement.startsWith(pose.safeSide)) return pose.id;
  return fallback?.id ?? "neutral";
};

export const companionFramingForTemplate = (templateId: string): PresenterFraming => templateById.get(templateId)?.companionFraming ?? "waist";

/** 默认首场使用开场舞台，尾场保持结论舞台；中段模板由规划或人工选择确定。 */
export const attachPresenterPlan = (
  scenes: Array<Omit<VisualPlanScene, "presenter">>,
  selectedPoses: PresenterPoseId[],
  poses: PresenterPoseDefinition[],
  selectedModes: Array<"companion" | "hidden"> = [],
): VisualPlanScene[] => scenes.map((scene, index): VisualPlanScene => {
  const first = index === 0;
  const last = index === scenes.length - 1 && !first;
  if (first || last) {
    const preferred = first ? "greeting-wave" : "neutral";
    const poseId = poses.some((pose) => pose.id === preferred) ? preferred : poses[0]?.id ?? "neutral";
    return {...scene, templateId: first ? "ip/opening-stage" : "ip/closing-stage", presenter: {rollType: "a-roll", mode: "hero", poseId, placement: "hero", framing: "full"}};
  }
  const pose = poses.find((item) => item.id === selectedPoses[index]) ?? poses.find((item) => item.id === "neutral") ?? poses[0];
  const placement = companionPlacementForTemplate(scene.templateId, pose ?? {id: "neutral", label: "中立", semanticTags: [], gestureDirection: "neutral", safeSide: "both"});
  const mode = selectedModes[index] === "companion" ? "companion" : "hidden";
  return {...scene, presenter: {rollType: "b-roll", mode, poseId: compatiblePoseForPlacement(pose?.id ?? "neutral", placement, poses), placement, framing: companionFramingForTemplate(scene.templateId)}};
});
