import {AbsoluteFill, Easing, interpolate, interpolateColors, Sequence, useCurrentFrame, useVideoConfig} from "remotion";
import type {Caption, CaptionStyle, VideoScene} from "./schema";
import {SANS_FONT_FAMILY, SERIF_FONT_FAMILY} from "./typography";
import {VIDEO_COLORS, VIDEO_RADIUS, VIDEO_SHADOW, VIDEO_TYPE, useVisualTheme} from "./theme";

export type CaptionPage = {
  startMs: number;
  endMs: number;
  tokens: Caption[];
};

const captionStyles: Record<CaptionStyle, {
  inactiveColor: string;
  containerPadding: string;
  box: React.CSSProperties;
}> = {
  narration: {
    // 漫画纸面与硬阴影只替换字幕外观，字号和时间绑定保持原样。
    // 不用 backdrop-filter：headless 渲染下毛玻璃效果不可靠，会导致预览与成片不一致。
    inactiveColor: VIDEO_COLORS.ink,
    containerPadding: "0 96px 96px",
    box: {
      backgroundColor: VIDEO_COLORS.surfaceStrong,
      border: `2px solid ${VIDEO_COLORS.ink}`,
      borderLeft: `4px solid ${VIDEO_COLORS.accent}`,
      borderRadius: 12,
      boxShadow: VIDEO_SHADOW.card,
      fontSize: VIDEO_TYPE.caption,
      fontWeight: 550,
      letterSpacing: 0.35,
      maxWidth: 888,
      padding: "9px 19px 11px 16px",
    },
  },
  clean: {
    inactiveColor: VIDEO_COLORS.ink,
    containerPadding: "0 112px 96px",
    box: {
      backgroundColor: VIDEO_COLORS.surfaceGlass,
      border: `2px solid ${VIDEO_COLORS.ink}`,
      borderLeft: `3px solid ${VIDEO_COLORS.accent}`,
      borderRadius: VIDEO_RADIUS.small,
      boxShadow: VIDEO_SHADOW.card,
      fontSize: 36,
      fontWeight: 650,
      letterSpacing: 0.2,
      maxWidth: 856,
      padding: "9px 18px 11px",
    },
  },
  impact: {
    inactiveColor: VIDEO_COLORS.surface,
    containerPadding: "0 72px 92px",
    box: {
      backgroundColor: VIDEO_COLORS.inkStrong,
      border: `2px solid ${VIDEO_COLORS.accent}`,
      borderRadius: VIDEO_RADIUS.card,
      boxShadow: VIDEO_SHADOW.active,
      fontSize: VIDEO_TYPE.caption,
      fontWeight: 800,
      letterSpacing: -0.5,
      maxWidth: 936,
      padding: "16px 27px 18px",
    },
  },
};

