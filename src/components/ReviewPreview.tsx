"use client";

import dynamic from "next/dynamic";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {PlayerRef} from "@remotion/player";
import type {ArtifactManifest, VideoScene} from "@/remotion/schema";
import {Icon} from "./Icon";
import {
  DRAFT_SCENE_DURATION_MS,
  draftSceneStartFrame,
  manifestSceneStartFrame,
  reviewAudioStatusLabel,
  sceneIndexAtTime,
  type ReviewAudioStatus,
} from "@/lib/review";

// Keep every @remotion/player consumer out of the Next.js server/RSC bundle.
const DraftScenesPreview = dynamic(
  () => import("./DraftScenesPreview").then(({DraftScenesPreview: Component}) => Component),
  {ssr: false},
);
const VideoPlayer = dynamic(
  () => import("./VideoPlayer").then(({VideoPlayer: Component}) => Component),
  {ssr: false},
);

export type DraftReviewScene = {
  id: string;
  segmentId: string;
  spokenText: string;
  content: VideoScene["content"];
  templateId: string;
  rollType: VideoScene["rollType"];
  presenterMode: VideoScene["presenterMode"];
  presenterPoseId: VideoScene["presenterPoseId"];
  presenterPlacement: VideoScene["presenterPlacement"];
  presenterFraming?: VideoScene["presenterFraming"];
};

type SceneRailProps = {
  scenes: DraftReviewScene[];
  activeSceneId: string | null;
  onSelect: (sceneId: string) => void;
};

const SceneRail: React.FC<SceneRailProps> = ({scenes, activeSceneId, onSelect}) => (
  <nav className="review-scene-rail" aria-label="场景导航">
    <div className="review-scene-rail-heading">
      <strong>语义故事轨</strong>
      <span>{scenes.length} 个</span>
    </div>
    <div className="review-scene-list">
      {scenes.map((scene, index) => (
        <button
          className={`review-scene-item ${scene.id === activeSceneId ? "is-active" : ""}`}
          key={scene.id}
          type="button"
          aria-current={scene.id === activeSceneId ? "step" : undefined}
          onClick={() => onSelect(scene.id)}
        >
          <span className="review-scene-number">{String(index + 1).padStart(2, "0")}</span>
          <span className="review-scene-copy">
            <strong>{scene.content.title || "未命名场景"}</strong>
          </span>
        </button>
      ))}
    </div>
  </nav>
);

type ReviewPreviewProps = {
  manifest: ArtifactManifest | null;
  draftScenes: DraftReviewScene[];
  title: string;
  audioStatus: ReviewAudioStatus;
  isRendering: boolean;
  activeSceneId: string | null;
  isHistorical: boolean;
  busy: boolean;
  onSceneSelect: (sceneId: string | null) => void;
  onOpenScript: (sceneId?: string) => void;
  onProduceAudio: () => void;
  onRender: () => void;
  feedbackOpen: boolean;
  onToggleFeedback: () => void;
  sceneSeekRequest?: {sceneId: string; token: number} | null;
  onFrameChange?: (frame: number) => void;
  compact?: boolean;
  showActions?: boolean;
  showSceneRail?: boolean;
};

