/* eslint-disable @remotion/non-pure-animation -- 只编辑 JSON 时间轴；所有播放姿态由整数帧纯计算。 */
"use client";
import {ModelParameterTip} from "./ModelParameterTip";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {ModelNarrationDocument} from "./ModelNarrationDocument";
import {resolveRelationGraphCue} from "@/remotion/templates/relation-graph";
import type {Caption, VideoScene} from "@/remotion/schema";
import {modelScenePlanSchema, type CameraKeyframe, type CameraState, type ModelScenePlan} from "@/remotion/templates/model-scene-schema";
import {DEFAULT_CAMERA, compileCameraTrack, frameAtMs, getCameraState, localModelFrame, modelSceneFrameCount, msAtFrame, resolveModelTime, sameCameraState} from "@/remotion/templates/model-scene-camera";
import {cameraKey, ensureCameraBoundaries, moveCameraKey} from "@/remotion/templates/model-scene-editing";
import type {ModelAnnotation} from "@/remotion/templates/model-scene-annotations";
import {ModelViewport} from "@/remotion/templates/ModelScene";
import {resolveModelSceneSchedule} from "@/remotion/templates/model-scene-timing";
import {ModelAnnotationInspector} from "./ModelAnnotationInspector";

type Props = {plan: ModelScenePlan; scene: VideoScene; captions: Caption[]; src: string; audioSrc: string; initialTimeMs: number; fps?: number; onApply: (plan: ModelScenePlan) => Promise<void>; onClose: () => void};
const seconds = (ms: number) => (ms / 1000).toFixed(2);
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "编排无效";