const isAsciiWord = (text: string) => /^[A-Za-z0-9+#._/'’-]+$/.test(text);
const sentenceEnd = /[。！？；!?]$/;

/**
 * 供应商偶尔会把单个汉字标成数秒长，后续字符却仍连续落在同一句末尾。
 * 这里只重排渲染用副本，保持原字幕、音频和场景时间轴不变。
 */
const repairHeldCaptionRuns = (captions: Caption[]): Caption[] => {
  const repaired: Caption[] = [];
  for (let index = 0; index < captions.length;) {
    const current = captions[index]!;
    const next = captions[index + 1];
    const isHeldSingleCharacter = /\p{Script=Han}/u.test(current.text)
      && Array.from(current.text).length === 1
      && current.endMs - current.startMs > 1_200
      && Boolean(next && next.startMs - current.endMs <= 120);
    if (!isHeldSingleCharacter) {
      repaired.push(current);
      index += 1;
      continue;
    }

    let endIndex = index;
    while (endIndex < captions.length - 1 && !sentenceEnd.test(captions[endIndex]!.text)) {
      const following = captions[endIndex + 1]!;
      if (following.startMs - captions[endIndex]!.endMs > 240) break;
      endIndex += 1;
    }
    const run = captions.slice(index, endIndex + 1);
    const runEnd = run.at(-1)!.endMs;
    const characterCount = run.reduce((total, caption) => total + Array.from(caption.text).length, 0);
    if (run.length < 2 || characterCount < 2 || runEnd <= current.startMs) {
      repaired.push(current);
      index += 1;
      continue;
    }

    let consumed = 0;
    for (const caption of run) {
      const length = Array.from(caption.text).length;
      const startMs = current.startMs + Math.round((runEnd - current.startMs) * consumed / characterCount);
      consumed += length;
      const endMs = current.startMs + Math.round((runEnd - current.startMs) * consumed / characterCount);
      repaired.push({...caption, startMs, endMs, timestampMs: Math.round((startMs + endMs) / 2)});
    }
    index = endIndex + 1;
  }
  return repaired;
};

/**
 * 英文词级时间戳偶尔会把数秒时长堆到前两个词，再把句尾多个词压到几十毫秒。
 * 只对同时满足“长词 + 连续短词”的句内片段重排显示时间，不改写落盘字幕和场景边界。
 */
const repairHeldEnglishRuns = (captions: Caption[]): Caption[] => {
  const repaired: Caption[] = [];
  const englishSentenceEnd = /[.!?]$/;
  const isEnglishToken = (caption: Caption) => /[A-Za-z]/.test(caption.text);
  for (let index = 0; index < captions.length;) {
    const current = captions[index]!;
    const held = isEnglishToken(current) && current.endMs - current.startMs > 1_200;
    if (!held) {
      repaired.push(current);
      index += 1;
      continue;
    }

    let endIndex = index;
    while (endIndex < captions.length - 1 && endIndex - index < 31 && !englishSentenceEnd.test(captions[endIndex]!.text)) {
      const following = captions[endIndex + 1]!;
      if (following.startMs - captions[endIndex]!.endMs > 240) break;
      endIndex += 1;
    }
    const run = captions.slice(index, endIndex + 1);
    const englishWords = run.filter(isEnglishToken);
    const compressedWords = englishWords.filter((caption) => caption.endMs - caption.startMs < 80);
    const runEnd = run.at(-1)!.endMs;
    // 多个极短词用于区分真实拖音；没有明显挤压时继续信任供应商时间戳。
    if (englishWords.length < 6 || compressedWords.length < 3 || runEnd <= current.startMs) {
      repaired.push(current);
      index += 1;
      continue;
    }

    const weights = run.map((caption) => Math.max(1, [...caption.text].filter((character) => /[A-Za-z0-9]/.test(character)).length));
    const totalWeight = weights.reduce((total, weight) => total + weight, 0);
    let consumedWeight = 0;
    run.forEach((caption, runIndex) => {
      const startMs = current.startMs + Math.round((runEnd - current.startMs) * consumedWeight / totalWeight);
      consumedWeight += weights[runIndex]!;
      const endMs = current.startMs + Math.round((runEnd - current.startMs) * consumedWeight / totalWeight);
      repaired.push({...caption, startMs, endMs, timestampMs: Math.round((startMs + endMs) / 2)});
    });
    index = endIndex + 1;
  }
  return repaired;
};

export const normalizeCaptionTokens = (captions: Caption[]): Caption[] => {
  const byTextAndStart = new Map<string, Caption>();
  for (const caption of captions) {
    const text = caption.text.trim();
    if (!text) continue;
    const key = `${caption.startMs}:${text}`;
    const current = byTextAndStart.get(key);
    if (!current || caption.endMs > current.endMs) byTextAndStart.set(key, {...caption, text});
  }

  const split = [...byTextAndStart.values()]
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)
    .flatMap((caption) => {
      const runs: string[] = [];
      for (const character of [...caption.text]) {
        // 英文单词保持整体出现；中文逐字拆开，才能识别事件内部的标点并应用页上限。
        if (runs.length > 0 && isAsciiWord(runs.at(-1)!) && isAsciiWord(character)) runs[runs.length - 1] += character;
        else runs.push(character);
      }
      if (runs.length === 1) return [caption];
      const length = [...caption.text].length;
      const duration = caption.endMs - caption.startMs;
      let consumed = 0;
      return runs.map((text) => {
        const startMs = caption.startMs + Math.round((duration * consumed) / length);
        consumed += [...text].length;
        const endMs = caption.startMs + Math.round((duration * consumed) / length);
        return {...caption, text, startMs, endMs, timestampMs: Math.round((startMs + endMs) / 2)};
      });
    });

  // 供应商的英文字幕通常已经按单词返回；不要跨 caption 猜测并拼接单词，
  // 否则连续时间区间会把 “Hello everyone” 变成 “Helloeveryone”。
  // 字符级英文兜底由 TTS 对齐层负责合并；渲染层仅校正明确的长词/短词挤压异常。
  return repairHeldEnglishRuns(repairHeldCaptionRuns(split));
};

