"use client";

import {useEffect, useRef, useState} from "react";
import {Icon} from "./Icon";

type TimedSegment = {id: string; startMs: number; endMs: number; speechStartMs?: number; speechEndMs?: number};
type Narration = {durationMs: number; voice?: string; segments?: TimedSegment[]};

const clock = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export const AudioReview: React.FC<{
  src: string;
  narration: Narration;
  segments: Array<{id: string; spokenText: string}>;
  busy: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  approveLabel?: string;
  compact?: boolean;
}> = ({src, narration, segments, busy, onApprove, onReject, approveLabel, compact = false}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const segmentRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingPlayRef = useRef<Promise<void> | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const durationMs = narration.durationMs || 0;
  const activeId = narration.segments?.find((item) => currentMs >= item.startMs && currentMs < item.endMs)?.id;
  const seek = (milliseconds: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = milliseconds / 1000;
    setCurrentMs(milliseconds);
  };
  const startPlayback = () => {
    const audio = audioRef.current;
    // 同一轮 play 尚未兑现前不再发起请求，避免双击与重渲染互相中断。
    if (!audio || !audio.paused || pendingPlayRef.current) return;
    setPlaybackError(null);
    let request: Promise<void>;
    try {
      request = audio.play();
    } catch {
      setPlaybackError("音频暂时无法播放，请稍后重试。");
      return;
    }
    pendingPlayRef.current = request;
    void request.catch((error: unknown) => {
      // 切换步骤或主动暂停会拒绝尚未开始的播放请求，这是预期的浏览器行为。
      if (error instanceof DOMException && error.name === "AbortError") return;
      setPlaybackError("音频暂时无法播放，请稍后重试。");
    }).finally(() => {
      if (pendingPlayRef.current === request) pendingPlayRef.current = null;
    });
  };
  const pausePlayback = () => {
    pendingPlayRef.current = null;
    audioRef.current?.pause();
  };
  useEffect(() => () => {
    pendingPlayRef.current = null;
    audioRef.current?.pause();
  }, []);
  useEffect(() => {
    if (!activeId) return;
    const activeElement = segmentRefs.current.get(activeId);
    if (!activeElement) return;
    // 播放段落变化时保持当前口播内容可见，减少长稿试听时的手动滚动。
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    activeElement.scrollIntoView({behavior, block: "nearest"});
  }, [activeId]);
  if (compact) return <div className="audio-review audio-review-inline" aria-label="试听已生成配音">
    {/* Native audio is intentional: this is a review control, outside the Remotion composition timeline. */}
    {/* eslint-disable-next-line @remotion/warn-native-media-tag */}
    <audio ref={audioRef} src={src} preload="metadata" onTimeUpdate={(event) => setCurrentMs(Math.round(event.currentTarget.currentTime * 1000))} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setPlaybackError("音频文件加载失败，请刷新后重试。")} />
    <span className="audio-review-inline-label"><Icon name="volume" />配音已生成，可试听</span>
    <button type="button" className="secondary" disabled={busy} onClick={() => playing ? pausePlayback() : startPlayback()}><Icon name="play" />{playing ? "暂停" : "试听"}</button>
    <input aria-label="音频播放进度" type="range" min={0} max={durationMs || 1} value={Math.min(currentMs, durationMs)} onChange={(event) => seek(Number(event.target.value))} />
    <span className="metadata">{clock(currentMs)} / {clock(durationMs)}</span>
    <button type="button" disabled={busy || !onApprove} onClick={() => onApprove?.()}><Icon name="arrow-right" />进入音频试听</button>
  </div>;
  return <section className="panel audio-review" aria-labelledby="audio-review-title">
    <div className="panel-heading"><div><p className="review-section-label">第 3 步 · 音频试听</p><h2 id="audio-review-title" className="icon-label"><Icon name="volume" />确认口播节奏</h2></div><span className="metadata">{narration.voice || "当前音色"} · {clock(durationMs)}</span></div>
    {/* Native audio is intentional: this is a review control, outside the Remotion composition timeline. */}
    {/* eslint-disable-next-line @remotion/warn-native-media-tag */}
    <audio ref={audioRef} src={src} preload="metadata" onTimeUpdate={(event) => setCurrentMs(Math.round(event.currentTarget.currentTime * 1000))} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setPlaybackError("音频文件加载失败，请刷新后重试。")} />
    <div className="audio-review-controls">
      <button type="button" className="secondary icon-only" aria-label={playing ? "暂停播放" : "播放音频"} title={playing ? "暂停播放" : "播放音频"} data-tooltip={playing ? "暂停" : "播放"} onClick={() => playing ? pausePlayback() : startPlayback()}><Icon name="play" /></button>
      <input aria-label="音频播放进度" type="range" min={0} max={durationMs || 1} value={Math.min(currentMs, durationMs)} onChange={(event) => seek(Number(event.target.value))} />
      <span className="metadata">{clock(currentMs)} / {clock(durationMs)}</span>
    </div>
    {playbackError ? <p className="hint" role="status">{playbackError}</p> : null}
    <div className="audio-review-segments" aria-label="按段落试听">
      {segments.map((segment, index) => {
        const timing = narration.segments?.find((item) => item.id === segment.id);
        return <button type="button" key={segment.id} ref={(element) => {
          if (element) segmentRefs.current.set(segment.id, element);
          else segmentRefs.current.delete(segment.id);
        }} className={`audio-review-segment ${activeId === segment.id ? "is-active" : ""}`} disabled={!timing} onClick={() => seek(timing?.speechStartMs ?? timing?.startMs ?? 0)}>
          <span>{String(index + 1).padStart(2, "0")}</span><p>{segment.spokenText}</p>
        </button>;
      })}
    </div>
    <div className="actions"><button type="button" className="secondary" disabled={busy || !onReject} onClick={() => onReject?.()}><Icon name="edit" />退回修改</button><button type="button" disabled={busy || !onApprove} onClick={() => onApprove?.()}><Icon name="arrow-right" />{approveLabel ?? "确认"}</button></div>
  </section>;
};
