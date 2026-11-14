import assert from "node:assert/strict";
import {after, test} from "node:test";
import {promises as fs} from "node:fs";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import {BailianDrawingClient, ExplainerMediaError, ExplainerReviewError, parseExplainerReview} from "../lib/handdraw-explainer/bailian";
import {assertExplainerFrames, explainerDataSchema, explainerDesignSchema, explainerPenAt, explainerSchedule, explainerSourceTimeAt, EXPLAINER_MAX_SPEED, type ExplainerData} from "../remotion/templates/handdraw-explainer-schema";
import {paintHanddrawPixels, type HanddrawPixels} from "../remotion/templates/handdraw-pixels";
import {HANDDRAW_VERSION, handdrawResourceSchema} from "../remotion/templates/handdraw-schema";

// 所有文件写入独立临时数据根，不接触真实任务，也不请求模型或启动渲染。
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "we-video-explainer-test-"));
const previousRoot = process.env.TALK_VIDEO_DATA_DIR;
process.env.TALK_VIDEO_DATA_DIR = temporary;
const store = await import("../lib/handdraw-explainer/store");
const compiler = await import("../lib/handdraw-explainer/compiler");
const {createExplainerArtwork, listExplainerAttempts} = await import("../lib/handdraw-explainer/artwork");
const {explainerFingerprint} = await import("../lib/handdraw-explainer/context");
after(async () => {if (previousRoot === undefined) delete process.env.TALK_VIDEO_DATA_DIR; else process.env.TALK_VIDEO_DATA_DIR = previousRoot; await fs.rm(temporary, {recursive: true, force: true});});
const jobId = "2026-11-12 00:00:00.001";
const scene = {startMs: 1033, endMs: 13033};
const captions = [
  {text: "先画太阳", startMs: 1100, endMs: 3100, timestampMs: 2100, confidence: null},
  {text: "再画太", startMs: 6100, endMs: 7600, timestampMs: 6800, confidence: null},
  {text: "阳照耀", startMs: 7600, endMs: 9100, timestampMs: 8300, confidence: null},
];
const design = (occurrence = 1) => explainerDesignSchema.parse({schemaVersion: "1.0", illustrations: [{id: "main", artworkId: "sun", box: [.1, .1, .7, .6], parts: [{id: "sun", name: "太阳", box: [0, 0, 1, 1], cueText: "太阳", occurrence}]}], labels: []});