export const paginateChineseCaptions = (captions: Caption[]): CaptionPage[] => {
  const maxCharacters = 20;
  // 单个供应商事件也不能突破单页上限，超长事件按原时间区间等比例拆分。
  const normalized = normalizeCaptionTokens(captions).flatMap((caption) => {
    const characters = [...caption.text];
    if (characters.length <= maxCharacters) return [caption];
    return Array.from({length: Math.ceil(characters.length / maxCharacters)}, (_, index) => {
      const start = index * maxCharacters;
      const end = Math.min(characters.length, start + maxCharacters);
      const startMs = caption.startMs + Math.round((caption.endMs - caption.startMs) * start / characters.length);
      const endMs = caption.startMs + Math.round((caption.endMs - caption.startMs) * end / characters.length);
      return {...caption, text: characters.slice(start, end).join(""), startMs, endMs, timestampMs: Math.round((startMs + endMs) / 2)};
    });
  });
  const pages: CaptionPage[] = [];
  let tokens: Caption[] = [];
  let characters = 0;
  const minimumCharacters = 8;
  const clauseEnd = /[，、：；,;]$/;
  const flush = () => {
    if (!tokens.length) return;
    pages.push({startMs: tokens[0].startMs, endMs: tokens[tokens.length - 1].endMs, tokens});
    tokens = [];
    characters = 0;
  };
  normalized.forEach((caption) => {
    const previous = tokens.at(-1);
    if (previous && caption.startMs - previous.endMs > 240) flush();
    // 标点优先，但先切开会超过上限的内容，保证每页最多 maxCharacters 字。
    if (tokens.length && characters + [...caption.text].length > maxCharacters) flush();
    tokens.push(caption);
    characters += [...caption.text].length;
    const punctuation = sentenceEnd.test(caption.text);
    const pageText = tokens.map((token) => token.text).join("");
    // “第一，”这类序号引导词不能独占一页；普通短分句（如“要搞懂它，”）要保留语义停顿。
    const enumerationLead = /^(第[一二三四五六七八九十]+|首先|其次|最后)[，,]$/.test(pageText);
    const clauseBreak = clauseEnd.test(caption.text) && !enumerationLead;
    // 句末和普通分句标点无条件收页，只有序号引导词继续收集后文。
    if (punctuation || clauseBreak || characters >= maxCharacters) {
      flush();
    }
  });
  flush();
  // 最长时长可能在句中留下短前缀；优先与下一页合并，避免字幕节奏碎裂。
  for (let index = 0; index < pages.length - 1;) {
    const page = pages[index];
    const next = pages[index + 1];
    const pageCharacters = page.tokens.reduce((total, token) => total + [...token.text].length, 0);
    const nextCharacters = next.tokens.reduce((total, token) => total + [...token.text].length, 0);
    const canMerge = pageCharacters < minimumCharacters &&
      page.tokens.length > 0 &&
      next.tokens.length > 0 &&
      !sentenceEnd.test(page.tokens.at(-1)!.text) &&
      !clauseEnd.test(page.tokens.at(-1)!.text) &&
      page.endMs === next.startMs &&
      pageCharacters + nextCharacters <= maxCharacters;
    if (!canMerge) {
      index += 1;
      continue;
    }
    pages.splice(index, 2, {startMs: page.startMs, endMs: next.endMs, tokens: [...page.tokens, ...next.tokens]});
  }
  return pages;
};

const CAPTION_NUDGE_PEAK_FRAME = 4;
const CAPTION_NUDGE_FRAMES = 12;

/**
 * 字幕页先完整预显，字级时间戳只负责触发一次轻微拨动。
 * 使用帧计算而不是 CSS 动画，保证 Player 拖动和 Remotion 渲染可复现。
 */
