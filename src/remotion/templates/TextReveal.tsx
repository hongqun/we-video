import {comicTextSize} from "../ComicChrome";
import {Easing, interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import type {VideoScene} from "../schema";
import {SANS_FONT_FAMILY} from "../typography";
import {sceneTiming} from "./templateTiming";
import {ProtectedText} from "../ProtectedText";
import {VIDEO_COLORS, VIDEO_RADIUS, VIDEO_SHADOW, VIDEO_SURFACES} from "../theme";

export type TextRevealFontStyle = "handwriting" | "brand";

type TextRevealProps = {
  scene: VideoScene;
  text: string;
  fontStyle?: unknown;
};

const filterIdFor = (sceneId: string) => `text-reveal-dust-${sceneId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

export const normalizeTextRevealFontStyle = (value: unknown): TextRevealFontStyle =>
  value === undefined || value === "handwriting" ? "handwriting" : "brand";

export const TextReveal: React.FC<TextRevealProps> = ({scene, text, fontStyle}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const timing = sceneTiming(scene, fps);
  const style = normalizeTextRevealFontStyle(fontStyle);
  const revealStart = Math.min(8, Math.max(0, timing.entryFrames - 1));
  const progress = interpolate(frame, [revealStart, timing.safeEndFrame], [0, 100], {
    easing: Easing.bezier(0.18, 0.84, 0.28, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const filterId = filterIdFor(scene.id);
  const handwriting = style === "handwriting";

  return (
    <>
      {handwriting ? (
        <svg width={0} height={0} style={{position: "absolute"}} aria-hidden="true">
          <defs>
            <filter id={filterId} x="-10%" y="-20%" width="120%" height="140%">
              <feTurbulence type="fractalNoise" baseFrequency="0.52" numOctaves={3} seed={7} result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale={2.6} xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </defs>
        </svg>
      ) : null}
      <div
        style={{
          alignSelf: "stretch",
          clipPath: `polygon(0 0, ${progress}% 0, ${progress}% 100%, 0 100%)`,
          color: VIDEO_COLORS.ink,
          fontFamily: SANS_FONT_FAMILY,
          fontSize: comicTextSize(text, 820, 540, text.length > 18 ? 56 : 72),
          fontWeight: handwriting ? 400 : 780,
          lineHeight: 1.22,
          padding: "54px 48px 62px",
          textAlign: "center",
          // 保留揭示与字体选择，移除发光以保持漫画字面清楚。
          textShadow: "none",
          whiteSpace: "pre-wrap",
          overflowWrap: "normal",
          wordBreak: "normal",
          filter: handwriting ? `url(#${filterId})` : undefined,
          background: VIDEO_SURFACES.feature,
          border: `3px solid ${VIDEO_COLORS.ink}`,
          borderRadius: VIDEO_RADIUS.feature,
          boxShadow: VIDEO_SHADOW.feature,
          minHeight: 300,
        }}
      >
        <ProtectedText>{text}</ProtectedText>
      </div>
    </>
  );
};
