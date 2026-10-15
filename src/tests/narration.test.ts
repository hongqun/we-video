import {strict as assert} from "node:assert";
import {promises as fs} from "node:fs";
import path from "node:path";
import {prepareNarrationSource} from "../lib/narration-source";
import {loadCoverImageRequirementTemplate, loadNarrationSystemPrompt, loadNarrationUserPrompt, loadScriptSystemPrompt, loadScriptUserPrompt, loadVisualRequirementTemplate, loadVisualSystemPrompt, renderNarrationPrompt} from "../lib/narration-prompts";
import {assertScriptSegmentsMatchSource, normalizeNarrationDraft, validateNarrationDraft, type NarrationDraft} from "../lib/narration";
import {deleteNarrationSegment} from "../lib/narration-segments";
import {mergeNarrationSegmentWithPrevious, splitNarrationSegment} from "../lib/narration-segments";
import {profilesRoot, readPlatformProfile} from "../lib/profile";

const main = async () => {
  const source = await prepareNarrationSource({type: "text", title: "测试", text: "这是一个用于测试口播稿来源准备和代码定位的中文正文。\n```ts\nconst answer = 42;\n```", sourceLanguage: "auto"}, "example.test");
  assert.equal(source.type, "text");
  assert.equal(source.detectedLanguage, "mixed");
  assert.equal((source.codeBlocks as Array<Record<string, unknown>>)[0].id, "code-01");
  assert.match(source.sha256, /^[a-f0-9]{64}$/);

  const scriptInput = "**大模型** says: `Keep`  空格。\n- 第二段！";
  const scriptText = "大模型 says: Keep  空格。\n第二段！";
  const scriptSource = await prepareNarrationSource({type: "script", text: scriptInput, sourceLanguage: "auto"}, "example.test");
  assert.equal(scriptSource.type, "script");
  assert.equal(scriptSource.originalText, scriptText);
  const scriptRaw = {
    title: "口播稿标题",
    shortTitle: "口播稿",
    summary: "简介 #口播,#测试,#原稿",
    narrationSegments: [
      {id: "ignored", spokenText: "大模型 says: Keep  空格。\n", pauseAfter: "medium"},
      {id: "ignored", spokenText: "第二段！", pauseAfter: "long"},
    ],
  };
  assert.doesNotThrow(() => assertScriptSegmentsMatchSource(scriptRaw, scriptSource));
  assert.throws(() => assertScriptSegmentsMatchSource({...scriptRaw, narrationSegments: [{spokenText: "大语言模型 says: Keep  空格。\n第二段！"}]}, scriptSource), /逐字一致/);
  const normalizedScript = normalizeNarrationDraft(scriptRaw, scriptSource, {narration: {targetSeconds: 75}} as never, null);
  assert.equal(normalizedScript.narrationSegments.map((segment) => segment.spokenText).join(""), scriptText);
  assert.equal(normalizedScript.narrationSegments[0]?.spokenText, "大模型 says: Keep  空格。\n");

  const titledScriptBody = "大模型正文，不能被改写，并保留用户输入的全部字符。";
  const titledScriptSource = await prepareNarrationSource({type: "script", text: `# **用户自定的大模型标题**\n\n${titledScriptBody}`, sourceLanguage: "auto"}, "example.test");
  assert.equal(titledScriptSource.title, "用户自定的大模型标题");
  assert.equal(titledScriptSource.originalText, titledScriptBody);
  const titledScriptRaw = {...scriptRaw, title: "模型擅自改写的标题", narrationSegments: [{spokenText: titledScriptBody, pauseAfter: "medium"}]};
  assert.doesNotThrow(() => assertScriptSegmentsMatchSource(titledScriptRaw, titledScriptSource));
  assert.equal(normalizeNarrationDraft(titledScriptRaw, titledScriptSource, {narration: {targetSeconds: 75}} as never, null).title, "用户自定的大模型标题");
  const embeddedTitleSource = await prepareNarrationSource({type: "script", text: "开场正文会保留。\n# 已选标题\n\n后续正文也会原样保留，且长度足够用于测试。", sourceLanguage: "auto"}, "example.test");
  assert.equal(embeddedTitleSource.title, "已选标题");
  assert.doesNotMatch(embeddedTitleSource.originalText, /# 已选标题/);

  // 集成断言读取当前配置目录中的本地专题，不再依赖迁移前的仓库层级。
  const promptRoot = path.join(profilesRoot(), "tech123", "series", "tech-minute");
  const narrationPrompt = await fs.readFile(path.join(promptRoot, "narration-system.md"), "utf8");
  const visualPrompt = await loadVisualSystemPrompt({promptRoot} as never);
  const visualRequirementTemplate = await loadVisualRequirementTemplate({promptRoot} as never);
  const coverImageRequirementTemplate = await loadCoverImageRequirementTemplate({promptRoot} as never);
  const latestNarrationPrompt = await loadNarrationSystemPrompt({promptRoot} as never);
  const narrationUserPrompt = await loadNarrationUserPrompt({promptRoot} as never);
  const scriptSystemPrompt = await loadScriptSystemPrompt({promptRoot} as never);
  const scriptUserPrompt = await loadScriptUserPrompt({promptRoot} as never);
  assert.match(latestNarrationPrompt, /shortTitle/);
  assert.match(latestNarrationPrompt, /16 个 Unicode 字符/);
  assert.match(narrationUserPrompt, /SOURCE_CONTEXT/);
  assert.match(scriptSystemPrompt, /逐字符完全一致/);
  assert.match(scriptUserPrompt, /直接拼接/);
  assert.doesNotMatch(narrationPrompt, /visualTemplate|visualData|visualKind|headline|视觉模板|镜头/);
  assert.doesNotMatch(narrationPrompt, /目标时长|六十到九十秒|七到十二个段落/);
  assert.match(narrationPrompt, /50~120字/);
  assert.match(visualPrompt, /当前口播段落是事实边界/);
  assert.match(visualPrompt, /不得.*编造/);
  assert.match(visualPrompt, /只输出一个 JSON 对象/);
  assert.match(visualPrompt, /`content\.title`/);
  assert.match(visualPrompt, /"title": "主标题"/);
  assert.match(visualPrompt, /`content\.subtitle`/);
  assert.match(visualPrompt, /"subtitle": "副标题"/);
  assert.match(visualPrompt, /`content\.text`/);
  assert.match(visualPrompt, /"text": "正文内容"/);
  assert.match(visualPrompt, /`content\.keywords`.*关键术语/);
  assert.match(visualPrompt, /禁止输出或推断.*模板/);
  assert.match(visualRequirementTemplate, /\{\{SPOKEN_TEXT\}\}/);
  assert.match(visualRequirementTemplate, /# 输出规格/);
  assert.match(visualRequirementTemplate, /# 构图要求/);
  assert.match(visualRequirementTemplate, /# 背景要求/);
  assert.match(visualRequirementTemplate, /必须是不透明背景/);
  assert.doesNotMatch(visualRequirementTemplate, /BACKGROUND_REQUIREMENT/);
  const transparentVisualRequirementTemplate = await loadVisualRequirementTemplate({promptRoot} as never, true);
  assert.match(transparentVisualRequirementTemplate, /# 透明背景要求/);
  assert.match(transparentVisualRequirementTemplate, /真实 alpha 通道/);
  assert.doesNotMatch(transparentVisualRequirementTemplate, /BACKGROUND_REQUIREMENT/);
  const derivedProfile = await readPlatformProfile("tech123", "tech-minute-en");
  assert.deepEqual(derivedProfile.brandOutro, {title: "Tech123", subtitle: "Science · Technology · Innovation", prompt: "Leave a comment and join the conversation"});
  assert.equal((await readPlatformProfile("tech123", "tech-minute")).brandOutro, undefined);
  assert.match(await loadVisualRequirementTemplate(derivedProfile, true), /# 透明背景要求/);
  assert.match(visualRequirementTemplate, /# 装饰限制/);
  assert.doesNotMatch(visualRequirementTemplate, /visualRequirement.*字段|标准 JSON/);
  assert.match(coverImageRequirementTemplate, /\{\{COVER_TITLE\}\}/);
  assert.match(coverImageRequirementTemplate, /1:1/);
  assert.match(coverImageRequirementTemplate, /透明/);
  const rendered = renderNarrationPrompt("{{SOURCE_CONTEXT}} {{CURRENT_DRAFT}} {{USER_FEEDBACK}}", source, {scenes: [{templateId: "bad"}], title: "当前标题", narrationSegments: []}, "语气更口语化");
  assert.doesNotMatch(rendered, /templateId|scenes/);
  assert.match(rendered, /语气更口语化/);
  const longDraft: NarrationDraft = {
    schemaVersion: "1.0",
    title: "只校验字数",
    shortTitle: "测试短标题",
    targetDurationSeconds: 75,
    captionStyle: "narration",
    source: {},
    language: {sourceLanguage: "zh", outputLanguage: "zh-CN"},
    glossary: [],
    narrationSegments: Array.from({length: 15}, (_, index) => ({
      id: `narration-${String(index + 1).padStart(2, "0")}`,
      spokenText: "这是一段符合字数限制的自然中文口播内容。",
      pauseAfter: "medium" as const,
    })),
    visualsPlanned: false,
  };
  assert.doesNotThrow(() => validateNarrationDraft(longDraft, {originalText: longDraft.narrationSegments.map((segment) => segment.spokenText).join("\n")}));
  assert.doesNotThrow(() => validateNarrationDraft({...longDraft, shortTitle: "一二三四五六七八九十一二三四五六"}, {originalText: longDraft.narrationSegments.map((segment) => segment.spokenText).join("\n")}));
  assert.doesNotThrow(() => validateNarrationDraft({...longDraft, shortTitle: ""}, {originalText: longDraft.narrationSegments.map((segment) => segment.spokenText).join("\n")}, {requireShortTitle: true}));
  assert.doesNotThrow(() => validateNarrationDraft({...longDraft, shortTitle: "一二三四五六七八九十一二三四五六七"}, {originalText: longDraft.narrationSegments.map((segment) => segment.spokenText).join("\n")}));
  assert.doesNotThrow(() => validateNarrationDraft({...longDraft, shortTitle: "English title"}, {originalText: longDraft.narrationSegments.map((segment) => segment.spokenText).join("\n")}));
  assert.doesNotThrow(() => validateNarrationDraft({...longDraft, shortTitle: undefined}, {originalText: longDraft.narrationSegments.map((segment) => segment.spokenText).join("\n")}));
  const deletableSegments = longDraft.narrationSegments.slice(0, 2);
  assert.equal(deleteNarrationSegment(deletableSegments, 0).length, 1);
  assert.equal(deleteNarrationSegment(deletableSegments, 1)[0].id, deletableSegments[0].id);
  assert.throws(() => deleteNarrationSegment(deletableSegments.slice(0, 1), 0), /至少需要保留一个/);
  const editableSegments = [
    {id: "narration-01", spokenText: "第一段用于验证按光标拆分的边界处理。", pauseAfter: "long" as const},
    {id: "narration-02", spokenText: "Second paragraph continues the explanation.", pauseAfter: "none" as const},
  ];
  const split = splitNarrationSegment(editableSegments, 0, 10);
  assert.equal(split.length, 3);
  assert.equal(split[0].pauseAfter, "medium");
  assert.equal(split[1].pauseAfter, "long");
  assert.equal(splitNarrationSegment(editableSegments, 0, 20, 10)[0].spokenText, split[0].spokenText);
  assert.throws(() => splitNarrationSegment(editableSegments, 0, 1), /4–150/);
  assert.throws(() => splitNarrationSegment([{...editableSegments[0], ttsText: "第一段"}], 0, 10), /特殊发音文本/);
  const englishMerge = mergeNarrationSegmentWithPrevious(editableSegments, 1);
  assert.match(englishMerge[0].spokenText, /。Second/);
  assert.equal(englishMerge[0].pauseAfter, "none");
  assert.equal(mergeNarrationSegmentWithPrevious([{id: "a", spokenText: "Alpha", pauseAfter: "short"}, {id: "b", spokenText: "Beta", pauseAfter: "none"}], 1)[0].spokenText, "Alpha Beta");
  assert.throws(() => mergeNarrationSegmentWithPrevious([{id: "a", spokenText: "Alpha", ttsText: "Alpha", pauseAfter: "short"}, {id: "b", spokenText: "Beta", pauseAfter: "none"}], 1), /特殊发音文本/);
  assert.throws(() => mergeNarrationSegmentWithPrevious(editableSegments, 0), /第一段/);
  console.log("Narration tests passed");
};

main().catch((error) => { console.error(error); process.exitCode = 1; });
