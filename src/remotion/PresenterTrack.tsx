import {OPENING_PRESENTER_BOX, openingPresenterImageStyle} from "./OpeningLayout";
import {Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import type {PresenterFraming, PresenterPlacement, PresenterPoseId} from "./presenter-config";
import type {RenderManifest, VideoScene} from "./schema";
import {useVisualTheme} from "./theme";
import type {VideoTheme} from "./visual-style";

type Presenter = NonNullable<RenderManifest["presenter"]>;
type Box = {left: number; top: number; width: number; height: number};

const fullPlacementBox: Record<PresenterPlacement, Box> = {
  hero: {left: 480, top: 150, width: 560, height: 900},
  "left-mid": {left: 42, top: 490, width: 300, height: 430},
  "right-mid": {left: 738, top: 490, width: 300, height: 430},
  "left-lower": {left: 42, top: 675, width: 286, height: 410},
  "right-lower": {left: 752, top: 675, width: 286, height: 410},
};

const cropBottomFor: Record<PresenterFraming, number> = {
  full: 0,
  "three-quarter": 0.18,
  waist: 0.34,
  bust: 0.5,
};

/** B-roll 用局部裁切提升人物辨识度，人物占用框仍限制在模板角落。 */
const placementBox = (placement: PresenterPlacement, framing: PresenterFraming, scene?: VideoScene, theme?: VideoTheme): Box => {
  // 开场半身视窗与封面同源，总结及中间镜头保留现有配置。
  if (placement === "hero" && scene?.templateId === "ip/opening-stage") return OPENING_PRESENTER_BOX;
  // 总结舞台沿用开场的右侧近景尺度，人物上移放大后能承担右侧视觉重心。
  if (placement === "hero" && scene?.templateId === "ip/closing-stage") {
    if (theme?.id === "kinetic-lime") return {left: 540, top: 280, width: 520, height: 760};
    if (theme?.id === "deep-signal") return {left: 570, top: 280, width: 470, height: 760};
    return {left: 560, top: 300, width: 480, height: 720};
  }
  if (placement === "hero" || framing === "full") return fullPlacementBox[placement];
  const leftSide = placement.startsWith("left");
  const mid = placement.endsWith("mid");
  if (framing === "bust") return {left: leftSide ? 34 : 758, top: mid ? 500 : 690, width: 288, height: 330};
  if (framing === "waist") return {left: leftSide ? 28 : 732, top: mid ? 470 : 650, width: 320, height: 370};
  return {left: leftSide ? 32 : 722, top: mid ? 470 : 630, width: 326, height: 400};
};

const boxAt = (from: Box, to: Box, progress: number): Box => ({
  left: interpolate(progress, [0, 1], [from.left, to.left], {easing: Easing.bezier(0.16, 1, 0.3, 1)}),
  top: interpolate(progress, [0, 1], [from.top, to.top], {easing: Easing.bezier(0.16, 1, 0.3, 1)}),
  width: interpolate(progress, [0, 1], [from.width, to.width], {easing: Easing.bezier(0.16, 1, 0.3, 1)}),
  height: interpolate(progress, [0, 1], [from.height, to.height], {easing: Easing.bezier(0.16, 1, 0.3, 1)}),
});

const side = (placement: PresenterPlacement) => placement.startsWith("left") ? "left" : placement.startsWith("right") ? "right" : "hero";

const sceneAt = (scenes: VideoScene[], timeMs: number) => {
  const index = scenes.findIndex((scene) => timeMs >= scene.startMs && timeMs < scene.endMs);
  // 进入品牌片尾后继续停留在末镜的已收束状态，不能跳回第一镜人物。
  return index >= 0 ? index : timeMs >= (scenes.at(-1)?.endMs ?? 0) ? scenes.length - 1 : 0;
};

const isVisible = (scene?: VideoScene) => Boolean(
  scene && scene.presenterMode !== "hidden" && scene.presenterPlacement && scene.presenterPoseId,
);

/** 人物轨道按全片绝对帧计算；换边或显隐时保留新旧两层交叉，避免低透明度坐标跳变。 */
export const PresenterTrack: React.FC<{scenes: VideoScene[]; presenter?: Presenter}> = ({scenes, presenter}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const theme = useVisualTheme();
  if (!presenter || scenes.length === 0) return null;
  const timeMs = frame / fps * 1000;
  const currentIndex = sceneAt(scenes, timeMs);
  const current = scenes[currentIndex];
  if (!current) return null;
  const boundaryIndex = scenes.findIndex((scene, index) => {
    if (index === 0) return false;
    const duration = scenes[index - 1].transition.durationMs;
    return duration > 0 && Math.abs(timeMs - scene.startMs) <= duration / 2;
  });
  const before = boundaryIndex > 0 ? scenes[boundaryIndex - 1] : current;
  const after = boundaryIndex > 0 ? scenes[boundaryIndex] : current;
  const transitionDuration = boundaryIndex > 0 ? before.transition.durationMs : 1;
  const progress = boundaryIndex > 0
    ? interpolate(timeMs, [after.startMs - transitionDuration / 2, after.startMs + transitionDuration / 2], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"})
    : 1;
  // 人物过渡整体压缩进场景交叉淡化窗口（progress≥0.5 才变化）：与场景淡出/淡入同步，
  // 避免在旧场景仍静止时提前做姿态叠影、换位或淡出，造成「人物闪动」。
  const crossfade = boundaryIndex > 0 ? Math.max(0, Math.min(1, (progress - 0.5) / 0.5)) : 1;
  const fallbackPlacement: PresenterPlacement = current.presenterPlacement ?? "right-lower";
  const fromPlacement = before.presenterPlacement ?? fallbackPlacement;
  const toPlacement = after.presenterPlacement ?? fallbackPlacement;
  const fromFraming = before.presenterFraming ?? (fromPlacement === "hero" ? "full" : "waist");
  const toFraming = after.presenterFraming ?? (toPlacement === "hero" ? "full" : "waist");
  const openingBefore = before.templateId === "ip/opening-stage" && fromPlacement === "hero";
  const openingAfter = after.templateId === "ip/opening-stage" && toPlacement === "hero";
  const changesSide = boundaryIndex > 0 && side(fromPlacement) !== side(toPlacement);
  const transitionBox = boxAt(placementBox(fromPlacement, fromFraming, before, theme), placementBox(toPlacement, toFraming, after, theme), crossfade);
  const finalScene = scenes.at(-1);
  const finalSettleStart = finalScene ? Math.min(finalScene.endMs - 1, finalScene.speechEndMs ?? finalScene.endMs) : 0;
  const finalSettle = finalScene && currentIndex === scenes.length - 1
    ? interpolate(timeMs, [finalSettleStart, finalScene.endMs], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"})
    : 0;
  // 最后停顿窗口把人物收进中心品牌节点，片尾无需覆盖口播时间轴。
  const box = finalSettle > 0 ? boxAt(transitionBox, {left: 510, top: 590, width: 60, height: 86}, finalSettle) : transitionBox;
  // 透明 PNG 人物不做逐帧小数位漂移；浏览器播放时的重采样会把呼吸/浮动放大成像素抖动。
  // 场景切换仍通过位置、显隐和姿态交叉过渡，保留连续运动但避免静态口播画面持续晃动。
  const poseById = new Map(presenter.poses.map((pose) => [pose.id, pose]));
  const fromPoseId = (before.presenterPoseId ?? current.presenterPoseId ?? "neutral") as PresenterPoseId;
  const toPoseId = (after.presenterPoseId ?? current.presenterPoseId ?? "neutral") as PresenterPoseId;
  const fromPose = poseById.get(fromPoseId) ?? poseById.get("neutral");
  const toPose = poseById.get(toPoseId) ?? poseById.get("neutral");
  if (!fromPose || !toPose) return null;
  const poseChanged = boundaryIndex > 0 && fromPose.id !== toPose.id;
  // 姿态与裁切直接跟随后者场景淡入，旧姿态随前者淡出，叠影被场景切换同时遮盖。
  const poseProgress = crossfade;
  const cropBottom = interpolate(crossfade, [0, 1], [cropBottomFor[fromFraming], cropBottomFor[toFraming]], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const imageStyle: React.CSSProperties = {
    height: "100%",
    objectFit: "contain",
    objectPosition: "bottom center",
    position: "absolute",
    width: "100%",
  };

  const layer = (key: string, scene: VideoScene, placement: PresenterPlacement, framing: PresenterFraming, opacity: number, pose: typeof fromPose, targetBox = transitionBox) => {
    if (!isVisible(scene) || !pose || opacity <= 0) return null;
    const opening = scene.templateId === "ip/opening-stage" && placement === "hero";
    return <div key={key} style={{overflow: opening ? "hidden" : undefined, height: targetBox.height, left: targetBox.left, opacity: opacity * (1 - finalSettle), pointerEvents: "none", position: "absolute", top: targetBox.top, transformOrigin: "bottom center", width: targetBox.width}}>
      <Img cropBottom={opening ? 0 : cropBottomFor[framing]} src={staticFile(pose.src)} style={opening ? openingPresenterImageStyle(pose.id) : imageStyle} />
    </div>;
  };
  if (boundaryIndex > 0 && (changesSide || openingBefore !== openingAfter || isVisible(before) !== isVisible(after))) {
    return <>
      {layer("before", before, fromPlacement, fromFraming, 1 - crossfade, fromPose, placementBox(fromPlacement, fromFraming, before, theme))}
      {layer("after", after, toPlacement, toFraming, crossfade, toPose, placementBox(toPlacement, toFraming, after, theme))}
    </>;
  }
  if (!isVisible(after)) return null;
  // 半身裁切只作用于开场，换入中间镜头时交叉到其原有视窗。
  const settledImageStyle = openingAfter ? openingPresenterImageStyle(fromPose.id) : imageStyle;
  return <div style={{overflow: openingAfter ? "hidden" : undefined, height: box.height, left: box.left, opacity: 1 - finalSettle, pointerEvents: "none", position: "absolute", top: box.top, transformOrigin: "bottom center", width: box.width}}>
    <Img cropBottom={openingAfter ? 0 : cropBottom} src={staticFile(fromPose.src)} style={{...settledImageStyle, opacity: poseChanged ? 1 - poseProgress : 1}} />
    {poseChanged ? <Img cropBottom={openingAfter ? 0 : cropBottom} src={staticFile(toPose.src)} style={{...(openingAfter ? openingPresenterImageStyle(toPose.id) : imageStyle), opacity: poseProgress}} /> : null}
  </div>;
};
