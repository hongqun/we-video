import {Composition} from "remotion";
import {calculateVideoMetadata} from "./metadata";
import {renderManifestSchema} from "./schema";
import {ShortVideo} from "./ShortVideo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TechShortVideo"
        component={ShortVideo}
        durationInFrames={330}
        fps={30}
        width={1080}
        height={1260}
        schema={renderManifestSchema}
        calculateMetadata={calculateVideoMetadata}
        defaultProps={{
        schemaVersion: "1.0",
        contentMode: "narration",
        jobId: "studio-sample",
        revision: 1,
        contentProfile: {accountId: "builtin", seriesId: "general", accountVersion: "1", seriesVersion: "1"},
        title: "从回答问题到完成任务",
        visualStyle: "kinetic-lime",
        summary: "人工智能代理不只负责回答问题，还能理解目标、规划步骤并调用工具完成任务。视频将介绍它与普通聊天机器人的核心区别，以及可靠执行任务所需要的能力。",
        captionStyle: "narration",
        video: {width: 1080, height: 1260, fps: 30, outroDurationMs: 0},
        narration: {text: "人工智能代理不只是回答问题。", audioSrc: "", spokenDurationMs: 40000, durationMs: 40630, model: "sample", voice: "sample"},
        captions: [{text: "人工智能代理不只是回答问题。", startMs: 180, endMs: 39980, timestampMs: 20080, confidence: null}],
        scenes: [{
          id: "scene-01",
          segmentId: "narration-01",
          startMs: 0,
          endMs: 40630,
          speechStartMs: 180,
          speechEndMs: 40180,
          pauseAfterMs: 450,
          // eslint-disable-next-line @remotion/non-pure-animation
          transition: {kind: "fade", durationMs: 315},
          spokenText: "人工智能代理不只是回答问题。",
          content: {title: "不只是聊天", subtitle: "它能真正把任务做完", text: "从回答问题走向完成任务", keywords: ["理解目标", "规划步骤", "调用工具"]},
          templateId: "rve/generic-content",
          rollType: "b-roll",
          presenterMode: "hidden",
          presenterPoseId: "",
          presenterPlacement: "right-lower",
          presenterFraming: "full",
        }],
        brand: {logoSrc: "", title: "", subtitle: "", downloadPrefix: "we-video"},
        }}
      />
    </>
  );
};
