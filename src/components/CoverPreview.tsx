"use client";

import {Player} from "@remotion/player";
import {AbsoluteFill} from "remotion";
import type {CoverConfig, RenderManifest} from "@/remotion/schema";
import {CoverOpening} from "@/remotion/CoverOpening";
import {Fonts} from "@/remotion/Fonts";
import {VisualThemeProvider} from "@/remotion/theme";
import type {VisualStyleId} from "@/remotion/visual-style";

const CoverComposition: React.FC<{
  brand: RenderManifest["brand"];
  presenter?: RenderManifest["presenter"];
  cover: CoverConfig;
  visualStyle?: VisualStyleId;
}> = ({brand, presenter, cover, visualStyle}) => (
  <VisualThemeProvider styleId={visualStyle} scope="cover"><AbsoluteFill>
    <Fonts>
      <CoverOpening brand={brand} presenter={presenter} cover={cover} />
    </Fonts>
  </AbsoluteFill></VisualThemeProvider>
);

// 封面预览固定在完整首帧，与成片第 0 帧使用同一组件。
export const CoverPreview: React.FC<{
  brand: RenderManifest["brand"];
  presenter?: RenderManifest["presenter"];
  cover: CoverConfig;
  visualStyle?: VisualStyleId;
}> = ({brand, presenter, cover, visualStyle}) => (
  <div className="cover-preview-player">
    <Player
      component={CoverComposition}
      inputProps={{brand, presenter, cover, visualStyle}}
      durationInFrames={1}
      compositionWidth={1080}
      compositionHeight={1260}
      fps={30}
      controls
      style={{aspectRatio: "1080 / 1260", width: "100%"}}
    />
  </div>
);