test("跨字幕的重复短语定位具体出现次数，并保留绝对帧取整", () => {
  assert.deepEqual(explainerSchedule(scene, captions, design(1), {"main-sun": 1000})["main-sun"], {startFrame: 32, endFrame: 62});
  assert.deepEqual(explainerSchedule(scene, captions, design(2), {"main-sun": 1000})["main-sun"], {startFrame: 182, endFrame: 212});
  assert.throws(() => explainerSchedule(scene, captions, design(3), {"main-sun": 1000}), /未匹配/u);
});
test("同刻动作串行落笔，超预算不得压缩到无阅读时间", () => {
  const value = design();
  value.labels.push({id: "label", text: "太阳", box: [.1, .8, .5, .1], fontSize: 30, color: "#222222", cueText: "太阳", occurrence: 1});
  const scheduled = explainerSchedule(scene, captions, value, {"main-sun": 1000, label: 800});
  assert.equal(scheduled.label!.startFrame, scheduled["main-sun"]!.endFrame);
  assert.throws(() => explainerSchedule(scene, captions, value, {"main-sun": 60000, label: 800}), /口播窗口/u);
});
test("音频字节、字幕时间和布局改变均改变指纹", () => {
  const base = {captions, layout: [.1, .1, .7, .6]};
  const hash = explainerFingerprint(base, Buffer.from("audio-1"));
  assert.notEqual(hash, explainerFingerprint(base, Buffer.from("audio-2")));
  assert.notEqual(hash, explainerFingerprint({...base, captions: captions.map((item) => ({...item, startMs: item.startMs + 10}))}, Buffer.from("audio-1")));
  assert.notEqual(hash, explainerFingerprint({...base, layout: [.2, .1, .6, .6]}, Buffer.from("audio-1")));
});
test("任意帧重建与笔尖查询不依赖访问顺序", () => {
  const pixels: HanddrawPixels = {line: new Uint8ClampedArray([0, 0, 0, 255]), color: new Uint8ClampedArray([240, 150, 60, 255]), lineTimes: new Uint32Array([200]), colorTimes: new Uint32Array([600]), transparent: true, smooth: true};
  const at = (time: number) => [...paintHanddrawPixels(pixels, time)];
  const result = at(250); at(800); at(-1);
  assert.deepEqual(at(250), result);
  const motion = {durationMs: 1000, points: [[0, 0, 0, 1], [1000, 10, 20, 1]] as Array<[number, number, number, 1]>};
  const pen = explainerPenAt(motion, 500); explainerPenAt(motion, 900); explainerPenAt(motion, 20);
  assert.deepEqual(explainerPenAt(motion, 500), pen);
  assert.equal(explainerPenAt(motion, -1), null);
  assert.equal(explainerPenAt(motion, 1000), null);
});
test("请求锁序列化并发写入，取消及后续请求拒绝旧 worker", async () => {
  const sceneId = "lock-test";
  await store.writeExplainerSession(jobId, sceneId, {status: "running", requestId: "old", progress: "测试", messages: []});
  await Promise.all(Array.from({length: 8}, (_, i) => store.withExplainerLock(jobId, sceneId, async () => {
    const session = await store.assertExplainerRequest(jobId, sceneId, "old");
    await new Promise((resolve) => setTimeout(resolve, 2));
    await store.writeExplainerSession(jobId, sceneId, {...session, messages: [...session.messages, {id: String(i), role: "tool", text: String(i)}]});
  })));
  assert.equal((await store.readExplainerSession(jobId, sceneId)).messages.length, 8);
  await store.writeExplainerSession(jobId, sceneId, {status: "cancelled", requestId: "old", progress: "已取消", messages: []});
  await assert.rejects(store.assertExplainerRequest(jobId, sceneId, "old"), /取消或过期/u);
  await store.writeExplainerSession(jobId, sceneId, {status: "running", requestId: "new", progress: "新请求", messages: []});
  await assert.rejects(store.assertExplainerRequest(jobId, sceneId, "old"), /取消或过期/u);
});
test("百炼连接、鉴权、限流和无图响应不泄漏凭据", async () => {
  for (const status of [401, 429, 500]) {
    const client = new BailianDrawingClient({baseURL: "https://example.invalid/api/v1", apiKey: "private-test-key"}, async () => new Response(JSON.stringify({secret: "private-test-key"}), {status}));
    await assert.rejects(client.generate("image-model", "线稿", new AbortController().signal), (error: unknown) => error instanceof ExplainerMediaError && !error.message.includes("private-test-key"));
  }
  const client = new BailianDrawingClient({baseURL: "https://example.invalid/api/v1", apiKey: "private-test-key"}, async () => new Response(JSON.stringify({output: {choices: [{message: {content: [{text: "no image"}]}}]}})));
  await assert.rejects(client.generate("image-model", "线稿", new AbortController().signal), /未返回图片/u);
});
test("百炼上色明确使用线稿输入，复核拒绝格式错误的报告", async () => {
  const image = await sharp({create: {width: 2, height: 2, channels: 4, background: "#fff"}}).png().toBuffer();
  let body: {input?: {messages?: Array<{content: Array<{image?: string}>}>}} = {};
  const client = new BailianDrawingClient({baseURL: "https://example.invalid/api/v1", apiKey: "private-test-key"}, async (_request, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({output: {choices: [{message: {content: [{image: `data:image/png;base64,${image.toString("base64")}`}]}}]}}));
  });
  await client.generate("image-model", "只上色", new AbortController().signal, image);
  assert.equal(body.input?.messages?.[0]?.content[0]?.image, `data:image/png;base64,${image.toString("base64")}`);
  const broken = new BailianDrawingClient({baseURL: "https://example.invalid/api/v1", apiKey: "private-test-key"}, async () => new Response(JSON.stringify({output: {choices: [{message: {content: [{text: "not json"}]}}]}})));
  await assert.rejects(broken.review("vision-model", "检查", [image], new AbortController().signal), /复核报告/u);
});
test("线稿视觉复核失败时保留线稿，并停止后续上色调用", async () => {
  const image = await sharp({create: {width: 2, height: 2, channels: 4, background: "#fff"}}).png().toBuffer();
  let calls = 0;
  const client = new BailianDrawingClient({baseURL: "https://example.invalid/api/v1", apiKey: "private-test-key"}, async () => {
    calls++;
    const content = calls === 1 ? [{image: `data:image/png;base64,${image.toString("base64")}`}] : [{text: JSON.stringify({coordinateSystem: "xyxy-1000", pass: false, evidence: "缺少必要动作", issues: ["动作未画清楚"], parts: [{id: "sun", name: "太阳", bbox: [0, 0, 1000, 1000]}]})}];
    return new Response(JSON.stringify({output: {choices: [{message: {content}}]}}));
  });
  const context = {sceneId: "failed-line", fingerprint: "b".repeat(64), durationInFrames: 360, scene: {spokenText: "太阳升起", content: {title: "太阳"}}, style: {}} as unknown as Parameters<typeof createExplainerArtwork>[1];
  await assert.rejects(createExplainerArtwork(jobId, context, "request", {id: "sun", brief: "画出一轮太阳作为唯一的主要对象", linePrompt: "Draw one simple sun with clean black outlines on white paper.", colorPrompt: "Only fill the existing sun with flat yellow."}, {imageModel: "image", visionModel: "vision"}, client, new AbortController().signal, async () => undefined, async () => ({strokeCount: 4, minimumLineMs: 1000})), /尚未调用上色/u);
  assert.equal(calls, 2);
  const root = path.join(temporary, "jobs", jobId, "handdraw-explainers/failed-line/artwork");
  const entries = await fs.readdir(root);
  await fs.access(path.join(root, entries[0]!, "line.png"));
  await assert.rejects(fs.access(path.join(root, entries[0]!, "color.png")));
});
test("上色失败后复用已审核线稿，不重复调用文生图", async () => {
  const image = await sharp({create: {width: 2, height: 2, channels: 4, background: "#fff"}}).png().toBuffer();
  const review = {coordinateSystem: "xyxy-1000", pass: true, evidence: "主体清楚且轮廓连续", issues: [], parts: [{id: "sun", name: "太阳", bbox: [0, 0, 1000, 1000]}]};
  const imageResult = () => new Response(JSON.stringify({output: {choices: [{message: {content: [{image: `data:image/png;base64,${image.toString("base64")}`}]}}]}}));
  let initialCalls = 0;
  const first = new BailianDrawingClient({baseURL: "https://example.invalid/api/v1", apiKey: "private-test-key"}, async () => {
    initialCalls++;
    if (initialCalls === 1) return imageResult();
    if (initialCalls === 2) return new Response(JSON.stringify({output: {choices: [{message: {content: [{text: JSON.stringify(review)}]}}]}}));
    return new Response("{}", {status: 500});
  });
  const context = {sceneId: "reuse-line", fingerprint: "c".repeat(64), durationInFrames: 360, scene: {spokenText: "太阳升起", content: {title: "太阳"}}, style: {}} as unknown as Parameters<typeof createExplainerArtwork>[1];
  const input = {id: "sun", brief: "画出一轮太阳作为唯一的主要对象", linePrompt: "Draw one simple sun with clean black outlines on white paper.", colorPrompt: "Only fill the existing sun with flat yellow."};
  const settings = {imageModel: "image", visionModel: "vision"};
  const measure = async () => ({strokeCount: 4, minimumLineMs: 1000});
  await assert.rejects(createExplainerArtwork(jobId, context, "request", input, settings, first, new AbortController().signal, async () => undefined, measure), /HTTP 500/u);
  assert.equal(initialCalls, 3);
  const attempts = await listExplainerAttempts(jobId, context);
  assert.equal(attempts[0]?.canReuseLine, true);
  let retryCalls = 0;
  const retry = new BailianDrawingClient({baseURL: "https://example.invalid/api/v1", apiKey: "private-test-key"}, async (_request, init) => {
    retryCalls++;
    if (retryCalls === 1) {assert.ok(JSON.parse(String(init?.body)).input.messages[0].content[0].image); return imageResult();}
    return new Response(JSON.stringify({output: {choices: [{message: {content: [{text: JSON.stringify({...review, pass: false, issues: ["颜色需调整"]})}]}}]}}));
  });
  await assert.rejects(createExplainerArtwork(jobId, context, "request", {...input, reuseLineFrom: attempts[0]!.version}, settings, retry, new AbortController().signal, async () => undefined, measure), /上色复核未通过/u);
  assert.equal(retryCalls, 2);
});
test("产物被替换或镜头时长变化后不能通过校验", async () => {
  const relative = "handdraw-explainers/artifact-test/compiled/" + "a".repeat(64);
  const directory = path.join(temporary, "jobs", jobId, relative); await fs.mkdir(directory, {recursive: true});
  const png = await sharp({create: {width: 2, height: 2, channels: 4, background: "#00000000"}}).png().toBuffer();
  const hashes: Record<string, string> = {};
  const files: Record<string, string> = {};
  for (const key of ["linePath", "colorPath", "lineTimePath", "colorTimePath", "motionPath"]) {
    const filename = key === "motionPath" ? "motion.json" : `${key}.png`;
    const bytes = key === "motionPath" ? Buffer.from(JSON.stringify({durationMs: 300, points: [[0, 0, 0, 1], [300, 1, 1, 1]]})) : png;
    await fs.writeFile(path.join(directory, filename), bytes); hashes[key] = compiler.explainerDigest(bytes); files[key] = `${relative}/${filename}`;
  }
  const complete = await sharp({create: {width: 960, height: 800, channels: 4, background: "#00000000"}}).png().toBuffer();
  await fs.writeFile(path.join(directory, "complete.png"), complete);
  const data = explainerDataSchema.parse({schemaVersion: "1.0", compilerVersion: "explainer-1", sceneId: "artifact-test", sceneStartMs: 0, sceneEndMs: 3000, contextFingerprint: "b".repeat(64), cacheKey: "a".repeat(64), width: 960, height: 800, fps: 30, durationInFrames: 90, completePath: `${relative}/complete.png`, completeHash: compiler.explainerDigest(complete), layers: [{id: "test", kind: "illustration", box: [.1, .1, .5, .5], width: 2, height: 2, startFrame: 0, endFrame: 30, durationMs: 300, ...files, hashes}]});
  // 播放契约接受五倍以内的帧压缩，导出前同样拒绝越过速度上限。
  const accelerated = {...data, layers: data.layers.map((layer) => ({...layer, durationMs: 5000, startFrame: 0, endFrame: 30}))};
  assert.equal(explainerDataSchema.safeParse(accelerated).success, true);
  assert.equal(explainerDataSchema.safeParse({...accelerated, layers: accelerated.layers.map((layer) => ({...layer, endFrame: 29}))}).success, false);
  await compiler.verifyExplainerArtifacts(jobId, data);
  assert.throws(() => assertExplainerFrames({startMs: 0, endMs: 4000}, data), /范围已变化/u);
  assert.throws(() => assertExplainerFrames({startMs: 1000, endMs: 4000}, data), /范围已变化/u);
  await fs.writeFile(path.join(directory, "linePath.png"), "replaced");
  await assert.rejects(compiler.verifyExplainerArtifacts(jobId, data), /变更或损坏/u);
  assert.equal(explainerDataSchema.safeParse({...data, layers: [{...data.layers[0], endFrame: 89}]}).success, false);
  assert.equal((data as ExplainerData).compilerVersion, "explainer-1");
});
test("旧手绘插画版本和上传契约保持独立", () => {
  assert.equal(HANDDRAW_VERSION, "handdraw-6");
  assert.deepEqual(handdrawResourceSchema.parse({status: "waiting"}), {status: "waiting"});
});

