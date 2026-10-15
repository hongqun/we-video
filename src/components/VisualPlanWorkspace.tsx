/* eslint-disable @remotion/warn-native-media-tag -- 浏览器 audio 仅用于规划审核。 */
"use client";

import {useEffect, useMemo, useRef, useState} from "react";
import dynamic from "next/dynamic";
import type {PlayerRef} from "@remotion/player";
import type {Caption, RenderManifest, VideoScene} from "@/remotion/schema";
import {getTemplateStatus, isTemplateAvailableForProfile, templateById, templateRegistry} from "@/remotion/templates/registry";
import type {VisualPlan, VisualPlanSaveInput, VisualPlanScene} from "@/lib/visual-plan";
import {splitVisualPlanScene, visualPlanChanged, visualPlanSceneIndexAtTime, type TimedNarrationSegment} from "@/lib/visual-plan-editor";
import {compatiblePoseForPlacement} from "@/lib/presenter-planning";
import {presenterFramingLabels, presenterPlacementLabels, type PresenterFraming, type PresenterPlacement, type PresenterPoseId} from "@/remotion/presenter-config";
import {Icon} from "./Icon";
import {CoverPreview} from "./CoverPreview";
import {defaultCover} from "@/remotion/cover";
import {buildRelationGraphFromKeywords, type RelationGraphData} from "@/remotion/templates/relation-graph";
import {TRANSITION_KINDS, type TransitionKind} from "@/lib/scene-transitions";
import {spokenTextForTimeRange, timeForSpokenTextOffset} from "@/lib/visual-plan-text";
import {ImagePreviewWithBoxes} from "./ImagePreviewWithBoxes";
import {BoxTextReferenceDocument} from "./BoundingBoxTextEditor";
import {visualResourceForScene} from "@/lib/visual-resource-selection";
import {VISUAL_STYLE_OPTIONS, type VisualStyleId} from "@/remotion/visual-style";

const TemplatePreview = dynamic(() => import("./TemplatePreview").then(({TemplatePreview: Component}) => Component), {ssr: false});
const RelationGraphEditor = dynamic(() => import("./RelationGraphEditor").then(({RelationGraphEditor: Component}) => Component), {ssr: false});
type SpokenSegment = {id: string; spokenText: string};
// 编辑器额外接收兼容姿态目录，正式渲染仍只使用已解析的 poses。
type ProfileContext = {accountId: string; seriesId: string; outputLanguage?: string; presenter: NonNullable<RenderManifest["presenter"]> & {compatibilityPoses?: NonNullable<RenderManifest["presenter"]>["poses"]}};
type Resource = {segmentId: string; sceneId?: string; imagePath?: string; imageWidth?: number; imageHeight?: number; polygons: Array<{text: string; points: Array<{x: number; y: number}>}>};
type Polygon = Resource["polygons"][number];
type PlaybackMode = "step" | "full";
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
// 资源文件路径按场景固定；追加资源版本，避免更换图片后浏览器继续复用旧缓存。
const sceneImageUrl = (jobId: string, imagePath: string, previewArtifactToken: string | undefined, resourceRevision: number | undefined) => {
  const params = new URLSearchParams();
  if (previewArtifactToken) params.set("renderToken", previewArtifactToken);
  params.set("resourceRevision", String(resourceRevision ?? 1));
  return `/api/jobs/${encodeURIComponent(jobId)}/artifacts/${imagePath}?${params.toString()}`;
};
const saveInput = (plan: VisualPlan, title: string): VisualPlanSaveInput => {
  const cover = plan.cover ?? defaultCover(title, plan.scenes[0]!);
  // 编辑时允许输入框暂存末尾分隔符；提交前再移除空关键词，满足封面契约。
  return {schemaVersion: "1.0", revision: plan.revision, ...(plan.feedback ? {feedback: plan.feedback} : {}), ...(plan.visualStyle ? {visualStyle: plan.visualStyle} : {}), cover: {...cover, keywords: cover.keywords.map((keyword) => keyword.trim()).filter(Boolean).slice(0, 8)}, scenes: plan.scenes};
};

