import type {ArtifactManifest, RenderManifest} from "@/remotion/schema";

export type ReviewAudioStatus = "missing" | "stale" | "synthesizing" | "review" | "planning" | "ready" | "failed";

export type ReviewSceneWindow = Pick<RenderManifest["scenes"][number], "id" | "startMs" | "endMs">;

export const DRAFT_SCENE_DURATION_MS = 8_000;

const stableJson = (value: unknown) => JSON.stringify(value);

/** 口播与视觉分别计算变更，视觉标注不应让既有音频失效。 */
export const audioDraftSignature = (draft: unknown) => {
  if (!draft || typeof draft !== "object") return "";
  const value = draft as Record<string, unknown>;
  const {narrationSegments, scenes, title, shortTitle, summary, captionStyle, language, ...rest} = value;
  const spoken = Array.isArray(narrationSegments)
    ? narrationSegments.map((segment) => {
      if (!segment || typeof segment !== "object") return segment;
      const audioSegment = {...segment as Record<string, unknown>};
      delete audioSegment.imagePath;
      // 图片尺寸属于视觉资源，不应触发口播重新合成。
      delete audioSegment.imageWidth;
      delete audioSegment.imageHeight;
      delete audioSegment.polygons;
      return audioSegment;
    })
    : Array.isArray(scenes)
      ? scenes.map((scene) => ({spokenText: (scene as Record<string, unknown>).spokenText}))
      : scenes;
  return stableJson({title, shortTitle, summary, captionStyle, language, narrationSegments: spoken, ...rest});
};

export const sceneIdAtTime = (scenes: readonly ReviewSceneWindow[], timeMs: number): string | null => {
  if (timeMs < 0 || !scenes.length) return null;
  return scenes.find((scene) => timeMs >= scene.startMs && timeMs < scene.endMs)?.id ?? null;
};

export const sceneIndexAtTime = (scenes: readonly ReviewSceneWindow[], timeMs: number): number => {
  if (timeMs < 0) return -1;
  return scenes.findIndex((scene) => timeMs >= scene.startMs && timeMs < scene.endMs);
};

export const draftSceneStartFrame = (index: number, fps = 30): number =>
  Math.max(0, Math.round((index * DRAFT_SCENE_DURATION_MS / 1000) * fps));

export const manifestSceneStartFrame = (scene: ReviewSceneWindow, fps = 30): number =>
  Math.max(0, Math.round((scene.startMs / 1000) * fps));

export const narrationWorkflowStep = (jobState?: string): number => {
  if (!jobState) return 1;
  // 派生任务先完成全文审核，确认后才进入既有第二步审稿。
  if (["translating", "awaiting_translation_review", "segmenting_translation"].includes(jobState)) return 1;
  if (["drafting", "awaiting_script_review", "awaiting_review", "failed"].includes(jobState)) return 2;
  if (["synthesizing", "awaiting_audio_review"].includes(jobState)) return 3;
  if (["awaiting_visual_resources", "planning_visuals", "finalizing_visuals", "awaiting_visual_review"].includes(jobState)) return 4;
  if (jobState === "ready") return 5;
  if (["rendering", "completed"].includes(jobState)) return 6;
  return 2;
};

export type ReviewAudioStatusInput = {
  draftChanged: boolean;
  selectedRevision: number | null;
  currentRevision: number;
  jobState: string;
  manifest: ArtifactManifest | null;
  voiceId?: string;
};

export const reviewAudioStatus = ({
  draftChanged,
  selectedRevision,
  currentRevision,
  jobState,
  manifest,
  voiceId,
}: ReviewAudioStatusInput): ReviewAudioStatus => {
  if (jobState === "synthesizing") return "synthesizing";
  if (jobState === "planning_visuals") return "planning";
  if (jobState === "awaiting_audio_review") return "review";
  if (draftChanged) return "stale";
  if (!manifest || manifest.revision !== selectedRevision) {
    return jobState === "failed" ? "failed" : "missing";
  }
  if (selectedRevision === currentRevision && manifest.contentMode === "narration" && voiceId && manifest.narration.voice !== voiceId) {
    return "stale";
  }
  return "ready";
};

export const reviewAudioStatusLabel: Record<ReviewAudioStatus, string> = {
  missing: "未生成",
  stale: "配音已过期",
  synthesizing: "正在生产配音",
  review: "待确认音频",
  planning: "正在规划画面",
  ready: "配音已就绪",
  failed: "配音失败",
};
