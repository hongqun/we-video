import type {RenderManifest} from "@/remotion/schema";

// 当前模板白名单不再请求账号级 Logo 或地图媒体；段落图片已在确认阶段写入 templateData。
export const resolveManifestMedia = async (manifest: RenderManifest, outputDir: string): Promise<RenderManifest> => {
  void outputDir;
  return manifest;
};
export const manifestNeedsMediaResolution = (manifest: RenderManifest) => {
  void manifest;
  return false;
};
