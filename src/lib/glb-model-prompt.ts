import {promises as fs} from "node:fs";
import path from "node:path";
import {readJob, readJson, revisionDir} from "./jobs";
import {promptRoots, readJobPlatformProfile, type PlatformProfile} from "./profile";

export type GlbPromptSource = "当前专题" | "继承专题" | "系统默认";
export type GlbPromptResult = {prompt: string; templateSource: GlbPromptSource};

// 无专题模板时仍能使用；与 GLB 上传限制保持一致，不调用生成模型。
export const DEFAULT_GLB_MODEL_TEMPLATE = `根据上传的参考图片，还原主体并生成完整的三维物体模型，导出可下载的 GLB（glTF 2.0）文件。
- 保留物体形状、比例、颜色和可见零件；不可见部分合理推断，不虚构复杂细节。
- 必须有真实厚度与连续、合理的三维几何体，不得使用平面图片或纸片模型。
- 使用适合实时渲染的 PBR 材质，合理优化网格和纹理；不将图片背景、阴影或光照做进模型。
- 主体完整，无地面、背景、底座、摄像机或无关物体，适合绕中心 360° 展示。
- 模型居中，Y 轴向上，默认正面朝 +Z；适合 Three.js、React Three Fiber 和 Remotion。
- 几何体、材质和纹理全部打包到单个不超过 50MB 的 GLB，允许普通或 Draco 压缩网格，禁止外部资源、Meshopt、KTX2；确保可由 GLTFLoader 配合 DRACOLoader 加载。
优先保证结构、外观和几何合理性，不为艺术效果改变参考物体。

{{NARRATION_CONTEXT}}`;

export const loadGlbModelTemplate = async (profile: PlatformProfile): Promise<{template: string; templateSource: GlbPromptSource}> => {
  const sourceRoot = profile.sourceSeriesId ? path.resolve(profile.promptRoot, "..", profile.sourceSeriesId) : null;
  for (const root of promptRoots(profile)) {
    try {
      const template = (await fs.readFile(path.join(root, "glb-model-template.md"), "utf8")).trim();
      if (!template) throw new Error("GLB 提示词模板不能为空，请检查专题中的 glb-model-template.md");
      return {template, templateSource: sourceRoot === path.resolve(root) ? "继承专题" : "当前专题"};
    } catch (error) {
      // 仅文件不存在时继续查找，配置损坏和权限错误需要明确暴露。
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return {template: DEFAULT_GLB_MODEL_TEMPLATE, templateSource: "系统默认"};
};

export const renderGlbModelPrompt = (template: string, spokenText: string, includeNarration: boolean) => {
  const context = includeNarration ? `### 当前镜头口播上下文（仅供识别主体和重点部件）
以下文字只帮助识别物体型号、理解展示重点，外观以参考图片为准。
不得依据口播虚构内部结构、标签、装饰或附件。图片与口播矛盾时，先请求用户澄清。
<narration_context>
${spokenText.trim()}
</narration_context>` : "";
  // 自定义模板不含占位符时追加上下文，关闭开关则不注入任何口播。
  return (template.includes("{{NARRATION_CONTEXT}}") ? template.replaceAll("{{NARRATION_CONTEXT}}", context) : `${template}${context ? `\n\n${context}` : ""}`).trim();
};

export const generateGlbModelPrompt = async (jobId: string, segmentId: string, spokenText: string, includeNarration: boolean): Promise<GlbPromptResult> => {
  const job = await readJob(jobId);
  const draft = await readJson<{narrationSegments?: Array<{id: string}>}>(path.join(revisionDir(jobId, job.currentRevision), "draft.json"));
  if (!draft.narrationSegments?.some((segment) => segment.id === segmentId)) throw new Error("未找到目标口播段落");
  if (includeNarration && !spokenText.trim()) throw new Error("当前镜头口播为空，请关闭附带口播或补齐口播内容");
  const profile = await readJobPlatformProfile(job.contentProfile);
  const {template, templateSource} = await loadGlbModelTemplate(profile);
  return {prompt: renderGlbModelPrompt(template, spokenText, includeNarration), templateSource};
};
