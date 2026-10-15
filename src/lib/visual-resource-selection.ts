// 纯数据选择逻辑，客户端可以安全复用；文件系统和 sharp 只留在服务端资源模块。
export type SceneVisualResource = {
  segmentId: string;
  sceneId?: string;
  imagePath?: string;
  imageWidth?: number;
  imageHeight?: number;
  polygons: Array<{text: string; points: Array<{x: number; y: number}>}>;
};

export type SceneVisualResources = {resources: SceneVisualResource[]};

// 未拆分镜头仍可读取旧的 segment 资源；一旦该段出现 scene 资源，就不再让旧资源泄漏到其他镜头。
export const visualResourceForScene = (resources: SceneVisualResources, sceneId: string, segmentId: string) => {
  const exact = resources.resources.find((item) => item.sceneId === sceneId);
  if (exact) return exact;
  if (resources.resources.some((item) => item.sceneId && item.segmentId === segmentId)) return undefined;
  return resources.resources.find((item) => !item.sceneId && item.segmentId === segmentId);
};
