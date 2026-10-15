import {useCurrentFrame, useVideoConfig} from "remotion";
import type {RenderManifest} from "./schema";
import {ParticleBrandOutro} from "./ParticleBrandOutro";

export const Outro: React.FC<{brand: RenderManifest["brand"]; durationInFrames: number}> = ({brand, durationInFrames}) => {
  const frame = useCurrentFrame();
  const {height} = useVideoConfig();
  return <ParticleBrandOutro brand={brand} canvasHeight={height} frame={frame} outroFrames={durationInFrames} showPrompt />;
};
