"use client";
import {useMemo} from "react";
import {narrationDocumentForTimeRange} from "@/lib/visual-plan-text";
import type {Caption, VideoScene} from "@/remotion/schema";
import type {ModelScenePlan} from "@/remotion/templates/model-scene-schema";
import {resolveRelationGraphCue} from "@/remotion/templates/relation-graph";

type Props = {captions: Caption[]; scene: VideoScene; plan: ModelScenePlan; selectedId: string | null; nowMs: number; onSeek: (ms: number) => void};

export const ModelNarrationDocument = ({captions, scene, plan, selectedId, nowMs, onSeek}: Props) => {
  const document = useMemo(() => narrationDocumentForTimeRange(captions, scene.startMs, scene.endMs), [captions, scene.startMs, scene.endMs]);
  // 与关系图共用匹配规则；参考多边形口播文档，只在绑定片段末尾显示编号。
  const bindings = useMemo(() => [
    ...plan.keyframes.map((item, index) => ({...item, label: `镜头${index + 1}`})),
    ...plan.annotations.map((item, index) => ({...item, label: `标注${index + 1}`})),
  ].flatMap((item) => {
    const cue = resolveRelationGraphCue({scene, captions, text: item.cueText, occurrence: item.cueOccurrence});
    if (!cue) return [];
    const indexes = document.times.flatMap((time, index) => time.endMs > cue.startMs && time.startMs < cue.endMs ? [index] : []);
    return indexes.length ? [{id: item.id, label: item.label, first: indexes[0]!, last: indexes.at(-1)!}] : [];
  }), [plan.keyframes, plan.annotations, scene, captions, document]);
  let offset = 0;
  return <div className="model-caption-document" aria-label="口播文档"><p>{Array.from(document.text).map((character) => {
    const index = offset;
    offset += character.length;
    const time = document.times[index]!;
    const owners = bindings.filter((binding) => index >= binding.first && index <= binding.last);
    const endings = owners.filter((binding) => index + character.length - 1 >= binding.last);
    return <span key={index} className={`${nowMs >= time.endMs ? "is-played" : nowMs >= time.startMs ? "is-current" : ""} ${owners.length ? owners.some((owner) => owner.id === selectedId) ? "is-current-reference" : "is-reference" : ""}`} title={owners.length ? owners.map((owner) => owner.label).join("、") : "点击定位播放头"} onClick={() => onSeek(time.startMs)}>{character}{endings.length ? <sup>{endings.map((item) => item.label).join("、")}</sup> : null}</span>;
  })}</p></div>;
};
