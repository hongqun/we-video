import path from "node:path";
import {readJob, readJson, revisionDir} from "./jobs";
import {loadCoverImageRequirementTemplate, loadVisualRequirementTemplate} from "./narration-prompts";
import {readJobPlatformProfile} from "./profile";
import {saveVisualResource} from "./visual-resources";

type Segment = {id: string; spokenText: string; pauseAfter?: string};

export const generateVisualRequirement = async (jobId: string, segmentId: string, transparentBackground = true, sceneSpokenText?: string) => {
  const job = await readJob(jobId);
  const directory = revisionDir(jobId, job.currentRevision);
  const draft = await readJson<Record<string, unknown>>(path.join(directory, "draft.json"));
  const segments = Array.isArray(draft.narrationSegments) ? draft.narrationSegments as Segment[] : [];
  const index = segments.findIndex((segment) => segment.id === segmentId);
  if (index < 0) throw new Error("未找到目标口播段落");
  const profile = await readJobPlatformProfile(job.contentProfile);
  // 拆分镜头时优先注入当前视觉镜头的裁剪口播；旧入口不传时才使用完整段落。
  const template = await loadVisualRequirementTemplate(profile, transparentBackground);
  const spokenText = sceneSpokenText?.trim() || segments[index]!.spokenText;
  const visualRequirement = template.replaceAll("{{SPOKEN_TEXT}}", spokenText).trim();
  if (!visualRequirement) throw new Error("视觉要求模板为空");
  return {segmentId, visualRequirement, fromRevision: job.currentRevision};
};

export const generateCoverImageRequirement = async (jobId: string) => {
  const job = await readJob(jobId);
  const directory = revisionDir(jobId, job.currentRevision);
  const plan = await readJson<{cover?: {title?: string}}>(path.join(directory, "visual-plan.json"));
  const title = typeof plan.cover?.title === "string" ? plan.cover.title.trim() : "";
  if (!title) throw new Error("封面标题为空，无法生成封面图片要求");
  const profile = await readJobPlatformProfile(job.contentProfile);
  const template = await loadCoverImageRequirementTemplate(profile);
  const visualRequirement = template.replaceAll("{{COVER_TITLE}}", title).trim();
  if (!visualRequirement) throw new Error("封面图片要求模板为空");
  return {visualRequirement, coverTitle: title, fromRevision: job.currentRevision};
};

export const saveSegmentPolygons = async (jobId: string, segmentId: string, polygons: unknown, sceneId?: string) => {
  if (!Array.isArray(polygons)) throw new Error("polygons 必须是数组");
  return saveVisualResource(jobId, segmentId, {polygons}, sceneId);
};
