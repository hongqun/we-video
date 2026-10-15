export const MATH_OPENING_COVER_DURATION_MS = 500;
export const MATH_FINAL_HOLD_DURATION_MS = 500;
export const MATH_COVER_FADE_FRAMES = 8;
export const MATH_OUTRO_TRANSITION_FRAMES = 12;

export type MathTiming = {
  coverFrames: number;
  drawFrames: number;
  finalHoldFrames: number;
  outroFrames: number;
  drawStartFrame: number;
  drawEndFrame: number;
  outroTransitionStartFrame: number;
  outroStartFrame: number;
  durationInFrames: number;
};

export const getMathTiming = (
  drawDurationMs: number,
  outroDurationMs: number,
  fps: number,
): MathTiming => {
  const coverFrames = Math.ceil((MATH_OPENING_COVER_DURATION_MS / 1000) * fps);
  const drawFrames = Math.ceil((drawDurationMs / 1000) * fps);
  const finalHoldFrames = Math.ceil((MATH_FINAL_HOLD_DURATION_MS / 1000) * fps);
  const outroFrames = Math.ceil((outroDurationMs / 1000) * fps);
  const bodyStartFrame = coverFrames;
  const bodyEndFrame = bodyStartFrame + drawFrames;
  const localDrawStartFrame = Math.min(
    Math.max(18, Math.round(drawFrames * 0.08)),
    Math.max(coverFrames, drawFrames - 1),
  );
  const drawStartFrame = bodyStartFrame + localDrawStartFrame;
  const drawEndFrame = Math.max(
    drawStartFrame + 1,
    bodyEndFrame - finalHoldFrames,
  );
  const outroTransitionStartFrame = bodyEndFrame;
  const outroStartFrame = outroTransitionStartFrame + MATH_OUTRO_TRANSITION_FRAMES;

  return {
    coverFrames,
    drawFrames,
    finalHoldFrames,
    outroFrames,
    drawStartFrame,
    drawEndFrame,
    outroTransitionStartFrame,
    outroStartFrame,
    durationInFrames: outroStartFrame + outroFrames,
  };
};

export const mathDurationInFrames = (
  drawDurationMs: number,
  outroDurationMs: number,
  fps: number,
) => getMathTiming(drawDurationMs, outroDurationMs, fps).durationInFrames;
