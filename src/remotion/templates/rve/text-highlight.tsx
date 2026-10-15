/** Free Remotion Template Component
 * ---------------------------------
 * This template is free to use in your projects!
 * Credit appreciated but not required.
 *
 * Created by the team at https://www.reactvideoeditor.com
 *
 * Happy coding and building amazing videos! 🎉
 */

"use client";

import { useCurrentFrame, interpolate, useVideoConfig } from "remotion";

export default function TextHighlight() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const words = ["Build", "amazing", "videos", "with", "code"];
  const framesPerWord = Math.floor(fps * 0.6);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "linear-gradient(180deg, #111827, #1f2937)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
        fontFamily: "Inter, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "center",
          gap: "16px",
          maxWidth: "700px",
          padding: "40px",
        }}
      >
        {words.map((word, i) => {
          const wordStart = i * framesPerWord;
          const highlightProgress = interpolate(
            frame,
            [wordStart, wordStart + framesPerWord * 0.5],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );

          const isHighlighted = highlightProgress > 0;

          return (
            <span
              key={i}
              style={{
                position: "relative",
                display: "inline-block",
                fontSize: "3.5rem",
                fontWeight: "bold",
                color: "white",
                padding: "4px 12px",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${highlightProgress * 100}%`,
                  background: "linear-gradient(135deg, #3b82f6, #7209b7)",
                  borderRadius: "6px",
                  zIndex: 0,
                  opacity: isHighlighted ? 0.85 : 0,
                }}
              />
              <span style={{ position: "relative", zIndex: 1 }}>{word}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
