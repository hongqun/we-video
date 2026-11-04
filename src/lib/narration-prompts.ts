import {promises as fs} from "node:fs";
import path from "node:path";
import {promptRoots, type PlatformProfile} from "./profile";

export const readPromptEntry = async (profile: PlatformProfile, fileName: string, label: string): Promise<{value: string; source: string}> => {
  // 口播提示词不再按版本号选择，固定文件由内容维护者直接原地修改。
  // 派生专栏通常只维护翻译提示词；缺少视觉/封面模板时沿用母专栏的固定模板。
  // 任务快照已经解析全部优先级，不再受后续部署覆盖影响。
  if (profile.snapshot) {
    const value = profile.resolvedPrompts?.[fileName];
    if (!value) throw new Error(`任务提示词快照缺少 ${fileName}`);
    return {value, source: "任务快照"};
  }
  const deployment = process.env.TALK_VIDEO_PROMPT_DIR?.trim();
  if (deployment) {
    try {
      const value = (await fs.readFile(path.join(path.resolve(process.cwd(), deployment), fileName), "utf8")).trim();
      if (!value) throw new Error(`${label}不能为空`);
      return {value, source: "部署覆盖（TALK_VIDEO_PROMPT_DIR）"};
    } catch (e) {if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;}
  }
  if (profile.resolvedPrompts?.[fileName]) return {value: profile.resolvedPrompts[fileName], source: "专栏覆盖"};
  const roots = [...promptRoots(profile), path.join(process.cwd(), "content/defaults")];
  for (const root of roots) {
    const file = path.join(root, fileName);
    try {
      // 母专栏通过界面保存的覆盖也可被派生专栏继承。
      if (profile.sourceSeriesId && path.basename(root) === profile.sourceSeriesId) {
        const parent = JSON.parse(await fs.readFile(path.join(root, "series.json"), "utf8"));
        if (parent.promptOverrides?.[fileName]) return {value: String(parent.promptOverrides[fileName]), source: "母专栏覆盖"};
      }
      const value = (await fs.readFile(file, "utf8")).trim();
      if (!value) throw new Error(`${label}不能为空：${file}`);
      return {value, source: root === path.join(process.cwd(), "content/defaults") ? "系统默认" : root === profile.promptRoot ? "专栏文件" : "母专栏文件"};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error(`未找到提示词：${fileName}`);
};

export const readFixedPrompt = async (profile: PlatformProfile, fileName: string, label: string) => (await readPromptEntry(profile, fileName, label)).value;

export const loadNarrationSystemPrompt = (profile: PlatformProfile) => readFixedPrompt(profile, "narration-system.md", "口播系统提示词");
export const loadNarrationUserPrompt = (profile: PlatformProfile) => readFixedPrompt(profile, "narration-user.md", "口播用户提示词");
export const loadScriptSystemPrompt = (profile: PlatformProfile) => readFixedPrompt(profile, "script-system.md", "口播稿系统提示词");
export const loadScriptUserPrompt = (profile: PlatformProfile) => readFixedPrompt(profile, "script-user.md", "口播稿用户提示词");
export const loadTranslationSystemPrompt = (profile: PlatformProfile) => readFixedPrompt(profile, "translation-system.md", "翻译系统提示词");
export const loadTranslationUserPrompt = (profile: PlatformProfile) => readFixedPrompt(profile, "translation-user.md", "翻译用户提示词");
export const loadTranslationStagePrompt = (profile: PlatformProfile, stage: "segmentation" | "visual") => readFixedPrompt(profile, `translation-${stage}.md`, "翻译阶段提示词");
export const renderTranslationPrompt = (template: string, source: Record<string, unknown>) => template
  // 全文翻译只提供正文与标题信息，不把镜头或段落边界传给模型。
  .replace("{{TRANSLATION_CONTEXT}}", JSON.stringify(source));
// 段落配图共性规则只维护一份，背景规则按本次生成选项注入。
export const loadVisualRequirementTemplate = async (profile: PlatformProfile, transparentBackground = false) => {
  const template = await readFixedPrompt(profile, "visual-requirement-template.md", "视觉要求模板");
  const background = await readFixedPrompt(profile, transparentBackground ? "visual-background-transparent.md" : "visual-background-opaque.md", "视觉背景要求");
  return template.replace("{{BACKGROUND_REQUIREMENT}}", background).trim();
};
export const loadCoverImageRequirementTemplate = (profile: PlatformProfile) => readFixedPrompt(profile, "cover-image-requirement-template.md", "封面图片要求模板");
export const loadVisualSystemPrompt = (profile: PlatformProfile) => readFixedPrompt(profile, "visual-system.md", "视觉系统提示词");

export const renderNarrationPrompt = (template: string, source: Record<string, unknown>, draft: Record<string, unknown> | null, feedback: string) => template
  // 原文和代码定位目录一并注入，保证生成稿可以回溯来源事实。
  .replace("{{SOURCE_CONTEXT}}", `原文语言：${String(source.effectiveLanguage)}\n原文标题：${String(source.title || "未提供")}\n代码块定位目录：${JSON.stringify(source.codeBlocks ?? [], null, 2)}\n原文内容：\n${String(source.originalText)}`)
  .replace("{{CURRENT_DRAFT}}", JSON.stringify(draft ? Object.fromEntries(Object.entries(draft).filter(([key]) => !["source", "scenes", "visualsPlanned"].includes(key))) : {}, null, 2))
  .replace("{{USER_FEEDBACK}}", feedback);
