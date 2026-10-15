export const PRESENTER_GESTURE_DIRECTIONS = ["left", "right", "neutral"] as const;
export const PRESENTER_SAFE_SIDES = ["left", "right", "both"] as const;
export const PRESENTER_PLACEMENTS = ["hero", "left-mid", "right-mid", "left-lower", "right-lower"] as const;
export const PRESENTER_FRAMINGS = ["full", "three-quarter", "waist", "bust"] as const;
export const A_ROLL_TEMPLATE_IDS = ["ip/opening-stage", "ip/closing-stage"] as const;

// 姿态目录由账号配置驱动，源码只约束通用方向、位置和构图。
export type PresenterPoseId = string;
export type PresenterGestureDirection = typeof PRESENTER_GESTURE_DIRECTIONS[number];
export type PresenterSafeSide = typeof PRESENTER_SAFE_SIDES[number];
export type PresenterPlacement = typeof PRESENTER_PLACEMENTS[number];
export type PresenterFraming = typeof PRESENTER_FRAMINGS[number];
export type ARollTemplateId = typeof A_ROLL_TEMPLATE_IDS[number];

export type PresenterPoseDefinition = {
  id: PresenterPoseId;
  label?: string;
  semanticTags: string[];
  gestureDirection: PresenterGestureDirection;
  safeSide: PresenterSafeSide;
};

export const presenterPlacementLabels: Record<PresenterPlacement, string> = {
  hero: "全屏主讲",
  "left-mid": "左侧中部",
  "right-mid": "右侧中部",
  "left-lower": "左侧下部",
  "right-lower": "右侧下部",
};

export const presenterFramingLabels: Record<PresenterFraming, string> = {
  full: "全身",
  "three-quarter": "四分之三身",
  waist: "半身",
  bust: "胸像",
};
