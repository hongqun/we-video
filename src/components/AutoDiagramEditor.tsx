/* eslint-disable @remotion/warn-native-media-tag -- 审核弹窗使用原口播音频驱动 Player。 */
"use client";
import {useCallback, useEffect, useId, useMemo, useRef, useState} from "react";
import dynamic from "next/dynamic";
import type {PlayerRef} from "@remotion/player";
import type {Caption, RenderManifest, VideoScene} from "@/remotion/schema";
import type {VisualPlan} from "@/lib/visual-plan";
import type {readDiagramSnapshot} from "@/lib/diagram/service";
import {diagramDataSchema, diagramSchedule, diagramSvgAtFrame} from "@/remotion/templates/auto-diagram-schema";
import {sceneFrameSpan} from "@/remotion/timeline";
import {DiagramManualEditor} from "./DiagramManualEditor";

const TemplatePreview = dynamic(() => import("./TemplatePreview").then((module) => module.TemplatePreview), {ssr: false});
type Snapshot = Awaited<ReturnType<typeof readDiagramSnapshot>>;
export const AutoDiagramEditor: React.FC<{jobId: string; sceneId: string; scene: VideoScene; captions: Caption[]; audioSrc: string; brand: RenderManifest["brand"]; presenter: NonNullable<RenderManifest["presenter"]>; visualStyle?: RenderManifest["visualStyle"]; hasPrevious: boolean; onPlan: (plan: VisualPlan) => void; onClose: () => void}> = ({jobId, sceneId, scene, captions, audioSrc, brand, presenter, visualStyle, hasPrevious, onPlan, onClose}) => {
  const namespace = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [instruction, setInstruction] = useState("请根据当前镜头口播选择适合的图型，设计清晰的图表，并自动绑定口播逐步出现。遵循当前视频风格和人物安全区。");
  const [bindings, setBindings] = useState<NonNullable<Snapshot["candidate"]>["data"]["bindings"]>([]);
  // 播放选项与口播绑定一起保存，避免未保存设置被直接采用。
  const [showFullDiagramFirst, setShowFullDiagramFirst] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  // 默认聚焦图表本身，成片构图另行切换；缩放只影响编辑预览。
  const [previewMode, setPreviewMode] = useState<"diagram" | "complete" | "scene">("diagram");
  const [previewZoom, setPreviewZoom] = useState(1);
  const [expandedPreview, setExpandedPreview] = useState(false);
  // 手工草稿留在本地，显式保存后才更新候选并允许采用。
  const [manual, setManual] = useState(false);
  const [manualDirty, setManualDirty] = useState(false);
  const previewViewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = previewViewport.current;
    if (!viewport) return;
    viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2);
    viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2);
  }, [previewZoom, previewMode, expandedPreview]);
  // 对话只滚动内部记录；用户翻看历史时暂停自动跟随。
  const messagesArea = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const candidateSignature = useRef("");
  const audio = useRef<HTMLAudioElement>(null);
  const player = useRef<PlayerRef>(null);
  const endpoint = `/api/jobs/${encodeURIComponent(jobId)}/scenes/${encodeURIComponent(sceneId)}/diagram`;
  const receive = useCallback((next: Snapshot) => {
    // 文本更新保留未变化的候选引用，避免播放器随每个流式片段重新定位。
    setSnapshot((previous) => previous && JSON.stringify(previous.candidate) === JSON.stringify(next.candidate) ? {...next, candidate: previous.candidate} : next);
    const signature = JSON.stringify({bindings: next.candidate?.data.bindings, showFullDiagramFirst: next.candidate?.data.showFullDiagramFirst ?? false});
    if (signature !== candidateSignature.current) {candidateSignature.current = signature; setBindings(next.candidate?.data.bindings ?? []); setShowFullDiagramFirst(next.candidate?.data.showFullDiagramFirst ?? false);}
  }, []);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {document.body.style.overflow = previousOverflow;};
  }, []);
  useEffect(() => {
    let disposed = false, polling = false;
    let fallback: ReturnType<typeof setInterval> | undefined;
    const refresh = async () => {
      if (polling) return; polling = true;
      try {const response = await fetch(endpoint, {cache: "no-store"}); const data = await response.json(); if (!response.ok) throw new Error(data.error); if (!disposed) receive(data);}
      catch (cause) {if (!disposed) setError(cause instanceof Error ? cause.message : "读取图表失败");}
      finally {polling = false;}
    };
    // SSE 负责实时消息，重连期间退回快照轮询，关闭窗口后立即释放连接。
    const events = new EventSource(`${endpoint}?stream=1`);
    events.addEventListener("snapshot", (event: MessageEvent<string>) => {if (!disposed) receive(JSON.parse(event.data) as Snapshot);});
    events.onopen = () => {if (fallback) clearInterval(fallback); fallback = undefined;};
    events.onerror = () => {if (!fallback) {void refresh(); fallback = setInterval(() => void refresh(), 1800);}};
    return () => {disposed = true; events.close(); if (fallback) clearInterval(fallback);};
  }, [endpoint, receive]);
  useEffect(() => {
    const area = messagesArea.current;
    if (area && followLatest.current) area.scrollTop = area.scrollHeight;
  }, [snapshot?.session.messages]);
  const running = snapshot?.session.status === "running";
  const bindingDirty = JSON.stringify(bindings) !== JSON.stringify(snapshot?.candidate?.data.bindings ?? []) || showFullDiagramFirst !== (snapshot?.candidate?.data.showFullDiagramFirst ?? false);
  const send = async (action: string, payload: Record<string, unknown> = {}): Promise<Snapshot | null> => {
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({action, ...payload, ...(action === "send" ? {message: instruction} : {}), ...(action === "bindings" ? {bindings, showFullDiagramFirst} : {})})});
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "图表操作失败");
      if (data.plan) onPlan(data.plan); else receive(data);
      if (action === "send") {setInstruction(""); followLatest.current = true;}
      return data.plan ? null : data as Snapshot;
    } catch (cause) {setError(cause instanceof Error ? cause.message : "图表操作失败");}
    finally {setBusy(false);}
    return null;
  };
  const preview = useMemo(() => {
    if (!snapshot?.candidate) return null;
    try {
      const source = snapshot.candidate.data;
      const data = diagramDataSchema.parse(source);
      let playable = true;
      try {diagramSchedule(scene, captions, data);} catch {playable = false;}
      return {scene: {...scene, templateData: data}, playable, svg: diagramSvgAtFrame(data, [], 0, true, namespace)};
    } catch {return null;}
  }, [snapshot?.candidate, scene, captions, namespace]);
  const seekAudio = () => {
    if (!audio.current) return;
    const now = audio.current.currentTime * 1000;
    if (now >= scene.endMs) {audio.current.pause(); audio.current.currentTime = scene.endMs / 1000; setPlaying(false);}
    const {from, durationInFrames} = sceneFrameSpan(scene, 30);
    player.current?.seekTo(Math.max(0, Math.min(durationInFrames - 1, Math.round(now * 30 / 1000) - from)));
  };
  return <div className="auto-diagram-modal" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="auto-diagram-title" className="auto-diagram-window">
    <header className="auto-diagram-header"><h3 id="auto-diagram-title">图表编辑</h3><div className="auto-diagram-preview-tools">
          <div className="auto-diagram-tabs"><button type="button" disabled={manual} aria-pressed={previewMode === "diagram"} onClick={() => {setPreviewMode("diagram"); setPreviewZoom(1);}}>口播同步</button><button type="button" disabled={manual} aria-pressed={previewMode === "complete"} onClick={() => {setPreviewMode("complete"); setPreviewZoom(1);}}>完整图</button><button type="button" disabled={manual} aria-pressed={previewMode === "scene"} onClick={() => {setPreviewMode("scene"); setPreviewZoom(1);}}>成片画面</button></div>
          <button type="button" className="secondary" aria-pressed={manual} disabled={busy || (!manual && (running || !preview || Boolean(snapshot?.stale) || bindingDirty))} title={bindingDirty ? "请先保存口播绑定" : "拖动分组，修改文字、字号和颜色"} onClick={() => {
            if (manualDirty && !window.confirm("放弃未保存的手工调整并返回？")) return;
            audio.current?.pause(); setPlaying(false); setManualDirty(false); setManual((value) => !value);
          }}>{manual ? "返回对话编辑" : "手工调整"}</button>
          <button type="button" className="secondary" disabled={manual} aria-pressed={expandedPreview} onClick={() => setExpandedPreview((value) => !value)}>{expandedPreview ? "返回编辑" : "放大预览"}</button>
        </div><button type="button" className="secondary" disabled={busy} title="关闭后生成会继续" onClick={() => {if (!manualDirty || window.confirm("放弃未保存的手工调整并关闭？")) onClose();}}>关闭</button></header>
    {manual && snapshot?.candidate ? <>
      {error ? <p className="auto-diagram-notice diagram-manual-error" role="alert">{error}</p> : null}
      <DiagramManualEditor data={snapshot.candidate.data} busy={busy} disabled={Boolean(running || snapshot.stale)} errors={snapshot.validationErrors} onDirty={setManualDirty} onSave={async (data, baseData) => (await send("drawing", {drawing: {data, baseData}}))?.candidate?.data ?? null} />
    </> : <>
    {/* 三个区域独立排版，主预览保持居中，对话只占窄侧栏。 */}
    <div className="auto-diagram-columns" data-expanded={expandedPreview}>
      <aside className="auto-diagram-chat" aria-label="图表对话">
        <div className="auto-diagram-section-heading"><h4>对话修改</h4><span className="auto-diagram-status" data-running={running}>{running ? "生成中" : snapshot?.session.status === "ready" ? "待采用" : "图表 Agent"}</span></div>
        <div className="auto-diagram-messages" ref={messagesArea} role="log" aria-live="polite" aria-relevant="text additions" onScroll={(event) => {const area = event.currentTarget; followLatest.current = area.scrollHeight - area.scrollTop - area.clientHeight < 48;}}>
          {snapshot?.session.messages.length ? snapshot.session.messages.map((message, index) => {
            // 工具返回值显示简洁校验结果，原始 JSON 不挤占对话空间。
            let text = message.text;
            if (message.role === "tool") {
              try {const report = JSON.parse(text); text = report.valid ? "图表与口播绑定校验通过。" : (report.errors ?? []).join("；") || "正在校验图表。";} catch { /* 兼容历史纯文本校验记录。 */ }
            }
            return <article key={message.id} data-role={message.role}><strong>{message.role === "user" ? "你" : message.role === "tool" ? "校验" : "图表 Agent"}</strong><p>{text}{running && index === snapshot.session.messages.length - 1 && message.role === "assistant" ? <span className="auto-diagram-cursor" aria-label="正在输出">▍</span> : null}</p></article>;
          }) : <p className="auto-diagram-empty">描述想要的图表或修改方式，生成后在右侧预览和调整绑定。</p>}
        </div>
        <p className="auto-diagram-progress" role="status" title={snapshot?.session.progress}>{snapshot?.session.progress ?? "连接会话…"}</p>
        {snapshot?.unavailable || snapshot?.stale || error || snapshot?.session.error ? <p className="auto-diagram-notice" role="alert" title={snapshot?.unavailable || error || snapshot?.session.error}>{snapshot?.unavailable || error || snapshot?.session.error || "镜头上下文已变化，请发送指令重新制图。"}</p> : null}
        <form className="auto-diagram-composer" onSubmit={(event) => {event.preventDefault(); if (snapshot && !busy && !running && instruction.trim() && !snapshot.unavailable) void send("send");}}>
          <textarea aria-label="图表修改指令" rows={3} value={instruction} disabled={busy || running} placeholder="例如：改成横向流程，突出最后一个节点" onChange={(event) => setInstruction(event.target.value)} />
          <div className="auto-diagram-actions"><button className="secondary" type="button" disabled={busy || (!running && (!snapshot || Boolean(snapshot.unavailable) || !snapshot.session.messages.some((item) => item.role === "user")))} onClick={() => void send(running ? "cancel" : "retry")}>{running ? "取消生成" : "重新生成"}</button><button className="primary" type="submit" disabled={!snapshot || busy || running || !instruction.trim() || Boolean(snapshot.unavailable)}>{busy || running ? "处理中…" : "发送指令"}</button></div>
        </form>
      </aside>
      <section className="auto-diagram-preview" aria-label="图表预览">
        <div className="auto-diagram-stage">
          <div className="auto-diagram-preview-viewport" ref={previewViewport} tabIndex={0} aria-label="图表画布，放大后可滚动查看细节">
            {preview ? <div className="auto-diagram-preview-canvas" style={{width: `min(calc(100cqw * ${previewZoom}), calc(100cqh * ${(previewMode === "scene" ? 1080 / 1260 : 960 / 800) * previewZoom}))`}}>
              {previewMode === "complete" ? <div className="auto-diagram-full" dangerouslySetInnerHTML={{__html: preview.svg}} /> : preview.playable ? <TemplatePreview scene={preview.scene} sceneStartMs={scene.startMs} sceneEndMs={scene.endMs} captions={captions} brand={brand} presenter={presenter} visualStyle={visualStyle} playing={playing} audioRef={audio} playerRef={player} diagramOnly={previewMode === "diagram"} /> : <div className="auto-diagram-empty"><p>绑定尚未通过校验</p><button type="button" className="secondary" onClick={() => setPreviewMode("complete")}>查看完整图</button></div>}
            </div> : <div className="auto-diagram-empty"><strong>{running ? "正在设计图表…" : "等待生成图表"}</strong><p>发送指令后，图表将在这里出现。</p></div>}
          </div>
          <div className="auto-diagram-zoom" aria-label="预览缩放"><button type="button" className="secondary" aria-label="缩小图表" disabled={previewZoom <= 1} onClick={() => setPreviewZoom((value) => Math.max(1, value - .25))}>−</button><button type="button" className="secondary" title="恢复适应窗口" onClick={() => setPreviewZoom(1)}>{Math.round(previewZoom * 100)}%</button><button type="button" className="secondary" aria-label="放大图表" disabled={!preview || previewZoom >= 3} onClick={() => setPreviewZoom((value) => Math.min(3, value + .25))}>＋</button></div>
        </div>
      </section>
      <section className="auto-diagram-binding-panel" aria-label="口播绑定">
        <div className="auto-diagram-section-heading"><h4>口播绑定</h4><span>{bindings.length} 个分组</span></div>
        <label className="auto-diagram-overview"><input type="checkbox" checked={showFullDiagramFirst} disabled={busy || running || !snapshot?.candidate || Boolean(snapshot?.stale)} onChange={(event) => setShowFullDiagramFirst(event.target.checked)} /><span>先展示完整图，再逐项显示</span></label>
        <p className="auto-diagram-spoken" title={scene.spokenText}>{scene.spokenText}</p>
        <div className="auto-diagram-binding-columns"><span>分组 / 触发词</span><span>第几次</span></div>
        <div className="auto-diagram-bindings">
          {bindings.length ? bindings.map((binding, index) => {
            return <label key={binding.groupId}><span className="auto-diagram-binding-name" title={binding.name}>{index + 1}. {binding.name}</span><input aria-label={`${binding.name} 触发词`} value={binding.cueText} disabled={busy || running} onChange={(event) => setBindings((old) => old.map((item, i) => i === index ? {...item, cueText: event.target.value} : item))} /><input aria-label={`${binding.name} 出现次数`} type="number" min={1} max={100} value={binding.occurrence} disabled={busy || running} onChange={(event) => setBindings((old) => old.map((item, i) => i === index ? {...item, occurrence: Number(event.target.value)} : item))} /></label>;
          }) : <p className="auto-diagram-empty">生成图表后，在这里设置各分组的口播触发词。</p>}
        </div>
        <p className="auto-diagram-binding-state" data-invalid={Boolean(snapshot?.validationErrors.length)} role="status" title={snapshot?.validationErrors.join("；")}>{snapshot?.validationErrors.length ? snapshot.validationErrors.join("；") : bindingDirty ? "绑定或播放选项已修改，请保存校验。" : bindings.length ? "时间由字幕区间推算，可播放口播确认。" : "绑定触发词需来自当前镜头口播。"}</p>
        {/* 校验失败的候选允许直接重验，支持文件修复后重新执行完整检查。 */}
        <button type="button" className="secondary auto-diagram-save" disabled={busy || running || (!bindingDirty && !snapshot?.validationErrors.length) || snapshot?.stale} onClick={() => void send("bindings")}>保存并校验</button>
      </section>
    </div>
    </>}
    {/* 播放和采用共用单行底栏，释放预览上下的可用高度。 */}
    <footer className="auto-diagram-footer"><span>{manualDirty ? "图表有未保存的手工调整" : bindingDirty ? "绑定或播放选项有未保存的修改" : snapshot?.canAdopt ? "图表已通过校验，可以采用" : "预览并完成绑定校验后采用"}</span><audio ref={audio} src={audioSrc} controls onLoadedMetadata={() => {if (audio.current) audio.current.currentTime = scene.startMs / 1000;}} onPlay={() => {if (audio.current && (audio.current.currentTime * 1000 < scene.startMs || audio.current.currentTime * 1000 >= scene.endMs)) audio.current.currentTime = scene.startMs / 1000; setPlaying(true);}} onPause={() => setPlaying(false)} onTimeUpdate={seekAudio} onSeeked={seekAudio} /><div className="auto-diagram-actions"><button type="button" className="secondary" disabled={busy || running || manualDirty || !hasPrevious} onClick={() => void send("withdraw")}>撤回上次采用</button><button type="button" className="primary" disabled={busy || running || manualDirty || bindingDirty || !snapshot?.canAdopt} onClick={() => void send("adopt")}>采用到镜头</button></div></footer>
  </section></div>;
};