// 格式失败与网络失败分别诊断；重试复核不得触发生图。
test("视觉复核连接失败后有限重试，字段错误保留路径", async () => {
  let calls = 0;
  const report = {coordinateSystem: "xyxy-1000", pass: true, evidence: "轮廓与构图一致", issues: [], parts: [{id: "sun", name: "太阳", bbox: [0, 0, 1000, 1000]}]};
  const client = new BailianDrawingClient({baseURL: "https://example.invalid/api/v1", apiKey: "private-test-key"}, async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).model, "vision-model");
    if (++calls === 1) throw new TypeError("private-test-key");
    return new Response(JSON.stringify({output: {choices: [{message: {content: [{text: JSON.stringify(report)}]}}]}}));
  });
  assert.equal((await client.review("vision-model", "检查", [Buffer.from("image")], new AbortController().signal)).pass, true);
  assert.equal(calls, 2);
  const broken = new BailianDrawingClient({baseURL: "https://example.invalid/api/v1", apiKey: "private-test-key"}, async () => new Response(JSON.stringify({output: {choices: [{message: {content: [{text: JSON.stringify({...report, parts: [{id: "sun", name: "太阳", bbox: [0, 0, 2000, 1000]}]})}]}}]}})));
  await assert.rejects(broken.review("vision-model", "检查", [], new AbortController().signal), (error: unknown) => error instanceof ExplainerMediaError && error.message.includes("parts.0.bbox") && !error.message.includes("private-test-key"));
});

