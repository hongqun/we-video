import {comicTextSize} from "../ComicChrome";
import {Audio} from "@remotion/media";
import {Sequence, staticFile, interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import type {VideoScene} from "../schema";
import {SANS_FONT_FAMILY} from "../typography";
import {sceneTiming} from "./templateTiming";
import {ProtectedText} from "../ProtectedText";
import {VIDEO_COLORS, VIDEO_RADIUS, VIDEO_SHADOW, VIDEO_SURFACES, useVisualTheme} from "../theme";
import {textRevealSoundEnabled} from "./text-reveal-schema";

export type TextRevealFontStyle = "handwriting" | "brand";

type TextRevealProps = {
  scene: VideoScene;
  text: string;
  fontStyle?: unknown;
  typingSound?: unknown;
};

const filterIdFor = (sceneId: string) => `text-reveal-dust-${sceneId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

export const normalizeTextRevealFontStyle = (value: unknown): TextRevealFontStyle =>
  value === undefined || value === "handwriting" ? "handwriting" : "brand";

export const TextReveal: React.FC<TextRevealProps> = ({scene, text, fontStyle, typingSound}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const timing = sceneTiming(scene, fps);
  const theme = useVisualTheme();
  const style = normalizeTextRevealFontStyle(fontStyle);
  const revealStart = Math.min(8, Math.max(0, timing.entryFrames - 1));
  // 按每秒约 15 字匀速呈现；长文压缩到镜头可用区间，短文完成后留出阅读时间。
  const characters = Array.from(text.replaceAll("\\n", "\n"));
  const typingEnd = Math.min(timing.safeEndFrame, revealStart + Math.max(1, Math.round(characters.length * fps / 15)));
  const visibleCharacters = Math.floor(interpolate(frame, [revealStart, typingEnd], [0, characters.length], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }));
  const filterId = filterIdFor(scene.id);
  const handwriting = style === "handwriting";
  // 音轨仅覆盖揭示区间，长镜头按现有 30 秒素材衔接，静态停留时不再敲击。
  const typingFrames = Math.max(0, typingEnd - revealStart);
  const bedFrames = Math.max(1, Math.round(fps * 30));
  const soundEnabled = textRevealSoundEnabled(typingSound) && Boolean(text.trim());
  // 外框按主题建立层次，逐字显示仅改变文字可见性，不影响圆角和阴影。
  const frameStyle = theme.id === "kinetic-lime"
    ? {border: `1px solid ${VIDEO_COLORS.line}`, borderLeft: `7px solid ${VIDEO_COLORS.accent}`}
    : theme.id === "layered-mint"
      ? {border: `1px solid ${VIDEO_COLORS.line}`, boxShadow: `inset 0 0 0 8px ${theme.colors.surface}, inset 0 0 0 9px ${theme.colors.softInfo}, ${theme.shadow.feature}`}
      : theme.id === "deep-signal"
        ? {border: `1px solid ${VIDEO_COLORS.line}`, borderTop: `7px solid ${VIDEO_COLORS.ink}`}
        : {border: `3px solid ${VIDEO_COLORS.ink}`};

  return (
    <>
      {soundEnabled ? Array.from({length: Math.ceil(typingFrames / bedFrames)}, (_, index) => {
        const offset = index * bedFrames;
        return <Sequence key={offset} from={revealStart + offset} durationInFrames={Math.min(bedFrames, typingFrames - offset)} layout="none"><Audio src={staticFile("sfx/typing-bed.wav")} volume={0.38} /></Sequence>;
      }) : null}
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
          background: VIDEO_SURFACES.feature,
          borderRadius: VIDEO_RADIUS.feature,
          boxShadow: VIDEO_SHADOW.feature,
          ...frameStyle,
          minHeight: 300,
        }}
      >
        <div style={{filter: handwriting ? `url(#${filterId})` : undefined}}><ProtectedText visibleCharacters={visibleCharacters}>{text}</ProtectedText></div>
      </div>
    </>
  );
};