export const ModelSceneEditor = ({plan, scene, captions, src, audioSrc, initialTimeMs, fps = 30, onApply, onClose}: Props) => {
  // 保存成功后更新基线；关闭只处理之后未保存的修改，不能撤销已保存内容。
  const [value, setValue] = useState<ModelScenePlan>(() => ensureCameraBoundaries(plan, scene, captions, fps));
  const [savedSignature, setSavedSignature] = useState(() => JSON.stringify(ensureCameraBoundaries(plan, scene, captions, fps)));
  const [saving, setSaving] = useState(false);
  const [past, setPast] = useState<ModelScenePlan[]>([]);
  const [future, setFuture] = useState<ModelScenePlan[]>([]);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [maximized, setMaximized] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const duration = modelSceneFrameCount(scene, fps);
  const lastFrame = duration - 1;
  const [frame, setFrame] = useState(Math.max(0, Math.min(lastFrame, localModelFrame(initialTimeMs, scene, fps))));
  const [playing, setPlaying] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [draftPose, setDraftPose] = useState<CameraState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoStart, setAutoStart] = useState(0);
  const [autoTransition, setAutoTransition] = useState(800);
  const [autoHold, setAutoHold] = useState(1200);
  const [returnWide, setReturnWide] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const evaluated = useMemo(() => {
    try {return {track: compileCameraTrack(value, scene, captions, fps), error: ""};}
    catch (error) {return {track: null, error: errorMessage(error)};}
  }, [value, scene, captions, fps]);
  const trackPose = evaluated.track ? getCameraState(frame, evaluated.track) : DEFAULT_CAMERA;
  const pose = draftPose ?? trackPose;
  const key = value.keyframes.find((k) => k.id === selected);
  const annotation = value.annotations.find((a) => a.id === selected);
  const nowMs = msAtFrame(frame, fps);
  const snap = (ms: number) => msAtFrame(frameAtMs(ms, fps), fps);
  const keyFrame = (key: CameraKeyframe) => evaluated.track?.keys.find((k) => k.id === key.id)?.frame ?? frameAtMs(key.timeMs, fps);
  const currentKey = value.keyframes.find((item) => keyFrame(item) === frame);
  const keyLabel = (key: CameraKeyframe, index: number) => lastFrame === 0 ? "首尾" : key.boundary === "start" ? "开头" : key.boundary === "end" ? "结尾" : String(index + 1);
  const commit = (next: ModelScenePlan) => {setPast((p) => [...p.slice(-49), structuredClone(value)]); setFuture([]); setValue(next); setMessage(""); setNotice("");};
  const undo = () => {if (!past.length) return; setFuture((f) => [structuredClone(value), ...f]); setValue(past.at(-1)!); setPast(past.slice(0, -1)); setDraftPose(null);};
  const redo = () => {if (!future.length) return; setPast((p) => [...p, structuredClone(value)]); setValue(future[0]!); setFuture(future.slice(1)); setDraftPose(null);};
  useEffect(() => {if (!modelReady) {audio.current?.pause(); setPlaying(false);}}, [modelReady]);
  const pause = () => {audio.current?.pause(); setPlaying(false);};
  const absoluteSeconds = (localFrame: number) => msAtFrame(frameAtMs(scene.startMs, fps) + localFrame, fps) / 1000;
  const seek = (next: number) => {pause(); const target = Math.max(0, Math.min(lastFrame, next)); setFrame(target); setDraftPose(null); if (audio.current) audio.current.currentTime = absoluteSeconds(target);};
  const playFrom = (targetFrame: number) => {
    if (!audio.current) return;
    setDraftPose(null); setPick(null); setFrame(targetFrame);
    audio.current.currentTime = absoluteSeconds(targetFrame);
    void audio.current.play().then(() => setPlaying(true)).catch((error) => setMessage(errorMessage(error)));
  };
  const onCameraChange = useCallback((state: CameraState) => setDraftPose(state), []);
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement; dialog.current?.focus();
    const original = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => {document.body.style.overflow = original; previousFocus.current?.focus();};
  }, []);
  useEffect(() => {
    if (!playing) return;
    let request = 0;
    // 音频只提供播放头；边界换算与正式 Sequence 一致。
    const tick = () => {
      const next = localModelFrame((audio.current?.currentTime ?? scene.startMs / 1000) * 1000, scene, fps);
      if (next >= duration) {audio.current?.pause(); setPlaying(false); setFrame(lastFrame); return;}
      setFrame(Math.max(0, next)); request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick); return () => cancelAnimationFrame(request);
  }, [playing, scene, fps, duration, lastFrame]);
  const validate = (next: ModelScenePlan) => {modelScenePlanSchema.parse(next); resolveModelSceneSchedule(scene, captions, {...next, modelPath: src}, fps); return next;};
  const changeKey = (patch: Partial<CameraKeyframe>) => {if (key) commit({...value, keyframes: value.keyframes.map((k) => k.id === key.id ? {...k, ...patch} : k)});};
  const moveKey = (id: string, timeMs: number) => {
    try {
      const next = {...value, keyframes: value.keyframes.map((k) => k.id === id ? moveCameraKey(k, snap(timeMs), scene, captions) : k)};
      next.keyframes.sort((a, b) => resolveModelTime(a, scene, captions) - resolveModelTime(b, scene, captions));
      compileCameraTrack(next, scene, captions, fps); commit(next);
    } catch (error) {setMessage(errorMessage(error));}
  };
  // 删除选中标注时同步退出表面拾取，并通过草稿历史支持撤销。
  const deleteSelectedAnnotation = () => {
    if (playing || !annotation) return;
    commit({...value, annotations: value.annotations.filter((item) => item.id !== annotation.id)});
    setSelected(null);
    setPick((previous) => previous === annotation.id ? null : previous);
    setNotice(`已删除标注“${annotation.text}”。`);
  };
  // 工具栏操作播放头所在的关键帧，避免误删之前选中的时间点。
  const deleteCurrentKey = () => {
    if (playing || !currentKey || currentKey.boundary) return;
    commit({...value, keyframes: value.keyframes.filter((item) => item.id !== currentKey.id)});
    setSelected((previous) => previous === currentKey.id ? null : previous);
    setDraftPose(null);
    setNotice(`已删除 ${seconds(nowMs)} 秒的关键帧。`);
  };
  const addKey = () => {
    try {
      const existing = evaluated.track?.keys.find((k) => k.frame === frame);
      const nextKey = cameraKey(pose, nowMs, existing?.id);
      const keys = existing ? value.keyframes.map((k) => k.id === existing.id ? {...k, ...pose} : k) : [...value.keyframes, nextKey];
      keys.sort((a, b) => resolveModelTime(a, scene, captions) - resolveModelTime(b, scene, captions));
      const next = {...value, keyframes: keys}; compileCameraTrack(next, scene, captions, fps);
      commit(next); setSelected(nextKey.id); setDraftPose(null); setInspectorOpen(true); setAutoOpen(false);
      setNotice(existing ? `已更新 ${seconds(nowMs)} 秒的关键帧（共 ${keys.length} 个）。` : `已新增 ${seconds(nowMs)} 秒的关键帧（共 ${keys.length} 个）。`);
    } catch (error) {setMessage(errorMessage(error));}
  };
  const autoPreview = useMemo(() => {
    const start = frameAtMs(autoStart, fps), transition = frameAtMs(autoTransition, fps), hold = frameAtMs(autoHold, fps);
    const finish = start + transition + hold + (returnWide ? transition : 0);
    const reusable = evaluated.track?.keys.filter((k) => (k.boundary === "start" && k.frame === start) || (returnWide && k.boundary === "end" && k.frame === finish && sameCameraState(k, DEFAULT_CAMERA))) ?? [];
    let error = "";
    if (!evaluated.track || !draftPose) error = "请先暂停并调整目标视角";
    else if (transition < 1 || hold < 0 || start < 0 || finish > lastFrame) error = "插入区间超出镜头范围，请调整起点、过渡或停留时间";
    else if (evaluated.track.keys.some((k) => k.frame >= start && k.frame <= finish && !reusable.some((r) => r.id === k.id))) error = "插入区间包含已有关键帧，请调整时间";
    else if (evaluated.track.keys.some((k) => k.frame < start && k.frame + k.holdFrames > start)) error = "插入区间与已有停留区间冲突";
    return {start, transition, hold, finish, reusable, error};
  }, [autoStart, autoTransition, autoHold, returnWide, evaluated.track, draftPose, lastFrame, fps]);
  const recordShot = () => {
    if (autoPreview.error || !evaluated.track || !draftPose) return;
    const {start, transition, hold, finish, reusable} = autoPreview;
    const entry = reusable.find((k) => k.boundary === "start"), exit = reusable.find((k) => k.boundary === "end");
    const keys = [{...cameraKey(getCameraState(start, evaluated.track), msAtFrame(start, fps), entry?.id), ...(entry ? {boundary: "start" as const} : {})}, {...cameraKey(draftPose, msAtFrame(start + transition, fps)), holdMs: msAtFrame(hold, fps)}];
    if (returnWide) keys.push({...cameraKey(DEFAULT_CAMERA, msAtFrame(finish, fps), exit?.id), ...(exit ? {boundary: "end" as const} : {})});
    try {
      const next = {...value, keyframes: [...value.keyframes.filter((k) => !reusable.some((r) => r.id === k.id)), ...keys].sort((a, b) => resolveModelTime(a, scene, captions) - resolveModelTime(b, scene, captions))};
      compileCameraTrack(next, scene, captions, fps); commit(next); setAutoOpen(false); setDraftPose(null); setSelected(keys[1]!.id);
    } catch (error) {setMessage(errorMessage(error));}
  };
  const changeAnnotation = (id: string, patch: Partial<ModelAnnotation>) => commit({...value, annotations: value.annotations.map((a) => a.id === id ? {...a, ...patch} : a)});
  const changeAnnotationTime = (field: "timeMs" | "endMs" | "offsetMs", timeMs: number) => {
    if (!annotation) return;
    try {
      const snapped = snap(timeMs), patch = {...annotation, [field]: snapped};
      if (field === "timeMs" && annotation.cueText) patch.offsetMs = (annotation.offsetMs ?? 0) + snapped - resolveModelTime(annotation, scene, captions);
      changeAnnotation(annotation.id, patch);
    } catch (error) {setMessage(errorMessage(error));}
  };
  const selectAnnotation = (id: string, locate = false) => {
    setSelected(id); setInspectorOpen(true); setAutoOpen(false);
    if (locate) {const a = value.annotations.find((item) => item.id === id); if (a) {try {seek(localModelFrame(scene.startMs + resolveModelTime(a, scene, captions), scene, fps));} catch (error) {setMessage(errorMessage(error));}}}
  };
  const visibleAnnotations = value.annotations.flatMap((a) => {
    try {const start = localModelFrame(scene.startMs + resolveModelTime(a, scene, captions), scene, fps), end = localModelFrame(scene.startMs + a.endMs, scene, fps); return frame >= start && frame < end ? [{...a, startMs: msAtFrame(start, fps), endMs: msAtFrame(end, fps)}] : [];}
    catch {return [];}
  });
  const hasUnsavedChanges = JSON.stringify(value) !== savedSignature || draftPose !== null;
  const closeEditor = () => {
    if (saving) return;
    if (hasUnsavedChanges && !window.confirm("还有未保存的修改，关闭将丢弃这些修改。已经保存的内容会保留。确定关闭吗？")) return;
    pause(); onClose();
  };
  const saveEditor = async () => {
    if (saving) return;
    if (draftPose) {setMessage("当前视角尚未记录，请先添加或更新关键帧，或恢复当前帧视角。"); return;}
    setSaving(true); setMessage("");
    try {
      const next = validate(value);
      await onApply(next);
      setSavedSignature(JSON.stringify(next));
      setNotice("修改已保存，可以继续编辑或关闭窗口。");
    } catch (error) {setMessage(errorMessage(error));}
    finally {setSaving(false);}
  };
  const nextKey = key ? value.keyframes[value.keyframes.findIndex((k) => k.id === key.id) + 1] : undefined;
  const transitionMs = key && nextKey ? msAtFrame(keyFrame(nextKey) - keyFrame(key), fps) - key.holdMs : null;
  // 操作与参数使用原生悬停提示，不增加编辑器高度。
  const selectedBinding = annotation ?? key;
  const selectedCue = selectedBinding ? resolveRelationGraphCue({scene, captions, text: selectedBinding.cueText, occurrence: selectedBinding.cueOccurrence}) : null;
  return <div className="model-editor-backdrop"><div role="dialog" aria-modal="true" aria-labelledby="model-editor-title" aria-busy={saving} tabIndex={-1} ref={dialog} className={`model-editor ${maximized ? "is-maximized" : ""}`} onKeyDown={(event) => {
    if (event.key === "Escape") {event.stopPropagation(); closeEditor();}
    if (event.key === "Tab") {
      const nodes = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]');
      const first = nodes?.[0], last = nodes?.[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {event.preventDefault(); last?.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}
    }
    if (!saving && (event.ctrlKey || event.metaKey) && event.key === "z" && !(event.target instanceof HTMLInputElement)) {event.preventDefault(); if (event.shiftKey) redo(); else undo();}
  }}>
    <header><div><small>三维镜头 · {scene.segmentId} · {saving ? "保存中" : hasUnsavedChanges ? "有未保存修改" : "已保存"}</small><h2 id="model-editor-title">3D Model Scene 编辑器</h2></div><div className="model-editor-actions">
      <button type="button" className="secondary" title="撤销本次窗口内的上一步修改；快捷键 Ctrl/Cmd+Z。" onClick={undo} disabled={saving || !past.length || playing}>撤销</button><button type="button" className="secondary" title="恢复刚撤销的修改；快捷键 Ctrl/Cmd+Shift+Z。" onClick={redo} disabled={saving || !future.length || playing}>重做</button>
      <button type="button" className="secondary" title="展开或收起右侧参数面板；收起可扩大预览区域。" aria-expanded={inspectorOpen} onClick={() => setInspectorOpen(!inspectorOpen)}>{inspectorOpen ? "收起参数" : "展开参数"}</button>
      <button type="button" className="secondary" title="切换最大化和普通窗口，编排数据不会改变。" onClick={() => setMaximized(!maximized)}>{maximized ? "还原窗口" : "最大化"}</button><button type="button" className="secondary" title="关闭编辑器；已保存的内容会保留。" disabled={saving} onClick={closeEditor}>关闭</button>
      <button type="button" title="直接保存镜头规划；保存成功后可继续编辑或关闭。" disabled={saving || playing || !modelReady || Boolean(evaluated.error)} onClick={() => void saveEditor()}>{saving ? "保存中…" : "保存修改"}</button>
    </div></header>
    <div inert={saving} className={`model-editor-body ${inspectorOpen ? "" : "is-inspector-collapsed"}`}><div className="model-editor-stage">
      <div className="model-editor-toolbar"><span>{draftPose ? "当前视角未记录" : "轨道视角"} · {frame} 帧</span><div className="model-editor-actions">
        <button type="button" className="secondary" disabled={playing} title="恢复适配整个模型的全景视角；点击添加或更新关键帧后才会记录。" onClick={() => setDraftPose(structuredClone(DEFAULT_CAMERA))}>适配模型</button>
        <button type="button" className="secondary" disabled={playing} title="放弃尚未记录的视角调整，恢复播放头所在帧的轨道视角。" onClick={() => {setDraftPose(null); setPick(null);}}>恢复当前帧视角</button>
        <button type="button" title="保存当前视角到播放头所在帧；该帧已有关键帧时更新它，关键帧之间自动过渡。" onClick={addKey} disabled={playing || !modelReady}>{evaluated.track?.keys.some((k) => k.frame === frame) ? "更新当前关键帧" : "添加关键帧"}</button>
        <button type="button" className="secondary" disabled={playing || !currentKey || Boolean(currentKey.boundary)} title={currentKey?.boundary ? "首尾关键帧不能删除" : !currentKey ? "先定位到要删除的关键帧" : "删除当前时间点的关键帧"} onClick={deleteCurrentKey}>删除关键帧</button>
        <button type="button" className="secondary" disabled={playing || !modelReady || !draftPose || !evaluated.track} title={currentKey && !currentKey.boundary ? "此处已有关键帧，建议使用“更新当前关键帧”；自动插入会与它冲突。" : "先暂停并调整目标视角，再自动生成进入该视角的过渡和停留；区间内不能有其他关键帧。"} onClick={() => {setAutoStart(nowMs); setAutoOpen(true); setInspectorOpen(true);}}>记录当前镜头</button>
        <button type="button" className="secondary" disabled={playing || !modelReady || value.annotations.length >= 12} title="暂停后点击模型表面放置部件锚点；拖动文字框调整标签位置。最多添加 12 个标注。" onClick={() => {const id = `annotation-${crypto.randomUUID()}`; commit({...value, annotations: [...value.annotations, {id, text: "部件标注", cueText: "", timeMs: nowMs, endMs: scene.endMs - scene.startMs, style: {preset: "callout"}}]}); setSelected(id); setPick(id); setInspectorOpen(true); setAutoOpen(false);}}>添加表面标注</button>
        <button type="button" className="secondary" disabled={playing || !annotation} title={annotation ? `删除标注“${annotation.text}”` : "先选中要删除的标注"} onClick={deleteSelectedAnnotation}>删除标注</button>
        {pick ? <button type="button" className="secondary" title="退出表面拾取，不删除标注；尚未设置锚点的标注仍需补齐。" onClick={() => setPick(null)}>取消拾取</button> : null}
      </div></div>
      <div className="model-editor-viewport"><ModelViewport key={src} src={src} state={pose} editing onLoadState={setModelReady} interactive={!playing} onChange={onCameraChange} annotations={visibleAnnotations} annotationEditing={!playing ? {selectedId: selected, onSelect: (id) => selectAnnotation(id), onCommit: changeAnnotation} : undefined} onPick={pick && !playing ? (anchor) => {changeAnnotation(pick, {anchor}); setPick(null);} : undefined} /></div>
      <p className="field-hint">左键旋转 · 右键平移 · 滚轮缩放 · 拖动文字框调整标注位置{pick ? " · 点击模型表面设置部件锚点" : ""}</p>
    </div>
    {inspectorOpen ? <aside className="model-editor-inspector"><h3>{autoOpen ? "记录当前镜头" : annotation ? "标注参数" : "镜头参数"}</h3>
      {autoOpen ? <section className="model-auto-panel"><strong>待插入：{seconds(msAtFrame(autoPreview.start, fps))}–{seconds(msAtFrame(autoPreview.finish, fps))} 秒</strong><div className="model-editor-fields">
        <label><span className="model-parameter-name">起点（秒）<ModelParameterTip text="本镜头内开始移动的时间，不是目标视角的到达时间；已有关键帧占用此处时需调整。" /></span><input type="number" step={1 / fps} value={autoStart / 1000} onChange={(e) => setAutoStart(Number(e.target.value) * 1000)} /></label>
        <label><span className="model-parameter-name">过渡（秒）<ModelParameterTip text="从起点原有轨道视角移动到当前调整视角所用的时间，默认 0.8 秒。" /></span><input type="number" min={1 / fps} step={0.1} value={autoTransition / 1000} onChange={(e) => setAutoTransition(Number(e.target.value) * 1000)} /></label>
        <label><span className="model-parameter-name">停留（秒）<ModelParameterTip text="到达该视角后保持不动的时间；停留结束后开始向下一关键帧过渡。" /></span><input type="number" min={0} step={0.1} value={autoHold / 1000} onChange={(e) => setAutoHold(Number(e.target.value) * 1000)} /></label>
        <label><input type="checkbox" checked={returnWide} onChange={(e) => setReturnWide(e.target.checked)} /><span className="model-parameter-name">结束后回全景<ModelParameterTip text="在停留后追加一段返回全景的过渡，时长与进入过渡相同；不勾选时仍会沿原轨道前往后续关键帧，包括结尾。" /></span></label>
      </div><p role="status">{autoPreview.error || "确认后生成进入与停留编排。"}</p><button type="button" disabled={!modelReady || Boolean(autoPreview.error)} title="在待插入区间生成起点和目标视角关键帧；有冲突时请调整时间，原关键帧不会被覆盖。" onClick={recordShot}>确认插入</button><button type="button" className="secondary" title="关闭自动镜头设置，不插入关键帧，保留尚未记录的视角。" onClick={() => setAutoOpen(false)}>取消插入</button></section>
      : key ? <>
        <label><span className="model-parameter-name">到达时间（秒）<ModelParameterTip text="相机到达此关键帧姿态的镜头内时间；首尾固定。绑定口播后修改时间会调整绑定偏移。" /></span><input type="number" disabled={Boolean(key.boundary)} step={1 / fps} value={seconds(msAtFrame(keyFrame(key), fps))} onChange={(e) => moveKey(key.id, Number(e.target.value) * 1000)} /></label>
        <label><span className="model-parameter-name">停留（秒）<ModelParameterTip text="到达该视角后保持不动的时间；停留结束后开始向下一关键帧过渡。" /></span><input type="number" disabled={key.boundary === "end" || lastFrame === 0} min={0} step={0.1} value={key.holdMs / 1000} onChange={(e) => changeKey({holdMs: snap(Number(e.target.value) * 1000)})} /></label>
        <label><span className="model-parameter-name">缓动<ModelParameterTip text="控制到下一关键帧的速度变化：匀速、逐渐加速、逐渐减速或先加速后减速。" /></span><select value={key.easing} onChange={(e) => changeKey({easing: e.target.value as CameraKeyframe["easing"], easingRange: undefined})}><option value="linear">匀速</option><option value="ease-in">缓入</option><option value="ease-out">缓出</option><option value="ease-in-out">缓入缓出</option></select></label>
        {transitionMs !== null && nextKey ? <label><span className="model-parameter-name">到下一关键帧过渡（秒）<ModelParameterTip text="当前姿态停留结束后，到达下一姿态所需时间；修改会移动下一中间关键帧，下一帧为结尾时则调整当前停留。" /></span><input type="number" min={1 / fps} step={0.1} value={seconds(transitionMs)} onChange={(e) => {const ms = snap(Number(e.target.value) * 1000); if (nextKey.boundary) {const hold = msAtFrame(keyFrame(nextKey) - keyFrame(key), fps) - ms; if (hold < 0 || ms <= 0) setMessage("过渡时间超出首尾边界，请调整"); else changeKey({holdMs: snap(hold)});} else moveKey(nextKey.id, msAtFrame(keyFrame(key), fps) + key.holdMs + ms);}} /></label> : null}
        <label><span className="model-parameter-name">FOV<ModelParameterTip text="相机视野角度（10–100°）：数值越小画面越近，越大视野越广。" /></span><input type="number" min={10} max={100} value={key.fov} onChange={(e) => changeKey({fov: Number(e.target.value)})} /></label>
        {key.boundary ? <p className="field-hint">{keyLabel(key, 0)}关键帧固定在镜头边界，可调整视角，不能删除或绑定口播。</p> : <><label><span className="model-parameter-name">绑定口播（可选）<ModelParameterTip text="填写当前镜头中的连续口播文字，读到该片段时到达此姿态；留空使用镜头内时间。首尾不能绑定。" /></span><input value={key.cueText ?? ""} onChange={(e) => changeKey({cueText: e.target.value, offsetMs: 0})} /></label><label><span className="model-parameter-name">出现次数<ModelParameterTip text="同一段绑定文字重复出现时，使用第几次匹配，从 1 开始。" /></span><input type="number" min={1} max={20} value={key.cueOccurrence ?? 1} onChange={(e) => changeKey({cueOccurrence: Number(e.target.value)})} /></label><label><span className="model-parameter-name">绑定偏移（秒）<ModelParameterTip text="相对于匹配口播开始时间的偏移：正数延后，负数提前；仅在绑定口播后生效。" /></span><input type="number" step={1 / fps} value={(key.offsetMs ?? 0) / 1000} onChange={(e) => changeKey({offsetMs: snap(Number(e.target.value) * 1000)})} /></label></>}
      </> : annotation ? <ModelAnnotationInspector annotation={annotation} fps={fps} onChange={(patch) => changeAnnotation(annotation.id, patch)} onTime={changeAnnotationTime} onPick={() => setPick(annotation.id)} /> : <p>首尾关键帧已自动生成。选择关键帧或标注调整参数。</p>}
      {selectedBinding?.cueText?.trim() ? <p className={selectedCue ? "relation-cue-ok" : "relation-cue-warning"}>{selectedCue ? `${absoluteSeconds(frame) * 1000 >= selectedCue.startMs && absoluteSeconds(frame) * 1000 <= selectedCue.endMs ? "当前激活 · " : ""}匹配 ${(selectedCue.startMs / 1000).toFixed(2)} 秒` : `口播绑定“${selectedBinding.cueText}”未匹配当前场景，请修改或清空`}</p> : null}
    </aside> : null}</div>
    <section className="model-editor-timeline"><div className="model-editor-transport"><div className="model-editor-actions">
      <button type="button" className="secondary" disabled={!modelReady || !evaluated.track} title="随口播播放相机轨道；暂停后可调整视角和标注。尚未记录的视角不会用于播放。" onClick={() => {if (playing) pause(); else playFrom(frame);}}>{playing ? "暂停" : "从当前位置播放"}</button>
      <button type="button" className="secondary" disabled={!modelReady || !evaluated.track} title="从本镜头第一帧开始，随口播预览已记录的相机轨道。" onClick={() => playFrom(0)}>从头预览</button>
      <button type="button" className="secondary" title="暂停并向前定位一帧，恢复该帧的轨道视角。" onClick={() => seek(frame - 1)}>上一帧</button><button type="button" className="secondary" title="暂停并向后定位一帧，恢复该帧的轨道视角。" onClick={() => seek(frame + 1)}>下一帧</button><span>{seconds(nowMs)} / {seconds(msAtFrame(lastFrame, fps))} 秒</span>
    </div><input title="拖动定位本镜头时间；会暂停播放并恢复对应帧的轨道视角。" aria-label="镜头播放头" type="range" min={0} max={lastFrame} value={frame} onChange={(e) => seek(Number(e.target.value))} /></div>
    <div className="model-keyframe-list" title="点击关键帧定位并编辑参数；首尾自动生成。中间关键帧可在下方轨道拖动时间。" aria-label="关键帧时间列表"><strong>关键帧 · {value.keyframes.length}</strong>{value.keyframes.map((k, index) => <button type="button" key={k.id} aria-pressed={selected === k.id} className={`model-keyframe-chip is-${k.boundary ?? "middle"} ${selected === k.id ? "is-selected" : ""}`} onClick={() => {setSelected(k.id); setInspectorOpen(true); setAutoOpen(false); seek(keyFrame(k));}}>{keyLabel(k, index)} · {seconds(msAtFrame(keyFrame(k), fps))}s</button>)}</div>
    <div className="model-time-ruler" aria-hidden="true">{[0, 0.25, 0.5, 0.75, 1].map((ratio) => <span key={ratio}>{seconds(msAtFrame(lastFrame, fps) * ratio)}s</span>)}</div>
    <div className="model-camera-track" aria-label="相机关键帧轨道" onDragOver={(e) => e.preventDefault()} onDrop={(e) => {e.preventDefault(); const id = e.dataTransfer.getData("text/model-key"), rect = e.currentTarget.getBoundingClientRect(); moveKey(id, (e.clientX - rect.left) / rect.width * msAtFrame(lastFrame, fps));}}><span className="model-playhead" style={{left: `${frame / Math.max(1, lastFrame) * 100}%`}} />{value.keyframes.map((k, i) => <button key={k.id} type="button" draggable={!playing && !k.boundary} aria-label={`${keyLabel(k, i)}关键帧，${seconds(msAtFrame(keyFrame(k), fps))} 秒`} title={`${keyLabel(k, i)} · ${seconds(msAtFrame(keyFrame(k), fps))} 秒 · ${k.boundary ? "首尾时间固定，可更新视角" : "点击编辑；拖动调整时间"}`} className={`${selected === k.id ? "is-selected" : ""} ${k.boundary ? "is-boundary" : ""}`} style={{left: `${keyFrame(k) / Math.max(1, lastFrame) * 100}%`}} onDragStart={(e) => {pause(); e.dataTransfer.setData("text/model-key", k.id);}} onClick={() => {setSelected(k.id); setInspectorOpen(true); setAutoOpen(false); seek(keyFrame(k));}}>{k.boundary ? "▣" : "◆"}</button>)}</div>
    <div className="model-annotation-track">{value.annotations.map((a) => {let start = a.timeMs; try {start = resolveModelTime(a, scene, captions);} catch { /* 绑定错误仍可选中修复。 */ } const total = scene.endMs - scene.startMs; return <div className="model-annotation-row" key={a.id}><button type="button" title={`${a.text} · ${seconds(start)}–${seconds(a.endMs)}s · 点击定位到标注开始时间并编辑参数`} className={selected === a.id ? "is-selected" : "secondary"} style={{left: `${Math.max(0, Math.min(98, start / total * 100))}%`, width: `${Math.max(2, Math.min(100, (a.endMs - start) / total * 100))}%`}} onClick={() => selectAnnotation(a.id, true)}>{a.anchor ? "●" : "○"} {a.text || "未填写标注"} · {seconds(start)}–{seconds(a.endMs)}s</button></div>;})}</div>
    <ModelNarrationDocument captions={captions} scene={scene} plan={value} selectedId={selected} nowMs={absoluteSeconds(frame) * 1000} onSeek={(ms) => seek(localModelFrame(ms, scene, fps))} /></section>
    {notice && !message && !evaluated.error ? <p className="model-editor-notice" role="status">{notice}</p> : null}
    {(message || evaluated.error) ? <p className="model-editor-error" role="alert">{message || evaluated.error}</p> : null}
    {/* eslint-disable-next-line @remotion/warn-native-media-tag -- 仅审核音频提供播放头，正式音频仍由 Remotion 管理。 */}
    <audio ref={audio} src={audioSrc} preload="metadata" onEnded={() => setPlaying(false)} onError={() => {pause(); setMessage("口播音频加载失败，请检查后重试");}} />
  </div></div>;
};
