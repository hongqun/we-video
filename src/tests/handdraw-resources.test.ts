/* eslint-disable @remotion/non-pure-animation -- 时间只用于任务元数据与输入夹具。 */
import assert from "node:assert/strict";
import {promises as fs} from "node:fs";
import {createHash} from "node:crypto";
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
  const data: HanddrawData = {algorithmVersion: HANDDRAW_VERSION, sketchLayerPath: "sketch.png", sketchTimePath: "sketch-time.png", eraseTimePath: "erase-time.png", stageTimings: {sketchEndMs: 100, lineEndMs: 200, eraseEndMs: 300, colorEndMs: 450}, cacheKey, width: 64, height: 64, minimumDrawMs: 500, completePath: "complete.png", lineLayerPath: "line.png", colorLayerPath: "color.png", lineTimePath: "line-time.png", colorTimePath: "color-time.png", motionPath: "motion.json", hashes: {}};
  // 完整新版缓存按内容寻址，任何新增起形文件缺失或损坏都必须失败。
  const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
  assert.notEqual(cacheKey, hash(`handdraw-5:${processing.lineart!.sha256}:${processing.color!.sha256}`));
  const cacheDir = path.join(dir, "handdraw/cache", cacheKey);
  await fs.mkdir(cacheDir, {recursive: true});
  const filenames = {completePath: "complete.png", lineLayerPath: "line.png", colorLayerPath: "color.png", lineTimePath: "line-time.png", colorTimePath: "color-time.png", motionPath: "motion.json", sketchLayerPath: "sketch.png", sketchTimePath: "sketch-time.png", eraseTimePath: "erase-time.png"} as const;
  const cachedData = {...data, hashes: {} as Record<string, string>};
  for (const [field, filename] of Object.entries(filenames)) {
    const content = field === "motionPath" ? Buffer.from(JSON.stringify({algorithmVersion: HANDDRAW_VERSION, cacheKey, width: 64, height: 64, minimumDrawMs: 500, stageTimings: data.stageTimings, points: [[0, 0, 0, 0], [10, 1, 1, 3], [100, 1, 1, 1], [200, 1, 1, 4], [300, 1, 1, 2], [450, 1, 1, 0]]})) : bytes;
    await fs.writeFile(path.join(cacheDir, filename), content);
    Object.assign(cachedData, {[field]: `handdraw/cache/${cacheKey}/${filename}`});
    cachedData.hashes[field] = hash(content);
  }
  assert.equal((await handdraw.verifyHanddrawArtifacts(jobId, cachedData)).algorithmVersion, HANDDRAW_VERSION);
  for (const field of ["sketchLayerPath", "sketchTimePath", "eraseTimePath"] as const) {
    await assert.rejects(() => handdraw.verifyHanddrawArtifacts(jobId, {...cachedData, [field]: undefined}));
    await fs.rm(path.join(cacheDir, filenames[field]));
    await assert.rejects(() => handdraw.verifyHanddrawArtifacts(jobId, cachedData), /ENOENT/);
    await fs.writeFile(path.join(cacheDir, filenames[field]), "damaged");
    await assert.rejects(() => handdraw.verifyHanddrawArtifacts(jobId, cachedData), /产物已变化/);
    await fs.writeFile(path.join(cacheDir, filenames[field]), bytes);
  }
  const verifiedMotion = JSON.parse(await fs.readFile(path.join(cacheDir, "motion.json"), "utf8"));
  const invalidMotion = JSON.stringify({...verifiedMotion, stageTimings: {...data.stageTimings, lineEndMs: 190}});
  await fs.writeFile(path.join(cacheDir, "motion.json"), invalidMotion);
  await assert.rejects(() => handdraw.verifyHanddrawArtifacts(jobId, {...cachedData, hashes: {...cachedData.hashes, motionPath: hash(invalidMotion)}}), /运动计划与图层不一致/);
  await fs.writeFile(path.join(cacheDir, "motion.json"), JSON.stringify(verifiedMotion));
  await jobs.atomicWriteJson(path.join(cacheDir, "data.json"), cachedData);
  const legacyKey = hash(`handdraw-5:${processing.lineart!.sha256}:${processing.color!.sha256}`);
  const legacyDir = path.join(dir, "handdraw/cache", legacyKey);
  await fs.mkdir(legacyDir, {recursive: true});
  const legacyData: HanddrawData = {...cachedData, algorithmVersion: "handdraw-5", cacheKey: legacyKey, stageTimings: undefined, sketchLayerPath: undefined, sketchTimePath: undefined, eraseTimePath: undefined, hashes: {}};
  for (const field of ["completePath", "lineLayerPath", "colorLayerPath", "lineTimePath", "colorTimePath", "motionPath"] as const) {
    const content = field === "motionPath" ? Buffer.from(JSON.stringify({algorithmVersion: "handdraw-5", cacheKey: legacyKey, width: 64, height: 64, minimumDrawMs: 500, points: [[0, 0, 0, 0], [10, 1, 1, 1], [300, 1, 1, 2], [450, 1, 1, 0]]})) : bytes;
    await fs.writeFile(path.join(legacyDir, filenames[field]), content);
    legacyData[field] = `handdraw/cache/${legacyKey}/${filenames[field]}`;
    legacyData.hashes[field] = hash(content);
  }
  await handdraw.verifyHanddrawArtifacts(jobId, legacyData);
  await resources.saveVisualResource(jobId, "n1", {handdraw: {...processing, data: legacyData}}, scene.id);
  // 重新处理历史资源会按新版键命中已验证产物，不改写历史缓存。
  await handdraw.prepareHanddraw(jobId, scene.id, "new-request");
  assert.equal((await resources.readVisualResources(jobId)).resources[0]!.handdraw!.data!.algorithmVersion, HANDDRAW_VERSION);
  assert.equal((await handdraw.verifyHanddrawArtifacts(jobId, legacyData)).algorithmVersion, "handdraw-5");
  await resources.saveVisualResource(jobId, "n1", {handdraw: processing}, scene.id);
  await fs.rm(cacheDir, {recursive: true});
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
