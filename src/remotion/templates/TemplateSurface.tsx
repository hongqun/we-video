import type {Caption, VideoScene} from "../schema";
import {SceneFrame} from "../scenes/SceneFrame";
import {getTemplateStatus} from "./registry";
import {TextReveal} from "./TextReveal";
import {VisualImage} from "./VisualImage";
import {TemplateHighlight} from "./TemplateAdapters";
import {GenericContent} from "./GenericContent";
import {RelationGraph} from "./RelationGraph";

// 模板总入口只保留当前流水线白名单，公共场景框架仍由 SceneFrame 承载。
export const getListCueStarts = (scene: VideoScene, captions: Caption[], items: string[]): number[] => {
  const start = scene.speechStartMs ?? scene.startMs;
  const end = scene.speechEndMs ?? scene.endMs;
  const chars = captions.flatMap((caption) => [...caption.text].map((character) => ({character, startMs: caption.startMs})));
  const joined = chars.map((item) => item.character).join("");
  let from = 0;
  return items.map((item, index) => {
    const needle = [...item].filter((character) => !/[\s，。！？、；：,.!?;:]/.test(character)).join("");
    const position = needle ? joined.indexOf(needle, from) : -1;
    if (position >= 0) {
      from = position + needle.length;
      return chars[position]?.startMs ?? start;
    }
    return start + ((end - start) * index) / Math.max(1, items.length);
  });
};

export const endCardSummaryText = (scene: VideoScene, text: string) => {
  const configured = text.trim();
  if (configured) return configured;
  const spoken = scene.spokenText.trim().replace(/^(?:总结一下|总的来说|总结)[，,:：\s]*/, "");
  return [...spoken].length > 64 ? `${[...spoken].slice(0, 63).join("")}…` : spoken;
};

export const TemplateSurface: React.FC<{scene: VideoScene; captions?: Caption[]}> = ({scene, captions = []}) => {
  const status = getTemplateStatus(scene);
  if (!status.usable) return null;
  const sceneContent = scene.content;
  if (!sceneContent) throw new Error("TemplateSurface 缺少 scene.content");
  // 模板统一消费场景通用内容；图片等运行参数只从 manifest 的 templateData 读取。
  const text = sceneContent.text || sceneContent.title;
  const items = sceneContent.keywords;
  let rendered: React.ReactNode;
  switch (status.definition?.renderer) {
    case "text-reveal": rendered = <TextReveal scene={scene} text={text} fontStyle={scene.templateData?.fontStyle} />; break;
    case "text-highlight": rendered = <TemplateHighlight scene={scene} captions={captions} text={text} items={items} />; break;
    case "visual-image": rendered = <VisualImage scene={scene} captions={captions} />; break;
    case "generic-content": rendered = <GenericContent scene={scene} />; break;
    case "relation-graph": rendered = <RelationGraph scene={scene} captions={captions} />; break;
    default: return null;
  }
  return <SceneFrame scene={scene} presentationMode={status.definition?.presentationMode} supportingTextPlacement={status.definition?.supportingTextPlacement} consumesMainAsset={Boolean(status.definition?.requiresMedia)}>{rendered}</SceneFrame>;
};
