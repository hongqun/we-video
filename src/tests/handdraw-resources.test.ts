/* eslint-disable @remotion/non-pure-animation -- 时间只用于任务元数据与输入夹具。 */
import assert from "node:assert/strict";
import {promises as fs} from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {HANDDRAW_VERSION, type HanddrawData} from "../remotion/templates/handdraw-schema";

// 使用独立任务目录验证替图、过期 worker 和并发资源写入；不启动服务或渲染视频。
const root = await fs.mkdtemp(path.join(os.tmpdir(), "we-video-handdraw-"));
process.env.TALK_VIDEO_DATA_DIR = root;
try {
  const jobs = await import("../lib/jobs");
  const resources = await import("../lib/visual-resources");
  const handdraw = await import("../lib/handdraw");
  const jobId = "2026-11-04 00:00:00.000";
  await jobs.initializeNarrationJob(jobId, {accountId: "tech123", seriesId: "tech-minute", accountVersion: "1", seriesVersion: "1"});
  const dir = jobs.jobDir(jobId);
  const scene = {id: "plan-01", segmentId: "n1", startMs: 0, endMs: 10000, transition: {kind: "none", durationMs: 0}, content: {title: "手绘测试", subtitle: "", text: "主体", keywords: []}, templateId: "rve/handdraw-image", presenter: {rollType: "b-roll", mode: "hidden", poseId: "neutral", placement: "right-lower"}};
  await jobs.atomicWriteJson(path.join(dir, "draft.json"), {title: "测试", narrationSegments: [{id: "n1", spokenText: "测试口播"}, {id: "n2", spokenText: "另一个镜头"}]});
  await jobs.atomicWriteJson(path.join(dir, "visual-plan.json"), {schemaVersion: "1.0", revision: 1, planVersion: 1, createdAt: new Date().toISOString(), cover: {title: "测试", subtitle: "", keywords: [], presenterPoseId: "neutral"}, scenes: [scene]});
  await jobs.updateJobState(jobId, {state: "completed", error: null});
  await fs.writeFile(path.join(dir, "output.mp4"), "old output");
  await jobs.atomicWriteJson(path.join(dir, "manifest.json"), {});
  const bytes = await sharp({create: {width: 64, height: 64, channels: 3, background: "white"}}).png().toBuffer();
  const file = new File([new Uint8Array(bytes)], "line.png", {type: "image/png"});
  let snapshot = await handdraw.changeHanddrawImage(jobId, scene.id, "lineart", file);
  const original = snapshot.resources[0]!.handdraw!;
  assert.equal(original.status, "waiting");
  assert.equal((await jobs.readJob(jobId)).state, "awaiting_visual_review");
  await assert.rejects(() => fs.access(path.join(dir, "output.mp4")));
  await assert.rejects(() => fs.access(path.join(dir, "manifest.json")));
  const small = await sharp({create: {width: 32, height: 32, channels: 3, background: "white"}}).png().toBuffer();
  await assert.rejects(() => handdraw.changeHanddrawImage(jobId, scene.id, "color", new File([new Uint8Array(small)], "small.png", {type: "image/png"})), /尺寸不一致/);
  assert.equal((await resources.readVisualResources(jobId)).resources[0]!.handdraw!.lineart!.sha256, original.lineart!.sha256);
  const processing = {...original, color: original.lineart, status: "processing" as const, requestId: "new-request", startedAt: new Date().toISOString()};
  await resources.saveVisualResource(jobId, "n1", {handdraw: processing}, scene.id);
  const cacheKey = handdraw.handdrawCacheKey(processing)!;
  const data: HanddrawData = {algorithmVersion: HANDDRAW_VERSION, cacheKey, width: 64, height: 64, minimumDrawMs: 500, completePath: "complete.png", lineLayerPath: "line.png", colorLayerPath: "color.png", lineTimePath: "line-time.png", colorTimePath: "color-time.png", motionPath: "motion.json", hashes: {}};
  const revision = (await resources.readVisualResources(jobId)).revision;
  await handdraw.publishHanddrawResult(jobId, scene.id, "old-request", data);
  assert.equal((await resources.readVisualResources(jobId)).revision, revision);
  await Promise.all([
    handdraw.publishHanddrawResult(jobId, scene.id, "new-request", data),
    resources.saveVisualResource(jobId, "n2", {polygons: []}, "plan-02"),
  ]);
  snapshot = await resources.readVisualResources(jobId);
  assert.equal(snapshot.resources.find((item) => item.sceneId === scene.id)!.handdraw!.status, "ready");
  assert.ok(snapshot.resources.some((item) => item.sceneId === "plan-02"));
  const split = {...scene, id: `${scene.id}-split`};
  await resources.copySplitModelResources(jobId, [split], snapshot);
  await handdraw.changeHanddrawImage(jobId, scene.id, "lineart");
  await handdraw.publishHanddrawResult(jobId, scene.id, "new-request", data);
  snapshot = await resources.readVisualResources(jobId);
  assert.equal(snapshot.resources.find((item) => item.sceneId === scene.id)!.handdraw!.status, "waiting");
  assert.equal(snapshot.resources.find((item) => item.sceneId === split.id)!.handdraw!.data!.cacheKey, cacheKey);
  // 丢失解释器必须记录为可重试错误，不能让镜头永久停在 processing。
  await resources.saveVisualResource(jobId, "n1", {handdraw: processing}, scene.id);
  const python = process.env.HANDDRAW_PYTHON;
  try {
    process.env.HANDDRAW_PYTHON = path.join(root, "missing-python");
    await handdraw.prepareHanddraw(jobId, scene.id, "new-request");
  } finally {if (python === undefined) delete process.env.HANDDRAW_PYTHON; else process.env.HANDDRAW_PYTHON = python;}
  const failed = (await resources.readVisualResources(jobId)).resources.find((item) => item.sceneId === scene.id)!.handdraw!;
  assert.equal(failed.status, "failed"); assert.match(failed.error!, /Python 环境缺失/);
  await jobs.updateJobState(jobId, {state: "rendering", error: null});
  await assert.rejects(() => handdraw.changeHanddrawImage(jobId, scene.id, "lineart", file), /当前任务状态不允许/);
  console.info("handdraw-resources.test 通过：上传校验、成片失效、并发写入、拆分、过期结果及缺失环境");
} finally {await fs.rm(root, {recursive: true, force: true});}