// 大区域角点不会再被误当作宽高；未知格式和真实越界必须拒绝。
test("视觉角点坐标显式转换，拒绝模糊格式与越界", () => {
  const report = {coordinateSystem: "xyxy-1000", pass: true, evidence: "构图完整", issues: [], parts: [{id: "map", name: "地图", bbox: [220, 240, 800, 850]}]};
  assert.deepEqual(parseExplainerReview(JSON.stringify(report)).parts[0]!.box, [.22, .24, .58, .61]);
  for (const bbox of [[800, 200, 700, 500], [0, 0, 1100, 900], [0, 0, 0, 0]]) {
    assert.throws(() => parseExplainerReview(JSON.stringify({...report, parts: [{id: "map", name: "地图", bbox}]})), ExplainerReviewError);
  }
  assert.throws(() => parseExplainerReview(JSON.stringify({...report, coordinateSystem: undefined})), ExplainerReviewError);
});
test("视觉格式修正反馈同一图片，最多两次调用", async () => {
  const report = {coordinateSystem: "xyxy-1000", pass: true, evidence: "构图完整", issues: [], parts: [{id: "map", name: "地图", bbox: [200, 100, 900, 800]}]};
  let calls = 0;
  const client = new BailianDrawingClient({baseURL: "https://example.invalid/api/v1", apiKey: "private-test-key"}, async (_url, init) => {
    const input = JSON.parse(String(init?.body));
    assert.equal(input.model, "vision-model");
    assert.equal(input.input.messages[0].content[0].image, "data:image/png;base64,aW1hZ2U=");
    if (++calls === 2) assert.match(input.input.messages[0].content[1].text, /上次报告解析失败/u);
    const value = calls === 1 ? {...report, parts: [{id: "map", name: "地图", bbox: [800, 200, 700, 500]}]} : report;
    return new Response(JSON.stringify({output: {choices: [{message: {content: [{text: JSON.stringify(value)}]}}]}}));
  });
  assert.deepEqual((await client.review("vision-model", "检查", [Buffer.from("image")], new AbortController().signal)).parts[0]!.box, [.2, .1, .7, .7]);
  assert.equal(calls, 2);
  let failures = 0;
  const broken = new BailianDrawingClient({baseURL: "https://example.invalid/api/v1", apiKey: "private-test-key"}, async () => {
    failures++;
    return new Response(JSON.stringify({output: {choices: [{message: {content: [{text: "bad json"}]}}]}}));
  });
  await assert.rejects(broken.review("vision-model", "检查", [], new AbortController().signal), ExplainerReviewError);
  assert.equal(failures, 2);
});
test("致命复核错误后程序阻断后续工具和模型入口", async () => {
  const {ExplainerExecutionGuard} = await import("../lib/handdraw-explainer/execution");
  const guard = new ExplainerExecutionGuard();
  guard.assertRunning();
  assert.throws(() => guard.stop("坐标协议修正仍失败"), /坐标协议/u);
  // 模拟框架吞掉工具异常后，模型与排队工具仍须通过相同入口守卫。
  for (let i = 0; i < 3; i++) assert.throws(() => guard.assertRunning(), /坐标协议/u);
});

