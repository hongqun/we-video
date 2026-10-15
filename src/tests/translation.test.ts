/* eslint-disable @remotion/non-pure-animation -- transition 是测试中的镜头契约字段，不是 CSS 动画。 */
import {strict as assert} from "node:assert";
import {promises as fs} from "node:fs";
import os from "node:os";
import path from "node:path";
import {splitApprovedTranslation, translationTokens} from "../lib/translation-review";

// 用独立临时任务与模型桩验证完整状态流，不调用真实模型、配音或用户任务。
const main = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "translation-review-"));
  const oldEnv = {...process.env};
  const originalFetch = globalThis.fetch;
  try {
    process.env.TALK_VIDEO_DATA_DIR = root;
    process.env.DEEPSEEK_API_KEY = "translation-test";
    process.env.DASHSCOPE_API_KEY = "translation-test";
    process.env.TALK_VIDEO_BAILIAN_WORKSPACE_ID = "translation-test";
    process.env.TALK_VIDEO_DEFAULT_VOICE = "longanhuan_v3";
    // 拆分后配置示例直接位于 Video 项目根目录。
    process.env.TALK_VIDEO_PIPELINE_CONFIG = path.resolve("config_examples/pipeline.config.example.json");
    const {prepareEnglishTask, readTranslationReview, runTranslation, submitTranslation, visualTranslationSlots, applyVisualTranslations} = await import("../lib/derivation");
    const {atomicWriteJson, initializeNarrationJob, jobDir, readJob, readJson, snapshot, updateJobState, assertTranslationReviewed} = await import("../lib/jobs");
    const {normalizeNarrationDraft, saveNarrationDraft} = await import("../lib/narration");
    const {readPlatformProfile, profileContext} = await import("../lib/profile");
    const {narrationWorkflowStep} = await import("../lib/review");
    const profile = await readPlatformProfile("tech123", "tech-minute");
    const englishProfile = await readPlatformProfile("tech123", "tech-minute-en");
    const parentId = "2026-09-15 00:00:00.001";
    const childId = "2026-09-15 00:00:00.002";
    await initializeNarrationJob(parentId, profileContext(profile));
    const source = {type: "script", title: "原始中文标题", originalText: "大语言模型调用 API。然后检查两个订单。", effectiveLanguage: "zh"};
    const parentDraft = {schemaVersion: "1.0", title: "大语言模型", captionStyle: "narration", narrationSegments: [
      {id: "part-01", spokenText: "大语言模型调用 API。", ttsText: "中文发音覆盖", pauseAfter: "short"},
      {id: "part-02", spokenText: "然后检查2个订单。", pauseAfter: "long"},
    ]};
    const parentPlan = {schemaVersion: "1.0", revision: 1, planVersion: 1, createdAt: "2026-09-15T00:00:00.000Z", scenes: [
      {id: "scene-01", segmentId: "part-01", startMs: 0, endMs: 4000, templateId: "ip/opening-stage", transition: {kind: "none", durationMs: 0}, presenter: {rollType: "a-roll", mode: "hero", poseId: "neutral", placement: "hero"}, visualData: {kind: "relation-graph", nodes: [{id: "原节点", type: "default", position: {x: 20, y: 30}, data: {label: "模型", cueText: "大语言模型"}}], edges: []}, content: {title: "大语言模型", subtitle: "", text: "", keywords: ["订单"]}},
      {id: "scene-02", segmentId: "part-02", startMs: 4000, endMs: 8000, templateId: "rve/generic-content", transition: {kind: "none", durationMs: 0}, presenter: {rollType: "b-roll", mode: "hidden", poseId: "neutral", placement: "right-lower"}, content: {title: "检查2个订单", subtitle: "", text: "", keywords: []}},
    ]};
    await atomicWriteJson(path.join(jobDir(parentId), "source.json"), source);
    await atomicWriteJson(path.join(jobDir(parentId), "draft.json"), parentDraft);
    await atomicWriteJson(path.join(jobDir(parentId), "visual-plan.json"), parentPlan);
    await atomicWriteJson(path.join(jobDir(parentId), "visual-resources.json"), {schemaVersion: "1.0", revision: 1, resources: []});
    await fs.mkdir(path.join(jobDir(parentId), "uploaded-images"));
    await fs.writeFile(path.join(jobDir(parentId), "uploaded-images", "original.txt"), "parent");
    await updateJobState(parentId, {state: "completed"});
    await prepareEnglishTask(parentId, "tech-minute-en", childId);
    const prepared = await snapshot(childId);
    assert.equal(prepared.job.contentProfile.seriesId, "tech-minute-en");
    assert.equal(prepared.job.parentJobId, parentId);
    assert.equal(prepared.draft, null);
    assert.equal(prepared.visualPlan, null);
    assert.equal(prepared.translation?.source.text, "大语言模型调用 API。\n\n然后检查2个订单。");
    assert.equal(narrationWorkflowStep(prepared.job.state), 1);
    await fs.writeFile(path.join(jobDir(childId), "uploaded-images", "original.txt"), "child");
    assert.equal(await fs.readFile(path.join(jobDir(parentId), "uploaded-images", "original.txt"), "utf8"), "parent");
    await assert.rejects(assertTranslationReviewed(childId), /确认全文/);
    await assert.rejects(saveNarrationDraft(childId, parentDraft), /确认全文/);
    // 旧任务没有 translation.json，不被新审核门槛强制回退。
    await assertTranslationReviewed(parentId);

    const english = {title: "How LLMs use APIs", shortTitle: "LLMs and APIs", summary: "A clear explanation.", text: "LLMs call an API.\n\nThen check 2 orders. "};
    let replies: unknown[] = [english];
    const prompts: string[] = [];
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as {messages: Array<{content: string}>};
      prompts.push(request.messages[1]!.content);
      if (!replies.length) throw new Error("测试禁止未预期的模型调用");
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify(reply)}}]}), {status: 200});
    };
    await updateJobState(childId, {state: "translating"});
    await assert.rejects(submitTranslation(childId, "save", english), /当前状态/);
    await runTranslation(childId, "generate");
    assert.doesNotMatch(prompts[0]!, /narrationSegments|visualPlan|pauseAfter|ttsText/);
    assert.deepEqual((await readTranslationReview(childId)).translated, english);
    assert.equal((await snapshot(childId)).draft, null);

    const pasted = {...english, text: "  LLMs call an API.\n\nThen check 2 orders.  "};
    await submitTranslation(childId, "save", pasted);
    assert.deepEqual((await snapshot(childId)).translation?.translated, pasted);
    await assert.rejects(submitTranslation(childId, "confirm", {...pasted, text: "  "}), /口播全文/);
    const concurrent = await Promise.allSettled([submitTranslation(childId, "save", pasted), submitTranslation(childId, "save", pasted)]);
    assert.ok(concurrent.some((result) => result.status === "fulfilled"));
    assert.ok(concurrent.some((result) => result.status === "rejected"));

    // 模型或分段失败必须保留人工稿；不能提前落盘正式分段。
    replies = [new Error("模拟翻译网络失败")];
    await updateJobState(childId, {state: "translating"});
    await assert.rejects(runTranslation(childId, "generate"), /模拟翻译网络失败/);
    assert.deepEqual((await readTranslationReview(childId)).translated, pasted);
    replies = [{aligned: false, starts: [], reason: "缺少第二个镜头的内容"}];
    await updateJobState(childId, {state: "segmenting_translation"});
    await assert.rejects(submitTranslation(childId, "confirm", pasted), /当前状态/);
    await assert.rejects(runTranslation(childId, "confirm"), /缺少第二个镜头/);
    assert.equal((await snapshot(childId)).draft, null);
    assert.equal((await readJob(childId)).state, "awaiting_translation_review");
    assert.equal((await readTranslationReview(childId)).confirmedAt, undefined);

    const contents = Object.fromEntries(parentPlan.scenes.map((scene) => [scene.id, {content: scene.content, ...(scene.visualData ? {visualData: scene.visualData} : {})}]));
    const slots = visualTranslationSlots(contents);
    assert.deepEqual(Object.values(slots), ["大语言模型", "订单", "模型", "大语言模型", "检查2个订单"]);
    const visualStrings = Object.fromEntries(Object.keys(slots).map((key, index) => [key, ["LLMs", "Orders", "Model", "LLMs", "Check 2 orders"][index]!]));
    // 数字内容交给提示词约束，程序允许英文数字词；未翻译的中文仍需重试。
    assert.doesNotThrow(() => applyVisualTranslations(contents, slots, {...visualStrings, "/scene-02/content/title": "Check two orders"}));
    const incompleteVisuals: Record<string, string> = {...visualStrings, "/scene-02/content/title": "检查2个订单"};
    delete incompleteVisuals["/scene-01/content/keywords/0"];
    const beforeVisualFailure = prompts.length;
    replies = [{aligned: true, starts: [4]}, incompleteVisuals, {"/scene-01/content/keywords/0": "Orders", "/scene-02/content/title": "检查2个订单"}];
    await updateJobState(childId, {state: "segmenting_translation"});
    await assert.rejects(runTranslation(childId, "confirm"), /scene-02.*content \/ title.*仍含中文.*原文：检查2个订单.*译文/);
    assert.equal(prompts.length - beforeVisualFailure, 3);
    const autoRetryInput = JSON.parse(prompts.at(-1)!);
    assert.deepEqual(Object.keys(autoRetryInput.strings).sort(), ["/scene-01/content/keywords/0", "/scene-02/content/title"]);
    assert.equal((await readTranslationReview(childId)).failedStage, "visual");
    const debug = await readJson<{attempts: Array<{response: unknown}>}>(path.join(jobDir(childId), "translation-visual-debug.json"));
    assert.equal(debug.attempts.length, 2);
    assert.ok(debug.attempts[1]?.response);
    assert.equal((await snapshot(childId)).draft, null);

    // 手动重试只请求尚未通过的字段，不再调用分段模型，也不重译已通过的文案。
    const beforeRetry = prompts.length;
    replies = [{"/scene-02/content/title": "Check two orders"}];
    await updateJobState(childId, {state: "segmenting_translation"});
    await runTranslation(childId, "confirm");
    assert.equal(prompts.length - beforeRetry, 1);
    assert.deepEqual(JSON.parse(prompts.at(-1)!).strings, {"/scene-02/content/title": "检查2个订单"});
    assert.equal((await readTranslationReview(childId)).failedStage, undefined);
    const draft = await readJson<typeof parentDraft & {visualsPlanned: boolean; language: {outputLanguage: string}}>(path.join(jobDir(childId), "draft.json"));
    assert.equal(draft.narrationSegments.map((segment) => segment.spokenText).join(""), pasted.text);
    assert.deepEqual(draft.narrationSegments.map(({id, pauseAfter}) => ({id, pauseAfter})), parentDraft.narrationSegments.map(({id, pauseAfter}) => ({id, pauseAfter})));
    assert.ok(draft.narrationSegments.every((segment) => !("ttsText" in segment)));
    assert.equal(draft.language.outputLanguage, "en-US");
    const plan = await readJson<typeof parentPlan>(path.join(jobDir(childId), "visual-plan.json"));
    assert.equal(plan.scenes[0]!.content.title, "LLMs");
    assert.equal(plan.scenes[0]!.visualData!.nodes[0]!.id, "原节点");
    assert.deepEqual(plan.scenes[0]!.visualData!.nodes[0]!.position, {x: 20, y: 30});
    assert.equal(plan.scenes[0]!.visualData!.nodes[0]!.data.label, "Model");
    assert.equal(plan.scenes[0]!.visualData!.nodes[0]!.data.cueText, "LLMs");
    assert.deepEqual(plan.scenes.map(({content: _content, visualData: _visualData, ...structure}) => { void _content; void _visualData; return structure; }), parentPlan.scenes.map(({content: _content, visualData: _visualData, ...structure}) => { void _content; void _visualData; return structure; }));
    assert.equal((await readJob(childId)).state, "awaiting_script_review");
    assert.ok((await readTranslationReview(childId)).confirmedAt);
    await assertTranslationReviewed(childId);
    const reviewedSnapshot = await snapshot(childId);
    assert.ok(reviewedSnapshot.draft);
    assert.equal(reviewedSnapshot.visualPlan?.scenes[0]?.visualData?.nodes[0]?.data.label, "Model");
    await assert.rejects(submitTranslation(childId, "generate"), /当前状态/);
    const normalized = normalizeNarrationDraft(draft, source, englishProfile, draft);
    assert.equal(normalized.title, pasted.title);
    assert.equal(normalized.narrationSegments.map((segment) => segment.spokenText).join(""), pasted.text);
    assert.equal(normalized.language.outputLanguage, "en-US");
    assert.equal(normalized.visualsPlanned, true);
    assert.deepEqual(normalized.narrationSegments.map((segment) => segment.id), ["part-01", "part-02"]);
    assert.equal(await fs.readFile(path.join(jobDir(parentId), "draft.json"), "utf8"), `${JSON.stringify(parentDraft, null, 2)}\n`);

    // 修改正文后不能复用旧分段或译文缓存，同时覆盖自动补译一次即可成功的路径。
    const changedId = "2026-09-15 00:00:00.003";
    await prepareEnglishTask(parentId, "tech-minute-en", changedId);
    for (const file of ["translation-segmentation.json", "translation-visual-progress.json"]) {
      await fs.copyFile(path.join(jobDir(childId), file), path.join(jobDir(changedId), file));
    }
    await submitTranslation(changedId, "save", {...pasted, text: pasted.text.replace("Then", "Next,")});
    const beforeChanged = prompts.length;
    replies = [{aligned: true, starts: [4]}, {...visualStrings, "/scene-02/content/title": ""}, {"/scene-02/content/title": "Check two orders"}];
    await updateJobState(changedId, {state: "segmenting_translation"});
    await runTranslation(changedId, "confirm");
    assert.equal(prompts.length - beforeChanged, 3);
    assert.ok(JSON.parse(prompts[beforeChanged]!).sourceSegments);
    assert.equal(Object.keys(JSON.parse(prompts[beforeChanged + 1]!).strings).length, Object.keys(slots).length);
    assert.equal((await readJob(changedId)).state, "awaiting_script_review");
    assert.throws(() => applyVisualTranslations(contents, slots, {...visualStrings, "/scene-02/content/title": ""}), /scene-02.*译文为空.*原文/);
    assert.throws(() => applyVisualTranslations(contents, slots, {}), /模型未返回该字段/);

    // 资源绑定进入同一翻译事务；快照独立，坐标、路径与母任务均保持不变。
    const polygonResources = {schemaVersion: "1.0", revision: 1, resources: [{sceneId: "scene-02", segmentId: "part-02", imagePath: "uploaded-images/original.txt", imageWidth: 100, imageHeight: 100, polygons: [{text: "检查2个订单", points: [{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}]}]}]};
    await atomicWriteJson(path.join(jobDir(parentId), "visual-resources.json"), polygonResources);
    const polygonId = "2026-09-15 00:00:00.004";
    await prepareEnglishTask(parentId, "tech-minute-en", polygonId);
    await submitTranslation(polygonId, "save", pasted);
    // 母任务资源后续变化不应改变已复制的快照。
    await atomicWriteJson(path.join(jobDir(parentId), "visual-resources.json"), {...polygonResources, revision: 2});
    const polygonPath = "/__resource_0/polygons/0/text";
    const phrase = pasted.text.slice(pasted.text.indexOf("Then")).trim();
    replies = [{aligned: true, starts: [4]}, {...visualStrings, [polygonPath]: "Unrelated English"}, {[polygonPath]: phrase}];
    await updateJobState(polygonId, {state: "segmenting_translation"});
    await runTranslation(polygonId, "confirm");
    const translatedResources = await readJson<typeof polygonResources>(path.join(jobDir(polygonId), "visual-resources.json"));
    assert.equal(translatedResources.resources[0]!.polygons[0]!.text, phrase);
    assert.deepEqual(translatedResources.resources[0]!.polygons[0]!.points, polygonResources.resources[0]!.polygons[0]!.points);
    assert.equal(translatedResources.resources[0]!.imagePath, polygonResources.resources[0]!.imagePath);
    assert.deepEqual(await readJson(path.join(jobDir(parentId), "visual-resources.json")), {...polygonResources, revision: 2});

    const protectedContent = {title: "标题", code: "const text = '中文';", imageSrc: "artifact://uploaded-images/中文.png", nodes: [{id: "中文标识", data: {label: "订单"}}], edges: [{source: "中文标识", target: "另一个标识"}], value: 2};
    const protectedSlots = visualTranslationSlots(protectedContent);
    assert.deepEqual(Object.values(protectedSlots), ["标题", "订单"]);
    const protectedTranslation = applyVisualTranslations(protectedContent, protectedSlots, {"/title": "Title", "/nodes/0/data/label": "Orders"});
    assert.equal(protectedTranslation.code, protectedContent.code);
    assert.equal(protectedTranslation.imageSrc, protectedContent.imageSrc);
    assert.equal(protectedTranslation.value, 2);
    assert.deepEqual(protectedTranslation.edges, protectedContent.edges);
    // 封面是独立于镜头的 visual-plan 文案，必须进入同一轮翻译。
    const coverContent = {content: {title: "智能体和工作流有什么区别？", subtitle: "核心区别：自主性", keywords: ["智能体", "自主性"], presenterPoseId: "neutral"}};
    const coverSlots = visualTranslationSlots({__cover__: coverContent});
    assert.deepEqual(Object.values(coverSlots), ["智能体和工作流有什么区别？", "核心区别：自主性", "智能体", "自主性"]);
    assert.deepEqual(applyVisualTranslations({__cover__: coverContent}, coverSlots, {
      "/__cover__/content/title": "How agents differ from workflows",
      "/__cover__/content/subtitle": "The core difference: autonomy",
      "/__cover__/content/keywords/0": "Agents",
      "/__cover__/content/keywords/1": "Autonomy",
    }).__cover__, {content: {title: "How agents differ from workflows", subtitle: "The core difference: autonomy", keywords: ["Agents", "Autonomy"], presenterPoseId: "neutral"}});
    assert.equal(translationTokens("We don't change GPT-4.").length, 4);
    assert.deepEqual(splitApprovedTranslation("One paragraph. ", [], 1), ["One paragraph. "]);
    for (const starts of [[0], [99], [1.5], [1, 1]]) assert.throws(() => splitApprovedTranslation("Keep these words intact.", starts, starts.length + 1), /原镜头/);
    console.log("translation review tests passed");
  } finally {
    globalThis.fetch = originalFetch;
    process.env = oldEnv;
    await fs.rm(root, {recursive: true, force: true});
  }
};

main().catch((error) => { console.error(error); process.exitCode = 1; });
