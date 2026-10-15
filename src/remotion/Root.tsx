import {Composition} from "remotion";
import {calculateVideoMetadata} from "./metadata";
import {renderManifestSchema} from "./schema";
import {ShortVideo} from "./ShortVideo";
import {MathVideo} from "./MathVideo";
import {mathManifestSchema} from "./math-schema";
import {mathDurationInFrames} from "./math-timing";
import {MATH_BODY_DURATION_MS} from "../math/duration";
import {MATH_MUSIC_DEFAULT_SRC} from "../math/music";

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
        contentProfile: {accountId: "tech123", seriesId: "tech-minute", accountVersion: "1", seriesVersion: "1"},
        title: "从回答问题到完成任务",
        visualStyle: "kinetic-lime",
        summary: "人工智能代理不只负责回答问题，还能理解目标、规划步骤并调用工具完成任务。视频将介绍它与普通聊天机器人的核心区别，以及可靠执行任务所需要的能力。",
        captionStyle: "narration",
        video: {width: 1080, height: 1260, fps: 30, outroDurationMs: 3000},
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
          templateId: "ip/opening-stage",
          rollType: "a-roll",
          presenterMode: "hero",
          presenterPoseId: "neutral",
          presenterPlacement: "hero",
          presenterFraming: "full",
        }],
        brand: {logoSrc: "profile-assets/tech123/logo.png", title: "Tech123", subtitle: "科学·科技·科创", label: "TECH123 · 科技一分钟", downloadPrefix: "tech123-video"},
        }}
      />
      <Composition
        id="TechMathVideo"
        component={MathVideo}
        durationInFrames={mathDurationInFrames(MATH_BODY_DURATION_MS, 3000, 30)}
        fps={30}
        width={1080}
        height={1260}
        schema={mathManifestSchema}
        calculateMetadata={({props}) => ({
          durationInFrames: mathDurationInFrames(props.formula.plot.drawDurationMs, props.video.outroDurationMs, props.video.fps),
          width: props.video.width,
          height: props.video.height,
          fps: props.video.fps,
        })}
        defaultProps={{
          schemaVersion: "1.0",
          contentMode: "math",
          jobId: "math-sample",
          revision: 1,
          contentProfile: {accountId: "tech123", seriesId: "math-beautiful", accountVersion: "1", seriesVersion: "1"},
          title: "帕斯卡蜗线",
          summary: "帕斯卡蜗线的参数化绘制。",
          outroVariant: "orbit-trace",
          video: {width: 1080, height: 1260, fps: 30, outroDurationMs: 3000},
          formula: {id: "limacon", latex: "r = b + a\\cos\\theta", parameters: {a: 5, b: 4}, plot: {xMin: -10, xMax: 10, yMin: -8, yMax: 8, drawDurationMs: MATH_BODY_DURATION_MS}},
          musicSrc: MATH_MUSIC_DEFAULT_SRC,
          brand: {logoSrc: "profile-assets/tech123/logo.png", title: "Tech123", subtitle: "科学·科技·科创", label: "TECH123 · 数学之美", downloadPrefix: "tech123-math"},
        }}
      />
    </>
  );
};