// 54 秒的自然路径可压入 16.4 秒窗口，仍保留三成与至少一秒阅读。
test("绘制按预算适度加速，整数帧不突破上限", () => {
  const clip = {startMs: 0, endMs: 16400};
  const cues = [{text: "太阳", startMs: 0, endMs: 1000, timestampMs: 500, confidence: null}];
  const result = explainerSchedule(clip, cues, design(), {"main-sun": 54000})["main-sun"]!;
  const frames = result.endFrame - result.startFrame;
  assert.equal(result.startFrame, 0);
  assert.ok(frames <= Math.floor(16400 * .03 * .7));
  assert.ok(54000 * .03 / frames <= EXPLAINER_MAX_SPEED);
  assert.ok(16400 * .03 - result.endFrame >= 30);
  assert.throws(() => explainerSchedule(clip, cues, design(), {"main-sun": 60000}), /五倍|5 倍/u);
  const value = design();
  value.labels.push({id: "label", text: "太阳", box: [.1, .8, .5, .1], fontSize: 30, color: "#222222", cueText: "太阳", occurrence: 1});
  const together = explainerSchedule(clip, cues, value, {"main-sun": 50000, label: 4000});
  assert.equal(together.label!.startFrame, together["main-sun"]!.endFrame);
  for (const [id, duration] of Object.entries({"main-sun": 50000, label: 4000})) assert.ok(duration * .03 / (together[id]!.endFrame - together[id]!.startFrame) <= EXPLAINER_MAX_SPEED);
  assert.throws(() => explainerSchedule({startMs: 0, endMs: 900}, cues, design(), {"main-sun": 100}), /口播窗口/u);
});
test("加速后时间图和笔尖使用同一源时间，跳帧与倒放一致", () => {
  const layer = {startFrame: 10, endFrame: 40, durationMs: 5000};
  assert.equal(explainerSourceTimeAt(layer, 9), -1);
  assert.equal(explainerSourceTimeAt(layer, 25), 2500);
  assert.ok(explainerSourceTimeAt(layer, 40) > 5000);
  const motion = {durationMs: 5000, points: [[0, 0, 0, 1], [5000, 10, 20, 1]] as Array<[number, number, number, 1]>};
  const pen = () => explainerPenAt(motion, explainerSourceTimeAt(layer, 25));
  const first = pen();
  explainerPenAt(motion, explainerSourceTimeAt(layer, 39));
  explainerPenAt(motion, explainerSourceTimeAt(layer, 11));
  assert.deepEqual(pen(), first);
  assert.equal(first!.x, 5);
});

// 文字默认快速落笔，不能因口播窗口宽裕而被拉回插画的慢速。
test("文字优先四倍书写，与插画独立分配帧数", () => {
  const value = design();
  value.labels.push({id: "quick-label", text: "太阳", box: [.1, .8, .5, .1], fontSize: 30, color: "#222222", cueText: "太阳", occurrence: 1});
  const frames = explainerSchedule(scene, captions, value, {"main-sun": 1000, "quick-label": 4000});
  assert.equal(frames["main-sun"]!.endFrame - frames["main-sun"]!.startFrame, 30);
  assert.equal(frames["quick-label"]!.endFrame - frames["quick-label"]!.startFrame, 30);
  assert.equal(frames["quick-label"]!.startFrame, frames["main-sun"]!.endFrame);
});
