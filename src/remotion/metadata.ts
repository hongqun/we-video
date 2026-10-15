import type {CalculateMetadataFunction} from "remotion";
import type {RenderManifest} from "./schema";

export const getDurationInFrames = (props: RenderManifest) =>
  Math.ceil(((props.narration.durationMs + props.video.outroDurationMs) / 1000) * props.video.fps);

export const calculateVideoMetadata: CalculateMetadataFunction<RenderManifest> = ({props}) => {
  return {
    durationInFrames: getDurationInFrames(props),
    defaultOutName: `${props.jobId}-r${String(props.revision).padStart(3, "0")}`,
    defaultCodec: "h264",
  };
};
