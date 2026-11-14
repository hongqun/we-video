import {createHash} from "node:crypto";
import {promises as fs} from "node:fs";
import path from "node:path";
import {jobDir, readJob, readJson} from "../jobs";
import {readVisualPlan, deriveScenes, type VisualPlan} from "../visual-plan";
import {readJobPlatformProfile} from "../profile";
import {readVisualResources} from "../visual-resources";
import {resolveVideoTheme} from "../../remotion/visual-style";
import {EXPLAINER_WIDTH, EXPLAINER_HEIGHT} from "../../remotion/templates/handdraw-explainer-schema";
import {narrationSceneFrameSpans} from "../../remotion/timeline";

// 指纹包含实际配音字节及字幕时间，替换同名音频或重定时也必须重新编译。
export const explainerFingerprint = (value: unknown, audio: Uint8Array) => createHash("sha256").update(JSON.stringify(value)).update(audio).digest("hex");
export const loadExplainerContext = async (jobId: string, sceneId: string, suppliedPlan?: VisualPlan) => {
  const [plan, job, draft, narration, resources, audio] = await Promise.all([
    suppliedPlan ?? readVisualPlan(jobId), readJob(jobId),
    readJson<Parameters<typeof deriveScenes>[1]>(path.join(jobDir(jobId), "draft.json")),
    readJson<Parameters<typeof deriveScenes>[2]>(path.join(jobDir(jobId), "audio/narration.json")),
    readVisualResources(jobId), fs.readFile(path.join(jobDir(jobId), "audio/narration.wav")),
  ]);
  const index = plan.scenes.findIndex((item) => item.id === sceneId);
  const scene = plan.scenes[index];
  if (!scene || scene.templateId !== "rve/handdraw-explainer") throw new Error("目标手绘讲解镜头已删除或切换模板");
  const runtimeScene = deriveScenes(plan, draft, narration, resources, {allowIncompleteImage: true})[index]!;
  const profile = await readJobPlatformProfile(job.contentProfile, jobId);
  const style = {visualStyle: plan.visualStyle ?? profile.visualStyle, colors: resolveVideoTheme(plan.visualStyle ?? profile.visualStyle).colors};
  const captions = narration.captions.filter((item) => item.endMs > scene.startMs && item.startMs < scene.endMs);
  const canvas = {width: EXPLAINER_WIDTH, height: EXPLAINER_HEIGHT, safeArea: scene.presenter.mode === "hidden" ? [24 / 960, 24 / 800, 912 / 960, 752 / 800] : [scene.presenter.placement.startsWith("left") ? 300 / 960 : 24 / 960, 24 / 800, 636 / 960, 752 / 800]};
  const fingerprint = explainerFingerprint({scene: {...scene, handdrawExplainer: undefined, previousHanddrawExplainer: undefined}, spokenText: runtimeScene.spokenText, captions, style, canvas}, audio);
  const context = {jobId, sceneId, fingerprint, scene: {...runtimeScene, templateData: undefined}, captions, style, canvas, durationInFrames: narrationSceneFrameSpans(plan.scenes, narration.durationMs, 30)[index]!.durationInFrames, timing: "字幕区间内为字符时间估算，不是逐字强制音频对齐。使用本镜头原文和具体出现次数绑定，不改配音。"};
  return {context, plan, scene, profile, job};
};
export type ExplainerContext = Awaited<ReturnType<typeof loadExplainerContext>>["context"];
