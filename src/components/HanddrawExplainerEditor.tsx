/* eslint-disable @remotion/warn-native-media-tag -- 编辑器用确认过的口播音轨驱动单镜预览。 */
"use client";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import dynamic from "next/dynamic";
import type {PlayerRef} from "@remotion/player";
import type {Caption, RenderManifest, VideoScene} from "@/remotion/schema";
import type {VisualPlan} from "@/lib/visual-plan";
import type {readExplainerSnapshot} from "@/lib/handdraw-explainer/service";
import {assertExplainerFrames, resolveExplainerPaths} from "@/remotion/templates/handdraw-explainer-schema";
import {sceneFrameSpan} from "@/remotion/timeline";

const TemplatePreview = dynamic(() => import("./TemplatePreview").then((module) => module.TemplatePreview), {ssr: false});
type Snapshot = Awaited<ReturnType<typeof readExplainerSnapshot>>;
export const HanddrawExplainerEditor = ({jobId, sceneId, scene, captions, audioSrc, brand, presenter, visualStyle, hasPrevious, url, onPlan, onClose}: {jobId: string; sceneId: string; scene: VideoScene; captions: Caption[]; audioSrc: string; brand: RenderManifest["brand"]; presenter: NonNullable<RenderManifest["presenter"]>; visualStyle: RenderManifest["visualStyle"]; hasPrevious: boolean; url: (relative: string) => string; onPlan: (plan: VisualPlan) => void; onClose: () => void}) => {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [instruction, setInstruction] = useState("根据当前口播设计清晰的手绘讲解，使用简洁插画和必要的手写短标签，按讲述顺序逐笔绘制。");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(scene.startMs);
  const [complete, setComplete] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const player = useRef<PlayerRef>(null);
  const messages = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const endpoint = `/api/jobs/${encodeURIComponent(jobId)}/scenes/${encodeURIComponent(sceneId)}/handdraw-explainer`;
  const receive = useCallback((next: Snapshot) => {
    // 进度更新保留相同候选引用，避免正在播放的画布被轮询重建。
    setSnapshot((previous) => previous && JSON.stringify(previous.candidate) === JSON.stringify(next.candidate) ? {...next, candidate: previous.candidate} : next);
  }, []);
  useEffect(() => {
    let disposed = false, polling = false;
    const refresh = async () => {
      if (polling) return; polling = true;
      try {const response = await fetch(endpoint, {cache: "no-store"}); const data = await response.json(); if (!response.ok) throw new Error(data.error); if (!disposed) receive(data);}
      catch (cause) {if (!disposed) setError(cause instanceof Error ? cause.message : "读取镜头失败");}
      finally {polling = false;}
    };
    const events = new EventSource(`${endpoint}?stream=1`);
    events.addEventListener("snapshot", (event: MessageEvent<string>) => {if (!disposed) receive(JSON.parse(event.data) as Snapshot);});
    let fallback: ReturnType<typeof setInterval> | undefined;
    events.onerror = () => {if (!fallback) {void refresh(); fallback = setInterval(() => void refresh(), 2500);}};
    events.onopen = () => {if (fallback) clearInterval(fallback); fallback = undefined;};
    void refresh();
    return () => {disposed = true; events.close(); if (fallback) clearInterval(fallback);};
  }, [endpoint, receive]);
  useEffect(() => {
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => {document.body.style.overflow = previous;};
  }, []);
  useEffect(() => {if (messages.current && followLatest.current) messages.current.scrollTop = messages.current.scrollHeight;}, [snapshot?.session.messages]);
  useEffect(() => {
    audio.current?.pause(); player.current?.pause(); setPlaying(false); setTime(scene.startMs);
    if (audio.current?.readyState) audio.current.currentTime = scene.startMs / 1000;
  }, [snapshot?.candidate?.data.cacheKey, scene.startMs]);
  useEffect(() => {
    if (!playing) return;
    let handle = 0;
    // timeupdate 的频率不足以守住单镜边界，按浏览器帧及时暂停，避免播放到下一段口播。
    const tick = () => {
      if ((audio.current?.currentTime ?? 0) * 1000 >= scene.endMs) {
        audio.current?.pause(); player.current?.pause(); setPlaying(false); setTime(scene.endMs); return;
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, scene.endMs]);
  const running = snapshot?.session.status === "running";
  const preview = useMemo(() => {
    if (!snapshot?.candidate || snapshot.stale) return null;
    try {const data = assertExplainerFrames(scene, snapshot.candidate.data); return {...scene, templateData: resolveExplainerPaths(data, url)};}
    catch {return null;}
  }, [scene, snapshot?.candidate, snapshot?.stale, url]);
  const pause = () => {audio.current?.pause(); player.current?.pause(); setPlaying(false);};
  const seek = (value: number) => {
    const target = Math.max(scene.startMs, Math.min(scene.endMs, value));
    if (audio.current) audio.current.currentTime = target / 1000;
    player.current?.seekTo(Math.max(0, Math.min(sceneFrameSpan(scene, 30).durationInFrames - 1, Math.round(target * .03) - sceneFrameSpan(scene, 30).from)));
    setTime(target);
  };
  const play = async () => {
    if (!audio.current || !preview) return;
    if (playing) {pause(); return;}
    if (audio.current.currentTime * 1000 >= scene.endMs - 35 || audio.current.currentTime * 1000 < scene.startMs) seek(scene.startMs);
    try {await audio.current.play(); setPlaying(true);} catch {setError("口播播放失败，请检查音频加载后重试");}
  };
  const action = async (name: "send" | "retry" | "cancel" | "adopt" | "withdraw") => {
    pause(); setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({action: name, ...(name === "send" ? {message: instruction} : {})})});
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "操作失败");
      if (data.plan) onPlan(data.plan as VisualPlan); else receive(data as Snapshot);
      if (name === "send") setInstruction("");
    } catch (cause) {setError(cause instanceof Error ? cause.message : "操作失败");}
    finally {setBusy(false);}
  };
  return <div className="handdraw-explainer-overlay" role="presentation">
    <section className="handdraw-explainer-dialog" role="dialog" aria-modal="true" aria-labelledby="handdraw-explainer-title">
      <header className="handdraw-explainer-heading"><div><p className="review-section-label">手绘讲解</p><h2 id="handdraw-explainer-title">设计当前镜头</h2></div><button type="button" className="secondary" onClick={() => {pause(); onClose();}}>关闭</button></header>
      <div className="handdraw-explainer-body">
        <div className="handdraw-explainer-conversation">
          <p className="hint">当前口播：{scene.spokenText}</p>
          <div ref={messages} className="handdraw-explainer-messages" aria-live="polite" onScroll={(event) => {const area = event.currentTarget; followLatest.current = area.scrollHeight - area.scrollTop - area.clientHeight < 48;}}>{snapshot?.session.messages.map((message) => <div key={message.id} className={`handdraw-explainer-message is-${message.role}`}><strong>{message.role === "user" ? "你的要求" : message.role === "assistant" ? "设计回复" : "制作进度"}</strong><p>{message.text}</p></div>)}</div>
          <p role="status" className="hint">{snapshot?.session.progress ?? "正在读取镜头…"}</p>
          {snapshot?.unavailable ? <p className="field-hint">{snapshot.unavailable}</p> : null}
          {snapshot?.session.error || error ? <p role="alert" className="error-text">{error || snapshot?.session.error}</p> : null}
          <label>画面要求<textarea rows={4} value={instruction} disabled={busy || running} onChange={(event) => setInstruction(event.target.value)} placeholder="描述想画的内容，或提出修改意见" /></label>
          <div className="actions"><button type="button" disabled={busy || running || !snapshot || Boolean(snapshot.unavailable) || !instruction.trim()} onClick={() => void action("send")}>{snapshot?.candidate ? "修改画面" : "开始制作"}</button>{running ? <button type="button" className="secondary" disabled={busy} onClick={() => void action("cancel")}>取消制作</button> : <button type="button" className="secondary" disabled={busy || !snapshot || Boolean(snapshot.unavailable) || !snapshot.session.messages.some((item) => item.role === "user")} onClick={() => void action("retry")}>重试上次要求</button>}</div>
        </div>
        <div className="handdraw-explainer-preview">
          <div className="actions"><button type="button" className={!complete ? "" : "secondary"} onClick={() => {pause(); setComplete(false);}}>带声镜头预览</button><button type="button" className={complete ? "" : "secondary"} onClick={() => {pause(); setComplete(true);}}>完整成图</button></div>
          <div className="handdraw-explainer-preview-stage">{complete && snapshot?.candidate ? <img src={url(snapshot.candidate.data.completePath)} alt="手绘讲解完成图" /> : preview ? <TemplatePreview scene={preview} captions={captions} audioRef={audio} playerRef={player} playing={playing} sceneStartMs={scene.startMs} sceneEndMs={scene.endMs} brand={brand} presenter={presenter} visualStyle={visualStyle} /> : <p className="hint">{snapshot?.stale ? "口播或布局已变化，请重新制作。" : "制作完成后，在这里检查画面和口播配合。"}</p>}</div>
          <audio ref={audio} src={audioSrc} preload="metadata" onLoadedMetadata={() => seek(scene.startMs)} onPause={() => {setPlaying(false); player.current?.pause();}} onEnded={pause} onTimeUpdate={() => {
            const now = (audio.current?.currentTime ?? 0) * 1000;
            if (now >= scene.endMs) {pause(); setTime(scene.endMs); return;}
            setTime(now);
            const expected = Math.max(0, Math.round(now * .03) - sceneFrameSpan(scene, 30).from);
            if (player.current && Math.abs(player.current.getCurrentFrame() - expected) > 3) player.current.seekTo(expected);
          }} />
          {!complete ? <div className="handdraw-explainer-playback"><button type="button" disabled={!preview} onClick={() => void play()}>{playing ? "暂停" : "播放本镜头"}</button><input aria-label="镜头预览时间" type="range" min={scene.startMs} max={scene.endMs} step={1000 / 30} value={Math.max(scene.startMs, Math.min(scene.endMs, time))} disabled={!preview} onChange={(event) => seek(Number(event.target.value))} /><span>{Math.max(0, (time - scene.startMs) / 1000).toFixed(1)} 秒</span></div> : null}
          {snapshot?.candidate?.review ? <p className="hint">{snapshot.candidate.review.pass ? "完成图已复核。请带声预览后采用。" : `完成图待修正：${snapshot.candidate.review.issues.join("；") || snapshot.candidate.review.evidence}`}</p> : null}
          <div className="actions"><button type="button" disabled={busy || running || !snapshot?.canAdopt} onClick={() => void action("adopt")}>采用当前方案</button><button type="button" className="secondary" disabled={busy || running || !hasPrevious} onClick={() => void action("withdraw")}>恢复上次采用</button></div>
        </div>
      </div>
    </section>
  </div>;
};
