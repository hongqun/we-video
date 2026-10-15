import {comicTag} from "../ComicChrome";
import type {ReactNode} from "react";
// 场景标题的入场动画使用 Remotion 的缓动函数，必须显式导入避免预览运行时崩溃。
import {AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame} from "remotion";
import type {VideoScene} from "../schema";
import {SANS_FONT_FAMILY} from "../typography";
import {VideoBrand} from "../VideoBrand";
import {ProtectedText} from "../ProtectedText";
import {sceneHeadlineSize, VIDEO_COLORS, useVisualTheme} from "../theme";
import type {SupportingTextPlacement, TemplatePresentationMode} from "../templates/registry";

export const SceneFrame: React.FC<{scene: VideoScene; children: ReactNode; compact?: boolean; presentationMode?: TemplatePresentationMode; supportingTextPlacement?: SupportingTextPlacement; consumesMainAsset?: boolean}> = ({scene, children, compact = false, presentationMode = "standard", supportingTextPlacement, consumesMainAsset = false}) => {
  const frame = useCurrentFrame();
  const theme = useVisualTheme();
  const immersive = presentationMode === "immersive";
  const visualFirst = presentationMode === "visual-first";
  const resolvedSupportingTextPlacement = supportingTextPlacement ?? (visualFirst ? "hidden" : "header");
  return (
    <AbsoluteFill
      name={scene.id}
      style={{
        backgroundColor: "transparent",
        color: VIDEO_COLORS.ink,
        display: "flex",
        flexDirection: "column",
        fontFamily: SANS_FONT_FAMILY,
        overflow: "hidden",
        padding: "60px 64px 52px",
        textWrap: "balance",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          minHeight: visualFirst ? 112 : 168,
        }}
      >
        {/* 品牌行统一为 Logo、账号与专题，位置由场景外框的固定边距提供。 */}
        <VideoBrand flow />
        <Interactive.Div
          name="Scene title"
          style={{
            // 共用漫画标题条，不改变图片容器和图谱内部坐标。
            ...comicTag,
            ...(theme.id === "deep-signal" ? {background: theme.colors.ink, borderColor: theme.colors.ink, boxShadow: "none", color: theme.colors.surface} : {}),
            alignSelf: "flex-start",
            padding: "8px 16px",
            boxSizing: "border-box",
            fontSize: sceneHeadlineSize(scene.content.title),
            fontWeight: 720,
            letterSpacing: -0.6,
            lineHeight: 1.2,
            marginTop: visualFirst ? 12 : 20,
            // 非媒体镜头放宽到安全边距内的最大宽度，减少主标题不必要的提前换行。
            maxWidth: consumesMainAsset ? 760 : 948,
            opacity: interpolate(frame, [0, 14], [0, 1], {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            // 英文术语保持完整，中文仍按正常断句机会换行。
            overflowWrap: "break-word",
            wordBreak: "normal",
            textWrap: "balance",
            translate: interpolate(frame, [0, 14], ["0px 35px", "0px 0px"], {
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          <ProtectedText>{scene.content.title}</ProtectedText>
        </Interactive.Div>
        {/* 副标题位置由模板元数据声明，场景外框不感知具体模板或口播内容。 */}
        {resolvedSupportingTextPlacement === "header" && (scene.content.subtitle || scene.content.text).trim() ? (
          <Interactive.Div
            name="Scene supporting text"
            style={{
              color: VIDEO_COLORS.mutedInk,
              fontSize: 24,
              fontWeight: 440,
              lineHeight: 1.42,
              marginTop: 12,
              minHeight: 36,
              opacity: interpolate(frame, [8, 22], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              overflowWrap: "break-word",
              wordBreak: "normal",
            }}
          >
            <ProtectedText>{scene.content.subtitle || scene.content.text}</ProtectedText>
          </Interactive.Div>
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          flex: "1 1 auto",
          flexDirection: "column",
          justifyContent: immersive || compact || visualFirst ? "center" : "flex-start",
          marginLeft: -64,
          marginTop: 0,
          minHeight: 0,
          overflow: "hidden",
          padding: immersive ? "14px 64px 150px" : visualFirst ? "16px 64px 70px" : compact ? "20px 64px 54px" : "48px 64px 54px",
          width: "calc(100% + 128px)",
        }}
      >
        {/* 转场由场景级交叉层统一接管，内容容器不再额外位移或淡出。 */}
        <div
          style={{
            display: "flex",
            flex: "1 1 auto",
            flexDirection: "column",
            justifyContent: immersive || compact || visualFirst ? "center" : "flex-start",
            minHeight: 0,
          }}
        >
          {children}
        </div>
      </div>
    </AbsoluteFill>
  );
};
