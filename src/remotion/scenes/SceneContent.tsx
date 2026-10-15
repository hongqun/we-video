import type {Caption, VideoScene} from "../schema";
import {TemplateSurface} from "../templates/TemplateSurface";
import {getTemplateStatus} from "../templates/registry";
import {PresenterStage} from "../PresenterStage";
import {OpeningStage} from "../OpeningStage";

export const SceneContent: React.FC<{scene: VideoScene; durationInFrames: number; captions?: Caption[]}> = ({scene, durationInFrames, captions = []}) => {
  if (scene.rollType === "a-roll") {
    // 首镜头重点词使用成片与编辑预览共用的字幕时间戳。
    if (scene.templateId === "ip/opening-stage") return <OpeningStage scene={scene} durationInFrames={durationInFrames} captions={captions} />;
    return <PresenterStage scene={scene} durationInFrames={durationInFrames} />;
  }
  const status = getTemplateStatus(scene);
  if (!status.usable) throw new Error(`镜头 ${scene.segmentId} 的模板不可用：${status.reason}`);
  return <TemplateSurface scene={scene} captions={captions} />;
};