export const ReviewPreview: React.FC<ReviewPreviewProps> = ({
  manifest,
  draftScenes,
  title,
  audioStatus,
  isRendering,
  activeSceneId,
  isHistorical,
  busy,
  onSceneSelect,
  onOpenScript,
  onProduceAudio,
  onRender,
  feedbackOpen,
  onToggleFeedback,
  sceneSeekRequest = null,
  onFrameChange,
  compact = false,
  showActions = true,
  showSceneRail = true,
}) => {
  const playerRef = useRef<PlayerRef>(null);
  const lastSeekRequestRef = useRef<number | null>(null);
  const [isOutro, setIsOutro] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const sceneWindows = useMemo(
    () => manifest?.contentMode === "narration"
      ? manifest.scenes
      : draftScenes.map((scene, index) => ({
          id: scene.id,
          startMs: index * DRAFT_SCENE_DURATION_MS,
          endMs: (index + 1) * DRAFT_SCENE_DURATION_MS,
        })),
    [draftScenes, manifest],
  );
  const railScenes = useMemo(
    () => manifest?.contentMode === "narration" ? manifest.scenes : draftScenes,
    [draftScenes, manifest],
  );
  const visibleSceneId = isOutro ? null : activeSceneId ?? sceneWindows[0]?.id ?? null;

  const handleFrameChange = useCallback((frame: number) => {
    onFrameChange?.(frame);
    const fps = manifest?.video.fps ?? 30;
    const sceneIndex = sceneIndexAtTime(sceneWindows, (frame / fps) * 1000);
    if (sceneIndex < 0) {
      setIsOutro(true);
      if (activeSceneId !== null) onSceneSelect(null);
      return;
    }
    setIsOutro(false);
    if (sceneIndex >= 0 && sceneWindows[sceneIndex]?.id !== activeSceneId) {
      onSceneSelect(sceneWindows[sceneIndex].id);
    }
  }, [activeSceneId, manifest, onFrameChange, onSceneSelect, sceneWindows]);

  const selectScene = (sceneId: string) => {
    setIsOutro(false);
    onSceneSelect(sceneId);
    const sceneIndex = sceneWindows.findIndex((scene) => scene.id === sceneId);
    const scene = sceneWindows[sceneIndex];
    if (!scene) return;
    playerRef.current?.seekTo(
      manifest ? manifestSceneStartFrame(scene, manifest.video.fps) : draftSceneStartFrame(sceneIndex),
    );
  };

  const togglePlayback = () => {
    const player = playerRef.current;
    if (!player) return;
    if (player.isPlaying()) player.pause();
    else void player.play();
  };

  const restartPlayback = () => {
    const player = playerRef.current;
    if (!player) return;
    player.seekTo(0);
    void player.play();
  };

  useEffect(() => {
    if (!sceneSeekRequest || lastSeekRequestRef.current === sceneSeekRequest.token) return;
    const sceneIndex = sceneWindows.findIndex((scene) => scene.id === sceneSeekRequest.sceneId);
    const scene = sceneWindows[sceneIndex];
    if (!scene) return;
    lastSeekRequestRef.current = sceneSeekRequest.token;
    playerRef.current?.seekTo(
      manifest ? manifestSceneStartFrame(scene, manifest.video.fps) : draftSceneStartFrame(sceneIndex),
    );
  }, [manifest, sceneSeekRequest, sceneWindows]);

  const audioStatusText = isHistorical ? "历史版本 · 仅可试听" : reviewAudioStatusLabel[audioStatus];
  const mediaAssets = manifest?.contentMode === "narration" ? manifest.media : undefined;
  const resolvedLogos = mediaAssets?.logos.filter((asset) => asset.status === "resolved").length ?? 0;
  const fallbackLogos = mediaAssets?.logos.filter((asset) => asset.status !== "resolved").length ?? 0;

  return (
    <section className={`review-preview ${compact ? "review-preview-compact" : ""} ${showSceneRail ? "" : "review-preview-solo"}`}>
      <div className="review-preview-heading">
        <div>
          <p className="review-section-label">{manifest ? "试听与预览" : "草稿预览"}</p>
          <h2>{title || "未命名视频"}</h2>
        </div>
        <span className={`review-audio-status review-audio-status-${audioStatus}`}>
          <span className="review-audio-dot" />
          {audioStatusText}
        </span>
      </div>
      {mediaAssets ? (
        <div className="review-media-status" aria-label="媒体资产状态">
          <span className="metadata">媒体资产</span>
          <span className="metadata">Logo {resolvedLogos} 个已解析{fallbackLogos ? `，${fallbackLogos} 个使用 fallback` : ""}</span>
          {mediaAssets.maps.map((map) => <span className="metadata" key={map.id}>地图：{map.status === "resolved" ? "已加载" : "缺失"}</span>)}
        </div>
      ) : null}
      <div className="review-preview-stage">
        {showActions ? <div className="review-preview-actions">
          <button
            className="secondary"
            type="button"
            onClick={() => onOpenScript(activeSceneId ?? draftScenes[0]?.id)}
            disabled={busy || !draftScenes.length}
          >
            <Icon name="edit" />修改
          </button>
          <button
            type="button"
            onClick={onProduceAudio}
            disabled={busy || isHistorical || audioStatus === "synthesizing" || audioStatus === "planning" || audioStatus === "ready"}
          >
            <Icon name="volume" />
            {audioStatus === "review" ? "确认音频" : "确认口播稿并生成配音"}
          </button>
          <button
            className="secondary"
            type="button"
            onClick={onRender}
            disabled={!isRendering && (busy || isHistorical || audioStatus !== "ready")}
          >
            <Icon name="play" />渲染
          </button>
          <button
            className={`secondary ${feedbackOpen ? "is-active" : ""}`}
            type="button"
            onClick={onToggleFeedback}
            disabled={busy || isHistorical}
          >
            <Icon name="sparkles" />AI
          </button>
        </div> : null}
        <div className="review-player-frame">
          {manifest ? (
            <VideoPlayer
              manifest={manifest}
              playerRef={playerRef}
              onFrameChange={handleFrameChange}
              onPlaybackStateChange={setIsPlaying}
            />
          ) : (
            <DraftScenesPreview
              scenes={draftScenes}
              playerRef={playerRef}
              onFrameChange={handleFrameChange}
              onPlaybackStateChange={setIsPlaying}
            />
          )}
        </div>
        <div className="review-preview-controls" aria-label="视频播放控制">
          <button type="button" onClick={togglePlayback} aria-label={isPlaying ? "暂停视频" : "播放视频"}>
            <Icon name="play" />{isPlaying ? "暂停" : "播放"}
          </button>
          <button type="button" className="secondary" onClick={restartPlayback}>
            <Icon name="refresh" />重新播放
          </button>
          {isOutro ? <span className="review-preview-outro-status">片尾播放中 · 3 秒</span> : null}
        </div>
        {showActions && audioStatus !== "ready" && audioStatus !== "missing" && audioStatus !== "synthesizing" && audioStatus !== "planning" && !isHistorical ? (
          <p className="review-preview-note">
            {audioStatus === "stale"
              ? "当前稿件已修改，旧配音不能用于试听或生成成片。"
              : audioStatus === "failed"
                  ? "配音生产失败，请检查错误信息后重新生产。"
                  : null}
          </p>
        ) : null}
      </div>
      {showSceneRail ? <aside className="review-preview-sidebar">
        <SceneRail scenes={railScenes} activeSceneId={visibleSceneId} onSelect={selectScene} />
      </aside> : null}
    </section>
  );
};
