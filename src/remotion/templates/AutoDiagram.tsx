import {useId, useMemo} from "react";
import {useCurrentFrame, useVideoConfig} from "remotion";
import type {Caption, VideoScene} from "../schema";
import {diagramDataSchema, diagramSchedule, diagramSvgAtFrame} from "./auto-diagram-schema";

// 完整图、播放器和成片共用帧计算；拖动时间轴不依赖墙钟或 SVG 自带动画。
export const AutoDiagram: React.FC<{scene: VideoScene; captions: Caption[]; complete?: boolean}> = ({scene, captions, complete = false}) => {
  const namespace = useId().replace(/[^a-zA-Z0-9]/g, "");
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const data = useMemo(() => diagramDataSchema.parse(scene.templateData), [scene.templateData]);
  const schedule = useMemo(() => diagramSchedule(scene, captions, data, fps), [scene, captions, data, fps]);
  const svg = useMemo(() => diagramSvgAtFrame(data, schedule, frame, complete, namespace), [data, schedule, frame, complete, namespace]);
  return <div style={{width: "100%", aspectRatio: "960 / 800"}} dangerouslySetInnerHTML={{__html: svg}} />;
};