export const captionTokenMotion = (elapsedFrames: number) => {
  if (elapsedFrames < 0) return {translateY: 0, rotate: 0, opacity: 0.72};
  const progress = Math.min(elapsedFrames, CAPTION_NUDGE_FRAMES);
  return {
    // 只向上提一下再归位，给“拨动”明确的方向感，完全避免横向抖动。
    translateY: interpolate(progress, [0, CAPTION_NUDGE_PEAK_FRAME, CAPTION_NUDGE_FRAMES], [3, -1, 0], {
      // 前后都逐渐加速、减速，避免在反向点产生突兀的停顿。
      easing: Easing.inOut(Easing.cubic),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
    // 整页文字保持可见，当前字短暂淡入提亮，再淡出回到预显状态。
    opacity: interpolate(progress, [0, CAPTION_NUDGE_PEAK_FRAME, CAPTION_NUDGE_FRAMES], [0.72, 1, 0.72], {
      easing: Easing.inOut(Easing.cubic),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
    rotate: interpolate(progress, [0, CAPTION_NUDGE_PEAK_FRAME, CAPTION_NUDGE_FRAMES], [-0.4, 0.2, 0], {
      easing: Easing.inOut(Easing.cubic),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  };
};

/** 当前读到的字短暂染上品牌色，随后平滑回到字幕基色。 */
export const captionTokenColor = (elapsedFrames: number, baseColor: string, accentColor: string = VIDEO_COLORS.accent) => {
  if (elapsedFrames < 0) return baseColor;
  return interpolateColors(
    Math.min(elapsedFrames, CAPTION_NUDGE_FRAMES),
    [0, CAPTION_NUDGE_PEAK_FRAME, CAPTION_NUDGE_FRAMES],
    [baseColor, accentColor, baseColor],
    {easing: Easing.inOut(Easing.cubic)},
  );
};

const CaptionPageView: React.FC<{page: CaptionPage; captionStyle: CaptionStyle; startFrame: number}> = ({page, captionStyle, startFrame}) => {
  const selectedStyle = captionStyles[captionStyle];
  const theme = useVisualTheme();
  const {fps} = useVideoConfig();
  const frame = useCurrentFrame();
  // 以 Sequence 的绝对起始帧换算当前时间；页起点经 ceil 取整，若直接用 page.startMs 会引入 0~1 帧偏差。
  const currentMs = ((startFrame + frame) / fps) * 1000;
  return (
    <AbsoluteFill style={{alignItems: "center", justifyContent: "flex-end", padding: selectedStyle.containerPadding}}>
      <div
        style={{
          ...selectedStyle.box,
          color: selectedStyle.inactiveColor,
          // 中文采用编辑感更强的衬线体，英文和代码词保留无衬线体，避免整块字幕像后台 UI。
          fontFamily: SERIF_FONT_FAMILY,
          lineHeight: 1.42,
          textAlign: "center",
          whiteSpace: "nowrap",
        }}
      >
        {page.tokens.map((token, index) => {
          const elapsedFrames = ((currentMs - token.startMs) / 1000) * fps;
          const motion = captionTokenMotion(elapsedFrames);
          // 颜色插值必须使用实际色值，CSS 变量只用于普通样式继承。
          const inactiveColor = captionStyle === "impact" ? theme.colors.surface : theme.colors.ink;
          const color = captionTokenColor(elapsedFrames, inactiveColor, theme.colors.accent);
          return (
            <span
              key={`${token.startMs}-${token.endMs}-${index}`}
              style={{
                display: "inline-block",
                fontFamily: isAsciiWord(token.text) ? SANS_FONT_FAMILY : undefined,
                color,
                fontWeight: isAsciiWord(token.text) ? 600 : undefined,
                // 英文 token 用相邻词的左边距分词，避免在逗号、句号前留下中文式空格。
                marginLeft: isAsciiWord(token.text) && index > 0 && (isAsciiWord(page.tokens[index - 1]!.text) || /^[.!?,;:]+$/.test(page.tokens[index - 1]!.text)) ? "0.24em" : undefined,
                // 整页文字始终可见，只有到达字级时间戳的 token 做一次短促拨动。
                transform: `translateY(${motion.translateY}px) rotate(${motion.rotate}deg)`,
                opacity: motion.opacity,
              }}
            >
              {token.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const sceneSpeechEndForPage = (page: CaptionPage, scenes: VideoScene[]) => {
  const scene = scenes.find((candidate) => {
    const speechStartMs = candidate.speechStartMs ?? candidate.startMs;
    const speechEndMs = candidate.speechEndMs ?? candidate.endMs;
    return page.startMs >= speechStartMs && page.startMs < speechEndMs;
  });
  return scene ? scene.speechEndMs ?? scene.endMs : undefined;
};

export const captionPageSequenceTiming = ({
  page,
  nextStartMs,
  narrationDurationMs,
  scenes,
  fps,
}: {
  page: CaptionPage;
  nextStartMs: number;
  narrationDurationMs: number;
  scenes: VideoScene[];
  fps: number;
}) => {
  const sceneSpeechEndMs = scenes.length > 0
    ? sceneSpeechEndForPage(page, scenes)
    : narrationDurationMs;
  if (sceneSpeechEndMs === undefined) return null;

  const endMs = Math.min(page.endMs + 160, nextStartMs, sceneSpeechEndMs, narrationDurationMs);
  // A frame is visible for its whole frame interval. Rounding the start down
  // would expose the caption just before speech begins, inside the pause.
  const from = Math.ceil((page.startMs / 1000) * fps);
  const until = Math.ceil((endMs / 1000) * fps);
  if (until <= from) return null;
  return {from, durationInFrames: until - from};
};

export const Captions: React.FC<{captions: Caption[]; narrationDurationMs: number; scenes?: VideoScene[]; style?: CaptionStyle}> = ({captions, narrationDurationMs, scenes = [], style = "narration"}) => {
  const {fps} = useVideoConfig();
  const pages = paginateChineseCaptions(captions);
  return (
    <AbsoluteFill>
      {pages.map((page, index) => {
        const nextStart = pages[index + 1]?.startMs ?? narrationDurationMs;
        const timing = captionPageSequenceTiming({page, nextStartMs: nextStart, narrationDurationMs, scenes, fps});
        if (!timing) return null;
        return (
          <Sequence key={`${page.startMs}-${index}`} from={timing.from} durationInFrames={timing.durationInFrames} name={`字幕 ${index + 1}`}>
            <CaptionPageView page={page} captionStyle={style} startFrame={timing.from} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