export const VisualPlanWorkspace: React.FC<{jobId: string; title: string; plan: VisualPlan; audioSrc: string; segments: TimedNarrationSegment[]; captions: Caption[]; visualResources: {revision?: number; resources: Resource[]}; previewArtifactToken?: string; spokenSegments: SpokenSegment[]; profile: ProfileContext; brand: RenderManifest["brand"]; busy: boolean; canFinalize: boolean; coverImageBusy: boolean; onUploadCoverImage: (file: File) => Promise<void>; onDeleteCoverImage: () => Promise<void>; onGenerateCoverImageRequirement: (title: string) => Promise<void>; onGenerateVisualRequirement: (segmentId: string, spokenText: string, transparentBackground: boolean) => Promise<string>; onUploadImage: (sceneId: string, segmentId: string, file: File) => Promise<void>; onDeleteImage: (sceneId: string, segmentId: string) => Promise<void>; onSavePolygons: (sceneId: string, segmentId: string, polygons: Polygon[]) => Promise<void>; onSave: (plan: VisualPlanSaveInput) => Promise<VisualPlan>; onReplan: (feedback: string) => Promise<void>; onFinalize: (planVersion: number) => Promise<void>}> = ({jobId, title, plan, audioSrc, segments, captions, visualResources, previewArtifactToken, spokenSegments, profile, brand, busy, canFinalize, coverImageBusy, onUploadCoverImage, onDeleteCoverImage, onGenerateCoverImageRequirement, onGenerateVisualRequirement, onUploadImage, onDeleteImage, onSavePolygons, onSave, onReplan, onFinalize}) => {
  const [value, setValue] = useState(plan);
  const [saved, setSaved] = useState(plan);
  const [selected, setSelected] = useState(0);
  const [relationEditorOpen, setRelationEditorOpen] = useState(false);
  const [relationEditorMaximized, setRelationEditorMaximized] = useState(false);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>("step");
  const [stepPlaybackCompleted, setStepPlaybackCompleted] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const [operation, setOperation] = useState<"idle" | "saving" | "replanning" | "finalizing">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [requirement, setRequirement] = useState<{segmentId: string; text?: string; loading: boolean; transparentBackground: boolean; error?: string} | null>(null);
  const [requirementDialogOpen, setRequirementDialogOpen] = useState(false);
  const [requirementCopyStatus, setRequirementCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [imageMode, setImageMode] = useState<"original" | "boxes">("original");
  const [resourcePolygons, setResourcePolygons] = useState<Polygon[]>([]);
  const [polygonTextEditor, setPolygonTextEditor] = useState<{index: number; text: string; saving: boolean; pendingPolygons?: Polygon[]; error?: string} | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const previewPlayer = useRef<PlayerRef>(null);
  // 音频事件可能晚于点击事件到达，使用同步索引避免旧闭包把场景切回上一项。
  const selectedRef = useRef(0);
  // 保留目标时间，直到浏览器确认 seek 完成，过滤定位过程中的旧 timeupdate(0 秒)。
  const pendingSeekRef = useRef<number | null>(null);
  const spokenTextRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // 重新提取完成后，以服务端返回的新版本替换本地编辑副本。
    setValue(plan);
    setSaved(plan);
    setSelected((index) => Math.min(index, Math.max(0, plan.scenes.length - 1)));
  }, [plan]);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);
  useEffect(() => {
    if (pendingSeekRef.current === null) return;
    const target = value.scenes[selected];
    if (!target || !audio.current || audio.current.readyState < 1) return;
    // 等选中态提交且音频元数据就绪后再定位，避免 currentTime 写入被浏览器丢弃。
    audio.current.currentTime = target.startMs / 1000;
    setTime(target.startMs);
  }, [playbackMode, selected, value.scenes]);
  useEffect(() => {
    // 切换镜头时关闭抽屉，避免继续编辑上一镜头的关系图。
    setRelationEditorOpen(false);
    setRelationEditorMaximized(false);
  }, [selected]);
  useEffect(() => {
    setImageMode("original");
    setRequirement(null);
    setRequirementDialogOpen(false);
    setPolygonTextEditor(null);
    setRequirementCopyStatus("idle");
  }, [selected]);
  useEffect(() => {
    // 弹窗打开时支持 Esc 关闭，避免必须先找到右上角按钮才能退出编辑。
    if (!relationEditorOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setRelationEditorOpen(false); setRelationEditorMaximized(false); } };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [relationEditorOpen]);
  const current = value.scenes[selected];
  const cover = value.cover!;
  // 旧任务可继续预览已退役姿态；新任务姿态下拉框仍只提供五张正式素材。
  const previewPresenter = useMemo(() => {
    const used = new Set([cover.presenterPoseId, ...value.scenes.map((scene) => scene.presenter.poseId)]);
    return {poses: [...profile.presenter.poses, ...(profile.presenter.compatibilityPoses ?? []).filter((pose) => used.has(pose.id))]};
  }, [cover.presenterPoseId, profile.presenter, value.scenes]);
  const retiredCoverPose = profile.presenter.compatibilityPoses?.find((pose) => pose.id === cover.presenterPoseId);
  const retiredScenePose = profile.presenter.compatibilityPoses?.find((pose) => pose.id === current?.presenter.poseId);
  // 资源接口直接从任务目录读取，预览 URL 不再插入已废弃的 revision 层。
  const coverPreview = useMemo(() => cover.imagePath ? {...cover, imagePath: `/api/jobs/${encodeURIComponent(jobId)}/artifacts/${cover.imagePath}${previewArtifactToken ? `?renderToken=${encodeURIComponent(previewArtifactToken)}` : ""}`} : cover, [cover, jobId, previewArtifactToken]);
  const locked = busy || operation !== "idle";
  const dirty = visualPlanChanged(value, saved);
  const playingIndex = visualPlanSceneIndexAtTime(value.scenes, time);

  const runtimeScenes = useMemo(() => value.scenes.map((scene): VideoScene | null => {
    const sceneTiming = segments.find((item) => item.id === scene.segmentId);
    if (!sceneTiming) return null;
    const sceneResource = visualResourceForScene(visualResources, scene.id, scene.segmentId);
    const imagePath = sceneResource?.imagePath ? sceneImageUrl(jobId, sceneResource.imagePath, previewArtifactToken, visualResources.revision) : undefined;
    // 图片运行参数只在预览时由 scene.id 展开，不写回 visual-plan。
    const templateData = scene.templateId === "rve/visual-image" && imagePath && sceneResource?.imageWidth && sceneResource.imageHeight
      ? {imagePath, imageWidth: sceneResource.imageWidth, imageHeight: sceneResource.imageHeight, polygons: sceneResource.polygons}
      : scene.templateId === "rve/relation-graph" ? scene.visualData : undefined;
    const speechStartMs = Math.max(scene.startMs, sceneTiming.speechStartMs ?? sceneTiming.startMs);
    const speechEndMs = Math.min(scene.endMs, sceneTiming.speechEndMs ?? sceneTiming.endMs);
    const fullSpokenText = spokenSegments.find((item) => item.id === scene.segmentId)?.spokenText ?? "";
    const isSplitSegment = value.scenes.filter((item) => item.segmentId === scene.segmentId).length > 1;
    // 普通镜头直接展示确认稿，防止 TTS 在段落交界处合并词级字幕后吞掉下一段的开头。
    const clippedSpokenText = isSplitSegment || profile.outputLanguage !== "en-US"
      ? spokenTextForTimeRange(captions, scene.startMs, scene.endMs) || fullSpokenText
      : fullSpokenText;
    return {id: scene.id, segmentId: scene.segmentId, spokenText: clippedSpokenText, startMs: scene.startMs, endMs: scene.endMs, ...(speechEndMs > speechStartMs ? {speechStartMs, speechEndMs} : {}), transition: scene.transition, content: scene.content, templateId: scene.templateId, ...(templateData ? {templateData} : {}), rollType: scene.presenter.rollType, presenterMode: scene.presenter.mode, presenterPoseId: scene.presenter.poseId, presenterPlacement: scene.presenter.placement, presenterFraming: scene.presenter.framing};
  }), [captions, jobId, previewArtifactToken, profile.outputLanguage, segments, spokenSegments, value.scenes, visualResources]);
  const runtimeScene = runtimeScenes[selected] ?? null;
  // 镜头规划按 scene.id 取资源；旧任务没有 sceneId 时才回退到 segmentId。
  const currentResource = current ? visualResourceForScene(visualResources, current.id, current.segmentId) : undefined;
  const currentImagePath = currentResource?.imagePath ? sceneImageUrl(jobId, currentResource.imagePath, previewArtifactToken, visualResources.revision) : undefined;
  useEffect(() => {
    setResourcePolygons(currentResource?.polygons ?? []);
  }, [current?.id, currentResource?.polygons]);
  const currentStatus = runtimeScene ? getTemplateStatus(runtimeScene) : {usable: false, reason: "缺少口播时间轴"};
  const planIssue = runtimeScenes.map((scene, index) => {
    if (!scene) return `第 ${index + 1} 个镜头缺少口播时间轴`;
    const requiredTemplateId = index === runtimeScenes.length - 1 && runtimeScenes.length > 1 ? "ip/closing-stage" : null;
    if (requiredTemplateId && scene.templateId !== requiredTemplateId) return `第 ${index + 1} 个镜头必须使用固定模板`;
    // 新增行未填写完整时给出明确提示，避免严格契约保存失败。
    if (scene.templateId === "ip/opening-stage" && scene.content.emphasisBindings?.some((binding) => !binding.text.trim() || !binding.cueText.trim())) return `第 ${index + 1} 个镜头：请填写重点词及其口播绑定，或删除空行`;
    const definition = templateById.get(scene.templateId);
    if (definition && !isTemplateAvailableForProfile(definition, profile)) return `第 ${index + 1} 个镜头：当前账号或专题不可用`;
    const status = getTemplateStatus(scene);
    return status.usable ? null : `第 ${index + 1} 个镜头：${status.reason}`;
  }).find((item): item is string => Boolean(item));
  // 首场默认使用 IP 开场舞台，但允许用户改成任意可用的 B-roll 模板；尾场仍保持结论舞台。
  const availableTemplates = current ? templateRegistry.filter((definition) => definition.id !== "ip/closing-stage" && (definition.rollRole === "b-roll" || (selected === 0 && definition.id === "ip/opening-stage"))) : [];
  const fixedEdge = value.scenes.length > 1 && selected === value.scenes.length - 1;

  const update = (patch: Partial<VisualPlanScene>) => setValue((previous) => ({...previous, scenes: previous.scenes.map((scene, index) => index === selected ? {...scene, ...patch} : scene)}));
  const updateContent = (patch: Partial<VisualPlanScene["content"]>) => current && update({content: {...current.content, ...patch}});
  const updateCover = (patch: Partial<NonNullable<VisualPlan["cover"]>>) => setValue((previous) => ({...previous, cover: {...(previous.cover ?? cover), ...patch}}));
  const generateRequirement = async () => {
    if (!current) return;
    setRequirement({segmentId: current.segmentId, loading: true, transparentBackground: requirement?.transparentBackground ?? true});
    try {
      const text = await onGenerateVisualRequirement(current.segmentId, runtimeScene?.spokenText ?? "", requirement?.transparentBackground ?? true);
      setRequirement((previous) => previous?.segmentId === current.segmentId ? {...previous, text, loading: false} : previous);
    } catch (error) {
      setRequirement((previous) => previous?.segmentId === current.segmentId ? {...previous, loading: false, error: error instanceof Error ? error.message : "生成视觉要求失败"} : previous);
    }
  };
  const copyRequirement = async () => {
    if (!requirement?.text) return;
    try {
      await navigator.clipboard.writeText(requirement.text);
      setRequirementCopyStatus("copied");
    } catch {
      setRequirementCopyStatus("failed");
    }
  };
  const updateResourcePolygons = (polygons: Polygon[]) => {
    if (!currentResource) return;
    // 先更新本地交互状态，再持久化，保证拖动顶点时画面不会等待网络响应。
    setResourcePolygons(polygons);
    if (current) void onSavePolygons(current.id, current.segmentId, polygons).catch((error) => setMessage(error instanceof Error ? error.message : "保存多边形失败"));
  };
  const savePolygonText = async () => {
    if (!polygonTextEditor || !currentResource || !runtimeScene) return;
    const polygons = (polygonTextEditor.pendingPolygons ?? resourcePolygons).map((polygon) => ({...polygon, points: polygon.points.map((point) => ({...point}))}));
    const polygon = polygons[polygonTextEditor.index];
    const text = polygonTextEditor.text.trim();
    if (!polygon) return;
    if (!text) { setPolygonTextEditor({...polygonTextEditor, error: "多边形文本不能为空"}); return; }
    if (runtimeScene.spokenText.indexOf(text) < 0) { setPolygonTextEditor({...polygonTextEditor, error: "未找到：多边形文本必须是当前镜头口播中的连续内容"}); return; }
    polygons[polygonTextEditor.index] = {...polygon, text};
    setPolygonTextEditor({...polygonTextEditor, saving: true, error: undefined});
    try {
      setResourcePolygons(polygons);
      await onSavePolygons(current.id, current.segmentId, polygons);
      setPolygonTextEditor(null);
    } catch (error) {
      setPolygonTextEditor((previous) => previous ? {...previous, saving: false, error: error instanceof Error ? error.message : "保存多边形文本失败"} : previous);
    }
  };
  const cancelPolygonTextEditor = () => {
    if (polygonTextEditor?.pendingPolygons) setResourcePolygons(polygonTextEditor.pendingPolygons.slice(0, -1));
    setPolygonTextEditor(null);
  };
  const save = async () => {
    setOperation("saving"); setMessage(null);
    try { const next = await onSave(saveInput(value, title)); setValue(next); setSaved(next); setMessage("镜头规划已保存。"); return next; }
    catch (error) { setMessage(error instanceof Error ? error.message : "保存镜头规划失败"); return null; }
    finally { setOperation("idle"); }
  };
  const finalize = async () => {
    if (!canFinalize || planIssue) { setMessage(planIssue || "当前镜头规划尚不能确认。"); return; }
    setOperation("finalizing"); setMessage(null);
    try { const latest = dirty ? await onSave(saveInput(value, title)) : saved; setValue(latest); setSaved(latest); await onFinalize(latest.planVersion); }
    catch (error) { setMessage(error instanceof Error ? error.message : "确认镜头规划失败"); }
    finally { setOperation("idle"); }
  };
  const seek = (index: number) => {
    setStepPlaybackCompleted(null);
    // 切换镜头时先停止旧镜头播放，避免旧镜头边界的 timeupdate 覆盖新的选中状态。
    audio.current?.pause();
    selectedRef.current = index;
    setSelected(index);
    const target = value.scenes[index];
    if (target) {
      pendingSeekRef.current = target.startMs;
      if (audio.current?.readyState && audio.current.readyState >= 1) {
        audio.current.currentTime = target.startMs / 1000;
        setTime(target.startMs);
      }
    }
  };
  const changePlaybackMode = (mode: PlaybackMode) => {
    setPlaybackMode(mode);
    setStepPlaybackCompleted(null);
    if (mode === "full") {
      const currentIndex = visualPlanSceneIndexAtTime(value.scenes, time);
      if (currentIndex >= 0) setSelected(currentIndex);
    }
  };
  const playSelectedScene = () => {
    const target = value.scenes[selectedRef.current];
    const element = audio.current;
    if (!target || !element) return;
    // 由业务按钮在同一次用户操作中完成定位和播放，避免原生 controls 先从 0 秒启动。
    if (element.readyState < 1) {
      pendingSeekRef.current = target.startMs;
      const playWhenReady = () => {
        element.removeEventListener("loadedmetadata", playWhenReady);
        element.currentTime = target.startMs / 1000;
        setTime(target.startMs);
        pendingSeekRef.current = null;
        void element.play();
      };
      element.addEventListener("loadedmetadata", playWhenReady);
      return;
    }
    const currentTimeMs = element.currentTime * 1000;
    const restartPreview = (
      stepPlaybackCompleted === selectedRef.current
      || currentTimeMs < target.startMs
      || currentTimeMs >= target.endMs
    );
    if (restartPreview) {
      element.currentTime = target.startMs / 1000;
      setTime(target.startMs);
      setStepPlaybackCompleted(null);
    }
    pendingSeekRef.current = null;
    // 与口播在同一次点击中启动并解锁 Player 音频，避免浏览器拦截模板内的打字机音效。
    previewPlayer.current?.unmute();
    previewPlayer.current?.setVolume(1);
    if (restartPreview) previewPlayer.current?.seekTo(0);
    previewPlayer.current?.play();
    void element.play();
  };
  const handleAudioLoadedMetadata = () => {
    if (pendingSeekRef.current === null) return;
    const target = value.scenes[selectedRef.current];
    if (!target || !audio.current) return;
    // 选择场景时若音频尚未加载，等元数据可用后补做一次精确定位。
    audio.current.currentTime = target.startMs / 1000;
    setTime(target.startMs);
  };
  const handleAudioSeeked = () => {
    if (pendingSeekRef.current === null || !audio.current) return;
    const targetMs = pendingSeekRef.current;
    if (Math.abs(audio.current.currentTime * 1000 - targetMs) <= 80) pendingSeekRef.current = null;
  };
  const handleAudioTimeUpdate = (event: React.SyntheticEvent<HTMLAudioElement>) => {
    const currentTimeMs = event.currentTarget.currentTime * 1000;
    const pendingSeekMs = pendingSeekRef.current;
    if (pendingSeekMs !== null && currentTimeMs + 80 < pendingSeekMs) return;
    if (pendingSeekMs !== null) pendingSeekRef.current = null;
    setTime(currentTimeMs);
    if (playbackMode === "full") {
      const nextIndex = visualPlanSceneIndexAtTime(value.scenes, currentTimeMs);
      // 片尾或段落间静音没有对应镜头时，保留最后一个有效镜头，避免选中态变成 -1。
      if (nextIndex >= 0 && nextIndex !== selectedRef.current) {
        selectedRef.current = nextIndex;
        setSelected(nextIndex);
      }
      return;
    }
    const currentScene = value.scenes[selectedRef.current];
    // 逐步播放按视觉镜头边界停止；同一 segmentId 拆成多个镜头时不能继续播放整段口播。
    if (playing && currentScene && currentTimeMs >= currentScene.endMs) {
      event.currentTarget.pause();
      setStepPlaybackCompleted(selected);
    }
  };
  const continueStepPlayback = () => {
    if (playbackMode !== "step" || selected >= value.scenes.length - 1) return;
    seek(selected + 1);
    // 等新镜头选中态提交后播放，确保起点来自下一镜头而不是旧的音频时间。
    window.requestAnimationFrame(playSelectedScene);
  };
  const splitAtSpokenTextCursor = () => {
    if (!current) return;
    const cursor = spokenTextRef.current?.selectionStart;
    const spokenText = runtimeScene?.spokenText ?? "";
    if (cursor == null || cursor <= 0 || cursor >= spokenText.length) {
      setMessage("请先把光标放在口播文字中间，再点击拆分。");
      return;
    }
    const sceneCaptions = captions.filter((caption) => caption.endMs > current.startMs && caption.startMs < current.endMs);
    const splitAtMs = timeForSpokenTextOffset(sceneCaptions, current.startMs, current.endMs, cursor);
    if (splitAtMs == null) {
      setMessage("当前口播文字没有对应的字幕时间边界，请重新生成音频后再试。");
      return;
    }
    try {
      const nextScenes = splitVisualPlanScene(value.scenes, selected, Math.round(splitAtMs));
      audio.current?.pause();
      if (audio.current) audio.current.currentTime = splitAtMs / 1000;
      setTime(Math.round(splitAtMs));
      setValue((previous) => ({...previous, scenes: nextScenes}));
      selectedRef.current = selected + 1;
      setSelected(selected + 1);
      setMessage("已按口播文字位置拆分镜头，新增镜头默认无转场。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "按口播文字拆分视觉镜头失败");
    }
  };
  return <section className="panel visual-plan-workspace" aria-labelledby="visual-plan-title">
    <div className="panel-heading"><div><p className="review-section-label">第 4 步 · 镜头规划</p><h2 id="visual-plan-title" className="icon-label"><Icon name="timeline" />跟着声音排镜头</h2></div><span className="metadata">{dirty ? "有未保存修改" : "已保存"}</span></div>
    {current ? <div className="visual-plan-body">
      <fieldset className="visual-style-picker">
        <legend><span className="review-section-label">全片界面风格</span><strong>选择封面、镜头与片尾的统一视觉语言</strong></legend>
        {!value.visualStyle ? <p className="visual-style-legacy-note">当前任务沿用旧版漫画风格。选择下面任一风格并保存后才会切换。</p> : null}
        <div className="visual-style-options">{VISUAL_STYLE_OPTIONS.map((option) => <label key={option.id} className={`visual-style-option visual-style-option-${option.id}${value.visualStyle === option.id ? " is-selected" : ""}`}>
          <input type="radio" name="visual-style" value={option.id} checked={value.visualStyle === option.id} disabled={locked} onChange={() => setValue((previous) => ({...previous, visualStyle: option.id as VisualStyleId}))} />
          <span className="visual-style-swatch" aria-hidden="true"><i /><i /><i /></span>
          <span className="visual-style-copy"><strong>{option.label}</strong><small>{option.description}</small></span>
        </label>)}</div>
        <p className="field-hint">卡片展示的是封面风格；正文镜头会自动降低色彩和装饰强度。不会加入进度、百分比、仪表盘等无业务含义的信息组件。</p>
      </fieldset>
      <div className="visual-plan-cover-editor">
        <div className="visual-plan-cover-form">
          <div className="visual-plan-section-heading"><div><p className="review-section-label">封面</p><h3>编辑开场封面</h3></div><span className="metadata">{dirty ? "有未保存修改" : "已保存"}</span></div>
          {/* 封面标题支持手动换行，直接复用渲染端的显式换行处理。 */}
          <label>封面标题<textarea rows={2} value={cover.title} disabled={locked} maxLength={40} onChange={(event) => updateCover({title: event.target.value})} placeholder="可按 Enter 手动换行" /></label>
          {/* 副标题使用多行输入，保存时保留手动换行。 */}
          <label>封面副标题<textarea rows={3} value={cover.subtitle} disabled={locked} maxLength={120} onChange={(event) => updateCover({subtitle: event.target.value})} /></label>
          {/* 编辑时保留关键词内部和末尾空格，避免输入英文多词关键词时受控回写吞掉空格。 */}
          <label>封面关键词<input value={cover.keywords.join("、")} disabled={locked} onChange={(event) => updateCover({keywords: event.target.value.split(/[,，、]/).slice(0, 8)})} /></label>
          <label>封面人物姿势<select value={cover.presenterPoseId} disabled={locked || !profile.presenter.poses.length} onChange={(event) => updateCover({presenterPoseId: event.target.value as NonNullable<VisualPlan["cover"]>["presenterPoseId"]})}>{retiredCoverPose ? <option value={retiredCoverPose.id}>历史姿态 · {retiredCoverPose.label}</option> : null}{profile.presenter.poses.map((pose) => <option key={pose.id} value={pose.id}>{pose.label ?? pose.id}</option>)}</select></label>
          <div className="visual-plan-cover-image-actions">
            <label className="secondary cover-image-upload-label"><Icon name="upload" />{coverImageBusy ? "图片上传中…" : "上传封面图片"}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={locked || coverImageBusy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onUploadCoverImage(file); event.currentTarget.value = ""; }} /></label>
            {cover.imagePath ? <button className="secondary" type="button" disabled={locked || coverImageBusy} onClick={() => void onDeleteCoverImage()}>删除封面图片</button> : null}
            <button className="secondary" type="button" disabled={locked || coverImageBusy} onClick={() => void onGenerateCoverImageRequirement(cover.title)}>生成封面图片要求</button>
          </div>
          {coverPreview.imagePath ? <img className="visual-plan-cover-image-thumb" src={coverPreview.imagePath} alt="当前封面图片" /> : <p className="field-hint">可上传 1:1 透明背景小宠物插画，不使用边界框。</p>}
        </div>
        {runtimeScenes[0] ? <aside className="visual-plan-cover-preview"><div><p className="review-section-label">封面预览</p><strong>视频首帧封面</strong></div><CoverPreview brand={brand} presenter={previewPresenter} cover={coverPreview} visualStyle={value.visualStyle} /></aside> : null}
      </div>
      <div className="visual-plan-scenes-heading"><p className="review-section-label">镜头规划</p><strong>跟着声音排镜头</strong></div>
      <div className="visual-plan-editor">
        <div className="visual-plan-spoken"><span>当前口播 · 将光标放在文字中间后点击拆分</span><div className="visual-plan-spoken-editor"><textarea ref={spokenTextRef} value={runtimeScene?.spokenText ?? ""} readOnly rows={3} aria-label="当前镜头口播文字" /><button type="button" className="secondary icon-only" aria-label="按光标拆分镜头" title="按光标拆分镜头" data-tooltip="按光标拆分镜头" disabled={locked} onClick={splitAtSpokenTextCursor}><Icon name="flow" /></button></div></div>
        {/* 场景主标题与封面标题保持一致，支持手动换行并直接传给显式换行渲染。 */}
        <label>主标题<textarea rows={2} value={current.content.title} disabled={locked} onChange={(event) => updateContent({title: event.target.value})} placeholder="可按 Enter 手动换行" /></label>
        <label>副标题<input value={current.content.subtitle} disabled={locked} onChange={(event) => updateContent({subtitle: event.target.value})} /></label>
        <label>内容<textarea rows={3} value={current.content.text} disabled={locked} onChange={(event) => updateContent({text: event.target.value})} /></label>
        <label>关键词<input value={current.content.keywords.join("、")} disabled={locked} onChange={(event) => updateContent({keywords: event.target.value.split(/[,，、]/).map((item) => item.trim()).filter(Boolean)})} /></label>
        {/* 标签与特效分开配置；每个重点词显式指定触发它的口播文字。 */}
        {current.templateId === "ip/opening-stage" ? <section className="visual-plan-emphasis" aria-label="内容区重点词特效">
          <strong>内容区重点词特效</strong>
          <p className="field-hint">关键词只显示为下方标签。这里分别填写画面中要放大的文字，以及触发特效的口播文字；两者可以不同。</p>
          {(current.content.emphasisBindings ?? []).map((binding, index) => <div key={index} className="visual-plan-emphasis-row">
            <label>重点词<input value={binding.text} disabled={locked} placeholder="内容区中的文字" onChange={(event) => updateContent({emphasisBindings: current.content.emphasisBindings!.map((item, itemIndex) => itemIndex === index ? {...item, text: event.target.value} : item)})} /></label>
            <label>绑定口播<input value={binding.cueText} disabled={locked} placeholder="读到这段口播时触发" onChange={(event) => updateContent({emphasisBindings: current.content.emphasisBindings!.map((item, itemIndex) => itemIndex === index ? {...item, cueText: event.target.value} : item)})} /></label>
            <button type="button" className="secondary" disabled={locked} onClick={() => updateContent({emphasisBindings: current.content.emphasisBindings!.filter((_, itemIndex) => itemIndex !== index)})}>删除</button>
          </div>)}
          <button type="button" className="secondary" disabled={locked} onClick={() => updateContent({emphasisBindings: [...(current.content.emphasisBindings ?? []), {text: "", cueText: ""}]})}>添加重点词</button>
        </section> : null}
        <div className="visual-plan-two-columns">
          <label>到下一个镜头的转场<select value={current.transition.kind} disabled={locked} onChange={(event) => { const kind = event.target.value as TransitionKind; update({transition: kind === "none" ? {kind, durationMs: 0} : {kind, durationMs: current.transition.kind === "none" ? 315 : current.transition.durationMs}}); }}>{TRANSITION_KINDS.map((kind) => <option key={kind} value={kind}>{kind === "none" ? "无转场" : kind}</option>)}</select></label>
          <label>转场时长（毫秒）<input type="number" min={240} max={360} step={1} value={current.transition.kind === "none" ? 0 : current.transition.durationMs} disabled={locked || current.transition.kind === "none"} onChange={(event) => update({transition: {kind: current.transition.kind === "none" ? "fade" : current.transition.kind, durationMs: Math.max(240, Math.min(360, Number(event.target.value) || 315))}})} /></label>
        </div>
        {current.templateId === "rve/relation-graph" && current.visualData ? <div className="relation-graph-editor-trigger"><span>关系图节点与连线</span><button className="secondary" type="button" disabled={locked} onClick={() => { setRelationEditorMaximized(false); setRelationEditorOpen(true); }}>打开编辑器</button></div> : null}
        <details className="visual-plan-presenter-settings"><summary><span>人物设置</span><small>{current.presenter.mode === "hero" ? "全屏主讲" : current.presenter.mode === "companion" ? "陪伴讲解" : "隐藏人物"}</small></summary><div className="visual-plan-presenter-settings-body">
          <label>人物模式<select value={current.presenter.mode} disabled={locked || current.presenter.rollType === "a-roll"} onChange={(event) => update({presenter: {...current.presenter, mode: event.target.value as "companion" | "hidden"}})}>{current.presenter.rollType === "a-roll" ? <option value="hero">全屏主讲</option> : <><option value="hidden">隐藏人物</option><option value="companion">陪伴讲解</option></>}</select></label>
          <label>人物姿态<select value={current.presenter.poseId} disabled={locked || current.presenter.mode === "hidden"} onChange={(event) => update({presenter: {...current.presenter, poseId: compatiblePoseForPlacement(event.target.value as PresenterPoseId, current.presenter.placement, profile.presenter.poses)}})}>{retiredScenePose ? <option value={retiredScenePose.id}>历史姿态 · {retiredScenePose.label}</option> : null}{profile.presenter.poses.map((pose) => <option key={pose.id} value={pose.id}>{pose.label ?? pose.id}</option>)}</select></label>
          <label>人物位置<select value={current.presenter.placement} disabled={locked || current.presenter.rollType === "a-roll" || current.presenter.mode === "hidden"} onChange={(event) => { const placement = event.target.value as PresenterPlacement; update({presenter: {...current.presenter, placement, poseId: compatiblePoseForPlacement(current.presenter.poseId, placement, profile.presenter.poses)}}); }}>{current.presenter.rollType === "a-roll" ? <option value="hero">{presenterPlacementLabels.hero}</option> : ["left-mid", "right-mid", "left-lower", "right-lower"].map((id) => <option key={id} value={id}>{presenterPlacementLabels[id as PresenterPlacement]}</option>)}</select></label>
          <label>人物构图<select value={current.presenter.framing ?? "waist"} disabled={locked || current.presenter.rollType === "a-roll" || current.presenter.mode === "hidden"} onChange={(event) => update({presenter: {...current.presenter, framing: event.target.value as PresenterFraming}})}>{Object.entries(presenterFramingLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        </div></details>
        {fixedEdge ? <div className="visual-plan-structure"><span>固定模板</span><strong>{templateById.get(current.templateId)?.label}</strong><small>最后镜头固定为结论 IP 舞台</small></div> : <div className="template-field"><label>可用模板</label><div className="compatible-template-picker">{availableTemplates.map((definition) => {
          const candidateResource = visualResourceForScene(visualResources, current.id, current.segmentId);
          const candidateImagePath = candidateResource?.imagePath ? sceneImageUrl(jobId, candidateResource.imagePath, previewArtifactToken, visualResources.revision) : undefined;
          const candidateTemplateData = definition.id === "rve/visual-image" && candidateImagePath && candidateResource?.imageWidth && candidateResource.imageHeight
            ? {imagePath: candidateImagePath, imageWidth: candidateResource.imageWidth, imageHeight: candidateResource.imageHeight, polygons: candidateResource.polygons}
            : definition.id === "rve/relation-graph" ? current.visualData ?? buildRelationGraphFromKeywords(current.content.keywords) : undefined;
          const candidatePresenter = definition.rollRole === "a-roll"
            ? {...current.presenter, rollType: "a-roll" as const, mode: "hero" as const, placement: "hero" as const, framing: "full" as const}
            : {...current.presenter, rollType: "b-roll" as const, mode: "hidden" as const, placement: "right-lower" as const, framing: definition.companionFraming};
          // 预览场景使用扁平的人物字段，不能把 VisualPlan 的 presenter 对象直接塞进来。
          const candidate = runtimeScene ? {...runtimeScene, templateId: definition.id, rollType: candidatePresenter.rollType, presenterMode: candidatePresenter.mode, presenterPlacement: candidatePresenter.placement, presenterFraming: candidatePresenter.framing, ...(candidateTemplateData ? {templateData: candidateTemplateData} : {templateData: undefined})} : null;
          const status = !isTemplateAvailableForProfile(definition, profile) ? {usable: false, reason: "当前账号或专题不可用"} : candidate ? getTemplateStatus(candidate) : {usable: false, reason: "缺少时间轴"};
          const canSelectPendingImage = definition.id === "rve/visual-image" && status.reason === "缺少完整图片资源";
          return <button className={`template-option ${current.templateId === definition.id ? "is-selected" : ""}`} type="button" key={definition.id} disabled={locked || (!status.usable && !canSelectPendingImage)} onClick={() => update({templateId: definition.id, presenter: candidatePresenter, ...(definition.id === "rve/relation-graph" && !current.visualData ? {visualData: buildRelationGraphFromKeywords(current.content.keywords)} : {})})}><span><strong>{definition.label}</strong><small>{status.usable ? "当前镜头可用" : canSelectPendingImage ? "可先选择，待上传图片" : status.reason}</small></span></button>;
        })}</div></div>}
        {current.templateId === "rve/visual-image" ? <section className="visual-plan-image-resources" aria-label="当前镜头图片资源">
          <div className="visual-plan-section-heading"><div><p className="review-section-label">图片资源</p><h3>视觉要求图片</h3></div><span className="metadata">{currentImagePath ? "已上传" : "待上传"}</span></div>
          <div className="visual-plan-image-actions">
            <label className="secondary cover-image-upload-label"><Icon name="upload" />上传图片<input type="file" accept="image/png,image/jpeg,image/webp" disabled={locked} onChange={(event) => { const file = event.target.files?.[0]; if (file && current) void onUploadImage(current.id, current.segmentId, file); event.currentTarget.value = ""; }} /></label>
            {currentImagePath ? <><button type="button" className={imageMode === "original" ? "" : "secondary"} disabled={locked} onClick={() => setImageMode("original")}>原图</button><button type="button" className={imageMode === "boxes" ? "" : "secondary"} disabled={locked} onClick={() => setImageMode("boxes")}>边界框</button><button type="button" className="secondary" disabled={locked} onClick={() => { if (current) void onDeleteImage(current.id, current.segmentId); }}>删除图片</button></> : null}
          </div>
          <div className="visual-plan-image-requirement-trigger"><span>图像提示词</span><small>根据当前镜头口播临时生成，不写入规划</small><button type="button" className="secondary" disabled={locked} onClick={() => { setRequirementDialogOpen(true); setRequirement({segmentId: current.segmentId, loading: false, transparentBackground: true}); setRequirementCopyStatus("idle"); }}>生成图像提示词</button></div>
          {currentImagePath ? <div className="visual-plan-image-preview"><ImagePreviewWithBoxes src={currentImagePath} alt="当前镜头图片" imageWidth={currentResource?.imageWidth} imageHeight={currentResource?.imageHeight} polygons={resourcePolygons} showBoxes={imageMode === "boxes"} onBoxesChange={setResourcePolygons} onBoxesCommit={updateResourcePolygons} onBoxesReorder={(from, direction) => { const boxes = [...resourcePolygons]; const target = direction === "up" ? from - 1 : from + 1; if (target < 0 || target >= boxes.length) return; [boxes[from], boxes[target]] = [boxes[target]!, boxes[from]!]; updateResourcePolygons(boxes); }} onBoxDelete={(index) => { const boxes = [...resourcePolygons]; boxes.splice(index, 1); updateResourcePolygons(boxes); }} onBoxEdit={(index) => { const box = resourcePolygons[index]; if (box) setPolygonTextEditor({index, text: box.text, saving: false}); }} onBoxCreate={(points) => { const pendingPolygons = [...resourcePolygons, {text: "", points}]; setResourcePolygons(pendingPolygons); setPolygonTextEditor({index: pendingPolygons.length - 1, text: "", saving: false, pendingPolygons}); }} /></div> : null}
          {!currentImagePath ? <p className="field-hint">上传图片后可切换到边界框模式，在图片上绘制与口播文字对应的区域。</p> : null}
        </section> : null}
        {relationEditorOpen && runtimeScene && current.templateId === "rve/relation-graph" && current.visualData ? <div className={`relation-graph-modal${relationEditorMaximized ? " is-maximized" : ""}`} role="presentation">
          <section className={`relation-graph-modal-window${relationEditorMaximized ? " is-maximized" : ""}`} role="dialog" aria-modal="false" aria-labelledby="relation-graph-editor-title" onKeyDownCapture={(event) => {
            const target = event.target as HTMLElement;
            // 输入节点文字时，删除键只修改输入框，不能继续冒泡触发编辑器快捷键。
            if ((event.key === "Backspace" || event.key === "Delete") && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) event.stopPropagation();
          }}>
            <div className="relation-graph-drawer-heading"><div><p className="review-section-label">关系图编排</p><p className="relation-graph-spoken-text">{runtimeScene.spokenText}</p><h3 id="relation-graph-editor-title">编辑节点与连线</h3></div><div className="relation-graph-modal-actions"><button className="primary" type="button" disabled={locked || !dirty} onClick={() => void save()}><Icon name="save" />保存规划</button><button className="secondary" type="button" aria-pressed={relationEditorMaximized} onClick={() => setRelationEditorMaximized((current) => !current)}>{relationEditorMaximized ? "还原" : "最大化"}</button><button className="secondary" type="button" onClick={() => { setRelationEditorOpen(false); setRelationEditorMaximized(false); }}>关闭</button></div></div>
            {/* 场景切换时重建编辑器，避免 React Flow 保留上一场景的本地节点状态。 */}
            <RelationGraphEditor key={runtimeScene.id} scene={runtimeScene} captions={captions} value={current.visualData as RelationGraphData} currentTimeMs={time} disabled={locked} onChange={(visualData) => update({visualData})} />
          </section>
        </div> : null}
        {requirementDialogOpen && current.templateId === "rve/visual-image" ? <div className="confirm-overlay" role="presentation" onClick={() => (requirement?.loading ? undefined : setRequirementDialogOpen(false))}>
          <section className="confirm-dialog panel visual-plan-requirement-dialog" role="dialog" aria-modal="true" aria-labelledby="visual-plan-requirement-title" onClick={(event) => event.stopPropagation()}>
            <div className="visual-requirement-dialog-header"><h2 id="visual-plan-requirement-title">图像提示词</h2><button type="button" className="secondary icon-only" aria-label="关闭图像提示词" onClick={() => setRequirementDialogOpen(false)}>×</button></div>
            <p className="hint">当前镜头口播：{runtimeScene?.spokenText}</p>
            <fieldset className="visual-requirement-background-choice"><legend>背景模式</legend><div className="visual-requirement-background-options"><label className={requirement?.transparentBackground !== false ? "is-selected" : ""}><input type="radio" name={`visual-plan-background-${current.segmentId}`} checked={requirement?.transparentBackground !== false} disabled={locked || requirement?.loading} onChange={() => setRequirement({segmentId: current.segmentId, text: undefined, loading: false, transparentBackground: true})} /><span><strong>透明背景</strong><small>适合主体抠图和叠加</small></span></label><label className={requirement?.transparentBackground === false ? "is-selected" : ""}><input type="radio" name={`visual-plan-background-${current.segmentId}`} checked={requirement?.transparentBackground === false} disabled={locked || requirement?.loading} onChange={() => setRequirement({segmentId: current.segmentId, text: undefined, loading: false, transparentBackground: false})} /><span><strong>不透明背景</strong><small>使用完整场景背景</small></span></label></div></fieldset>
            {requirement?.loading ? <p>正在生成图像提示词…</p> : requirement?.error ? <p className="error-text">{requirement.error}</p> : requirement?.text ? <p className="visual-requirement-result">{requirement.text}</p> : <p className="field-hint">选择背景模式后生成提示词。</p>}
            <div className="actions"><button type="button" className="secondary" disabled={locked || requirement?.loading || !requirement?.text} onClick={() => void copyRequirement()}>复制提示词</button>{requirementCopyStatus === "copied" ? <span className="copy-status success" role="status">已复制</span> : requirementCopyStatus === "failed" ? <span className="copy-status failed" role="status">复制失败，请手动选择文本</span> : null}<button type="button" disabled={locked || requirement?.loading} onClick={() => void generateRequirement()}>{requirement?.loading ? "生成中…" : requirement?.text ? "重新生成" : "生成图像提示词"}</button></div>
          </section>
        </div> : null}
        {polygonTextEditor && current.templateId === "rve/visual-image" && runtimeScene ? <div className="confirm-overlay" role="presentation" onClick={() => (polygonTextEditor.saving ? undefined : cancelPolygonTextEditor())}>
          <section className="confirm-dialog panel box-text-dialog" role="dialog" aria-modal="true" aria-labelledby="visual-plan-box-text-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="visual-plan-box-text-title">修改多边形文本</h2>
            <BoxTextReferenceDocument spokenText={runtimeScene.spokenText} polygons={polygonTextEditor.pendingPolygons ?? resourcePolygons} editingIndex={polygonTextEditor.index} text={polygonTextEditor.text} />
            <label>多边形文本<textarea autoFocus rows={4} value={polygonTextEditor.text} disabled={polygonTextEditor.saving} onChange={(event) => setPolygonTextEditor((previous) => previous ? {...previous, text: event.target.value, error: undefined} : previous)} /></label>
            <div className="actions"><button type="button" className="secondary" disabled={polygonTextEditor.saving} onClick={cancelPolygonTextEditor}>取消</button><button type="button" disabled={polygonTextEditor.saving} onClick={() => void savePolygonText()}>{polygonTextEditor.saving ? "保存中…" : "保存"}</button></div>
            {polygonTextEditor.error ? <p className="error-text">{polygonTextEditor.error}</p> : null}
          </section>
        </div> : null}
      </div>
      <aside className="visual-plan-preview"><div><p className="review-section-label">当前镜头预览</p><strong>{templateById.get(current.templateId)?.label}</strong></div>
        {runtimeScene && currentStatus.usable ? <TemplatePreview brand={brand} scene={runtimeScene} presenter={previewPresenter} visualStyle={value.visualStyle} playing={playing} audioRef={audio} playerRef={previewPlayer} sceneStartMs={current.startMs} sceneEndMs={current.endMs} captions={captions} /> : <div className="template-preview-empty">{currentStatus.reason}</div>}
        <div className="visual-plan-playback-mode" aria-label="预览播放模式">
          <button type="button" className={playbackMode === "step" ? "is-active" : ""} aria-pressed={playbackMode === "step"} onClick={() => changePlaybackMode("step")}>逐步播放</button>
          <button type="button" className={playbackMode === "full" ? "is-active" : ""} aria-pressed={playbackMode === "full"} onClick={() => changePlaybackMode("full")}>全部播放</button>
          <span className="visual-plan-scene-counter">第 {selected + 1} / {value.scenes.length} 镜头</span>
        </div>
        {/* 不使用原生 controls，场景播放必须先定位到当前镜头再启动音频。 */}
        <div className="visual-plan-audio-controls">
          <audio ref={audio} src={audioSrc} preload="metadata" onLoadedMetadata={handleAudioLoadedMetadata} onSeeked={handleAudioSeeked} onTimeUpdate={handleAudioTimeUpdate} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
          <button type="button" className="secondary" onClick={() => playing ? audio.current?.pause() : playSelectedScene()}><Icon name="play" />{playing ? "暂停" : "播放当前镜头"}</button>
          <span className="metadata">{clock(time)} / {clock(current.endMs)}</span>
        </div>
        {playbackMode === "step" && selected < value.scenes.length - 1 ? <button type="button" className="visual-plan-next-step" onClick={continueStepPlayback}><Icon name="arrow-right" />下一步</button> : null}
        <div className="visual-plan-rail">{value.scenes.map((scene, index) => <button type="button" className={`${index === selected ? "is-selected" : ""} ${index === playingIndex ? "is-playing" : ""}`} key={scene.id} onClick={() => seek(index)}><b>{String(index + 1).padStart(2, "0")}</b><span>{scene.content.title}</span><small>{`${clock(scene.startMs)}–${clock(scene.endMs)}`}</small></button>)}</div>
      </aside>
    </div> : null}
    {message ? <p className="visual-plan-message" role="status">{message}</p> : null}
    <div className="visual-plan-actions"><button type="button" disabled={locked || !dirty} onClick={() => void save()}><Icon name="save" />保存规划</button><textarea rows={2} value={feedback} disabled={locked} onChange={(event) => setFeedback(event.target.value)} placeholder="描述希望 AI 如何重新提取镜头文字" /><button type="button" disabled={locked} onClick={() => { setOperation("replanning"); setMessage(null); void onReplan(feedback.trim()).catch((error) => setMessage(error instanceof Error ? error.message : "重新提取失败")).finally(() => setOperation("idle")); }}>重新提取</button><button type="button" disabled={locked || !canFinalize || Boolean(planIssue)} title={planIssue} onClick={() => void finalize()}>确认镜头规划</button></div>
  </section>;
};
