import type {CoverConfig} from "./schema";

type CoverSourceScene = {
  content: {text: string; subtitle: string; title: string; keywords: string[]};
  presenter: {poseId: string};
};

// 封面默认值是纯数据计算，单独放在共享模块，避免客户端引用视觉规划的 Node 文件。
export const defaultCover = (title: string, scene: CoverSourceScene): CoverConfig => ({
  title: title.trim(),
  subtitle: (scene.content.text || scene.content.subtitle || scene.content.title).trim(),
  keywords: [...new Set(scene.content.keywords.map((keyword) => keyword.trim()).filter(Boolean))].slice(0, 8),
  presenterPoseId: scene.presenter.poseId,
});
