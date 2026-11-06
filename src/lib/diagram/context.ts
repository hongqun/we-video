import {createHash} from "node:crypto";
import path from "node:path";
import {jobDir, readJson, readJob} from "../jobs";
import {readVisualPlan, deriveScenes, type VisualPlan} from "../visual-plan";
import {readJobPlatformProfile} from "../profile";
import {readVisualResources} from "../visual-resources";
import type {RenderManifest} from "../../remotion/schema";
import {resolveVideoTheme} from "../../remotion/visual-style";
import {DIAGRAM_WIDTH, DIAGRAM_HEIGHT} from "../../remotion/templates/auto-diagram-schema";

// 指纹排除已采用图表、字幕时间和计划版本；字幕重定时会重新计算绑定，内容变化则失效。
export const diagramContextFingerprint = (scene: {id: string; startMs: number; endMs: number; content: unknown; presenter: unknown}, spokenText: string, style: unknown, captionText: string) => createHash("sha256").update(JSON.stringify({id: scene.id, startMs: scene.startMs, endMs: scene.endMs, content: scene.content, presenter: scene.presenter, spokenText, style, captionText})).digest("hex");

export const loadDiagramContext = async (jobId: string, sceneId: string, suppliedPlan?: VisualPlan) => {
  const [plan, job, draft, narration, resources] = await Promise.all([
    suppliedPlan ?? readVisualPlan(jobId), readJob(jobId),
    readJson<Parameters<typeof deriveScenes>[1]>(path.join(jobDir(jobId), "draft.json")),
    readJson<Parameters<typeof deriveScenes>[2]>(path.join(jobDir(jobId), "audio", "narration.json")), readVisualResources(jobId),
  ]);
  const index = plan.scenes.findIndex((scene) => scene.id === sceneId);
  if (index < 0) throw new Error("目标镜头已删除，请关闭编辑器");
  const scene = plan.scenes[index]!;
  if (scene.templateId !== "rve/auto-diagram") throw new Error("当前镜头已切换模板，请关闭图表编辑器");
  const runtimeScene = deriveScenes(plan, draft, narration, resources, {allowIncompleteImage: true})[index]!;
  // 裁剪部分重叠字幕，避免 Agent 看到镜头边界外的口播。
  const captions = narration.captions.flatMap((caption) => {
    const chars = [...caption.text]; const unit = (caption.endMs - caption.startMs) / chars.length;
    const from = Math.max(0, Math.ceil((scene.startMs - caption.startMs) / unit));
    const to = Math.min(chars.length, Math.floor((scene.endMs - caption.startMs) / unit));
    return to > from ? [{...caption, text: chars.slice(from, to).join(""), startMs: caption.startMs + from * unit, endMs: caption.startMs + to * unit}] : [];
  });
  const profile = await readJobPlatformProfile(job.contentProfile, jobId);
  // 图表直接使用单一本地字体，避免 Agent 将页面回退栈当成 SVG 字体要求。
  const style = {visualStyle: plan.visualStyle ?? profile.visualStyle, fontFamily: "Studio Sans", font: "Studio Sans", brand: {title: profile.title, label: profile.displayLabel}, colors: resolveVideoTheme(plan.visualStyle ?? profile.visualStyle).colors};
  const fingerprint = diagramContextFingerprint(scene, runtimeScene.spokenText, style, captions.map((caption) => caption.text).join(""));
  const safeArea = scene.presenter.mode === "hidden" ? {x: 24, y: 24, width: 912, height: 752} : {x: scene.presenter.placement.startsWith("left") ? 300 : 24, y: 24, width: 636, height: 752};
  const context = {jobId, sceneId, fingerprint, scene: runtimeScene, captions, style, canvas: {width: DIAGRAM_WIDTH, height: DIAGRAM_HEIGHT, safeArea}, timing: "字幕区间推算字符时间，并非逐字音频对齐；仅使用本镜头原文，不编造事实和数值。"};
  return {context, plan, scene, profile, job};
};
export type DiagramContext = Awaited<ReturnType<typeof loadDiagramContext>>["context"];
// 客户端仅使用结构类型，避免把服务端模型配置带进预览。
export type DiagramPreviewCaptions = RenderManifest["captions"];
