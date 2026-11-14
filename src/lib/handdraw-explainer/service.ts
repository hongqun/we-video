import {promises as fs, openSync, closeSync} from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {updateJobState} from "../jobs";
import {assertVisualPlanEditableState, readVisualPlan, saveVisualPlan, type VisualPlan} from "../visual-plan";
import {mutateVisualResources} from "../visual-resources";
import {assertExplainerFrames, explainerDataSchema, type ExplainerDesign} from "../../remotion/templates/handdraw-explainer-schema";
import {loadExplainerContext} from "./context";
import {explainerSettings} from "./settings";
import {assertExplainerEnvironment, explainerDependencyIdentity, verifyExplainerArtifacts} from "./compiler";
import {assertExplainerRequest, explainerDirectory, readExplainerCandidate, readExplainerSession, withExplainerLock, writeExplainerCandidate, writeExplainerSession, type ExplainerSession} from "./store";

const workerEntry = () => path.join(process.cwd(), "packages/handdraw-agent/node_modules/tsx/dist/cli.mjs");
const alive = (pid?: number) => {if (!pid) return false; try {process.kill(pid, 0); return true;} catch {return false;}};
export const syncExplainerResource = async (jobId: string, sceneId: string, session: ExplainerSession) => {
  const scene = (await readVisualPlan(jobId)).scenes.find((item) => item.id === sceneId);
  return mutateVisualResources(jobId, (resources) => {
    const current = resources.resources.find((item) => item.sceneId === sceneId);
    // 镜头资源仍归属于真实口播段，删除镜头后的收尾不创建悬空资源。
    if (!current && !scene) return resources;
    const state = {status: session.status, progress: session.progress, error: session.error};
    if (JSON.stringify(current?.handdrawExplainer) === JSON.stringify(state)) return resources;
    return {...resources, resources: [...resources.resources.filter((item) => item.sceneId !== sceneId), {...(current ?? {sceneId, segmentId: scene!.segmentId, polygons: []}), handdrawExplainer: state}]};
  });
};

// 每次回写均重新检查请求身份；迟到工具只能留下不可变文件，不能替换当前候选。
export const mutateExplainerRequest = (jobId: string, sceneId: string, requestId: string, change: (current: ExplainerSession) => ExplainerSession | Promise<ExplainerSession>) => withExplainerLock(jobId, sceneId, async () => {
  const current = await assertExplainerRequest(jobId, sceneId, requestId);
  const next = await change(current);
  await writeExplainerSession(jobId, sceneId, next);
  await syncExplainerResource(jobId, sceneId, next);
  return next;
});

export const explainerRuntimeUnavailable = async () => {
  const files = [workerEntry(), path.join(process.cwd(), "packages/handdraw-agent/skills/we-video-handdraw/SKILL.md"), path.join(process.cwd(), "packages/handdraw-agent/scripts/compile.py"), path.join(process.cwd(), "packages/handdraw-agent/resources/hanzi/gb2312-strokes.json.xz")];
  const present = await Promise.all(files.map((file) => fs.access(file).then(() => true, () => false)));
  return !present[0] ? "请从项目根目录执行 npm ci --prefix packages/handdraw-agent 安装独立 Agent 依赖" : present.some((item) => !item) ? "手绘讲解的内置 Skill 或编译资源缺失，请完整部署 packages/handdraw-agent" : undefined;
};

export const readExplainerSnapshot = async (jobId: string, sceneId: string) => {
  const {context, profile} = await loadExplainerContext(jobId, sceneId);
  let session = await readExplainerSession(jobId, sceneId);
  const interrupted = session.status === "running" && ((session.pid ? !alive(session.pid) : Date.now() - (session.startedAt ?? 0) > 15000) || Date.now() - (session.startedAt ?? 0) > (session.timeoutMs ?? 900000));
  if (interrupted || session.fingerprint && session.fingerprint !== context.fingerprint && session.status !== "stale") {
    session = await withExplainerLock(jobId, sceneId, async () => {
      const latest = await readExplainerSession(jobId, sceneId);
      if (latest.requestId !== session.requestId) return latest;
      const stillInterrupted = latest.status === "running" && ((latest.pid ? !alive(latest.pid) : Date.now() - (latest.startedAt ?? 0) > 15000) || Date.now() - (latest.startedAt ?? 0) > (latest.timeoutMs ?? 900000));
      const stillStale = Boolean(latest.fingerprint && latest.fingerprint !== context.fingerprint);
      if (!stillInterrupted && !stillStale) return latest;
      const next: ExplainerSession = {...latest, status: stillInterrupted ? "interrupted" : "stale", progress: stillInterrupted ? "制作进程中断，已保留素材，可重试" : "口播、配音或布局已改变，请重新制作", error: undefined};
      await writeExplainerSession(jobId, sceneId, next); await syncExplainerResource(jobId, sceneId, next);
      if (latest.status === "running" && alive(latest.pid)) {try {process.kill(latest.pid!, "SIGTERM");} catch { /* 进程可能刚好结束。 */ }}
      return next;
    });
  }
  const candidate = await readExplainerCandidate(jobId, sceneId);
  const stale = Boolean(candidate && candidate.fingerprint !== context.fingerprint);
  let valid = false;
  try {if (candidate) {assertExplainerFrames(context.scene, candidate.data); valid = !stale;}} catch { /* 已保存候选仍可用于排查，但不能采用。 */ }
  const settings = await explainerSettings(profile);
  const unavailable = !settings.enabled ? "请在根 pipeline.config.json 设置 handdrawAgent.enabled=true" : await explainerRuntimeUnavailable();
  return {session, candidate, context, stale, canAdopt: Boolean(valid && candidate && session.status === "ready" && candidate.requestId === session.requestId && candidate.review?.pass === true && candidate.review.cacheKey === candidate.data.cacheKey), unavailable};
};

export const submitExplainer = (jobId: string, sceneId: string, message: string) => withExplainerLock(jobId, sceneId, async () => {
  const {context, profile, job} = await loadExplainerContext(jobId, sceneId);
  assertVisualPlanEditableState(job.state);
  if (job.state === "planning_visuals") throw new Error("镜头规划正在生成，请稍后制作");
  const settings = await explainerSettings(profile, true);
  if (!settings.enabled) throw new Error("请在根 pipeline.config.json 启用 handdrawAgent");
  const unavailable = await explainerRuntimeUnavailable(); if (unavailable) throw new Error(unavailable);
  // 启动前核对离线依赖，避免先付费生图后才发现部署缺少字体或固定绘制模块。
  await explainerDependencyIdentity();
  await assertExplainerEnvironment();
  const current = await readExplainerSession(jobId, sceneId);
  if (current.status === "running") throw new Error("手绘讲解正在制作，请等待完成或取消");
  const text = z.string().trim().min(1).max(8000).parse(message);
  const requestId = randomUUID();
  const session: ExplainerSession = {...current, status: "running", requestId, fingerprint: context.fingerprint, pid: undefined, startedAt: Date.now(), timeoutMs: settings.timeoutMs, error: undefined, progress: "启动手绘讲解 Agent", messages: [...current.messages, {id: requestId, role: "user", text}]};
  await writeExplainerSession(jobId, sceneId, session); await syncExplainerResource(jobId, sceneId, session);
  const log = openSync(path.join(explainerDirectory(jobId, sceneId), "worker.log"), "a");
  try {
    const child = spawn(process.execPath, [workerEntry(), "packages/handdraw-agent/src/worker.ts", jobId, sceneId, requestId], {cwd: process.cwd(), env: {...process.env}, detached: true, stdio: ["ignore", log, log]});
    await new Promise<void>((resolve, reject) => {child.once("spawn", resolve); child.once("error", reject);});
    await writeExplainerSession(jobId, sceneId, {...session, pid: child.pid}); child.unref();
  } catch {
    const failed: ExplainerSession = {...session, status: "failed", progress: "Agent 启动失败", error: "请检查独立 Agent 依赖与 Node.js 环境"};
    await writeExplainerSession(jobId, sceneId, failed); await syncExplainerResource(jobId, sceneId, failed);
  }
  finally {closeSync(log);}
});

export const cancelExplainer = (jobId: string, sceneId: string, reason = "已取消制作") => withExplainerLock(jobId, sceneId, async () => {
  const session = await readExplainerSession(jobId, sceneId);
  if (session.status !== "running") return;
  const next: ExplainerSession = {...session, status: "cancelled", progress: reason, error: undefined};
  await writeExplainerSession(jobId, sceneId, next); await syncExplainerResource(jobId, sceneId, next);
  if (alive(session.pid)) {try {process.kill(session.pid!, "SIGTERM");} catch { /* 已退出的子进程不再发送信号。 */ }}
});

export const publishExplainerCandidate = (jobId: string, sceneId: string, requestId: string, fingerprint: string, design: ExplainerDesign, data: unknown) => withExplainerLock(jobId, sceneId, async () => {
  await assertExplainerRequest(jobId, sceneId, requestId);
  const {context} = await loadExplainerContext(jobId, sceneId);
  if (context.fingerprint !== fingerprint) throw new Error("镜头上下文已变化，请重新制作");
  const checked = await verifyExplainerArtifacts(jobId, assertExplainerFrames(context.scene, data));
  await writeExplainerCandidate(jobId, sceneId, {requestId, fingerprint, design, data: checked});
});

export const adoptExplainer = (jobId: string, sceneId: string, withdraw = false) => withExplainerLock(jobId, sceneId, async () => {
  const {context, plan, scene, profile, job} = await loadExplainerContext(jobId, sceneId);
  assertVisualPlanEditableState(job.state);
  if (job.state === "planning_visuals") throw new Error("镜头规划正在生成，暂不能采用");
  const session = await readExplainerSession(jobId, sceneId);
  if (session.status === "running") throw new Error("请等待制作结束再采用或撤回");
  const candidate = await readExplainerCandidate(jobId, sceneId);
  if (!withdraw && (!candidate || session.status !== "ready" || session.requestId !== candidate.requestId || !candidate.review?.pass || candidate.review.cacheKey !== candidate.data.cacheKey)) throw new Error("没有可采用且通过复核的已完成候选");
  const source = withdraw ? scene.previousHanddrawExplainer : candidate?.data;
  if (!source) throw new Error("没有可恢复的上一份采用内容");
  if (source.contextFingerprint !== context.fingerprint) throw new Error("口播、音频或布局已变化，请重新制作");
  const data = await verifyExplainerArtifacts(jobId, assertExplainerFrames(context.scene, source));
  if (JSON.stringify(data) === JSON.stringify(scene.handdrawExplainer)) return plan;
  const scenes = plan.scenes.map((item) => item.id === sceneId ? {...item, handdrawExplainer: data, previousHanddrawExplainer: withdraw ? undefined : item.handdrawExplainer} : item);
  const saved = await saveVisualPlan(jobId, {schemaVersion: plan.schemaVersion, revision: plan.revision, visualStyle: plan.visualStyle, cover: plan.cover, feedback: plan.feedback, scenes}, profile, plan.planVersion);
  if (["ready", "completed", "failed"].includes(job.state)) await updateJobState(jobId, {state: "awaiting_visual_review", error: null});
  return saved;
});

export const reconcileExplainerRequests = async (jobId: string, previous: VisualPlan, next: VisualPlan) => {
  for (const before of previous.scenes.filter((item) => item.templateId === "rve/handdraw-explainer")) {
    const after = next.scenes.find((item) => item.id === before.id);
    const strip = (scene: typeof before) => ({...scene, handdrawExplainer: undefined, previousHanddrawExplainer: undefined});
    if (!after || after.templateId !== before.templateId || JSON.stringify(strip(before)) !== JSON.stringify(strip(after)) || previous.visualStyle !== next.visualStyle) {
      // 失效与终止在同一锁内完成，避免新请求插入后又被旧规划的收尾覆盖。
      await withExplainerLock(jobId, before.id, async () => {
        const session = await readExplainerSession(jobId, before.id);
        // 规划保存后的收尾可能晚到；新请求若已经使用最新上下文，不能再把它标记为过期。
        try {if (session.fingerprint && (await loadExplainerContext(jobId, before.id)).context.fingerprint === session.fingerprint) return;}
        catch { /* 目标已删除或切换模板时仍须终止旧请求。 */ }
        const stale: ExplainerSession = {...session, status: "stale", progress: "镜头上下文已变化，请重新制作", error: undefined};
        await writeExplainerSession(jobId, before.id, stale); await syncExplainerResource(jobId, before.id, stale);
        if (session.status === "running" && alive(session.pid)) {try {process.kill(session.pid!, "SIGTERM");} catch { /* 进程可能已经退出。 */ }}
      });
    }
  }
};

// 导出前重新读取真实配音和规划；已采用内容不依赖 Agent 或 Skill 才能播放。
export const verifyExplainerContext = async (jobId: string, raw: unknown, plan?: VisualPlan) => {
  const data = explainerDataSchema.parse(raw);
  const {context} = await loadExplainerContext(jobId, data.sceneId, plan);
  if (context.fingerprint !== data.contextFingerprint) throw new Error(`镜头 ${data.sceneId} 的手绘讲解已过期，请重新制作并采用`);
  if (context.durationInFrames !== data.durationInFrames) throw new Error("手绘讲解帧数与完整口播时间轴不一致，请重新制作");
  return verifyExplainerArtifacts(jobId, assertExplainerFrames(context.scene, data));
};

export const recoverExplainerRequests = async () => {
  const {JOBS_ROOT} = await import("../paths");
  const jobs = await fs.readdir(JOBS_ROOT, {withFileTypes: true}).catch(() => []);
  for (const entry of jobs.filter((item) => item.isDirectory())) {
    const directory = path.join(JOBS_ROOT, entry.name, "handdraw-explainers");
    const scenes = await fs.readdir(directory, {withFileTypes: true}).catch(() => []);
    for (const scene of scenes.filter((item) => item.isDirectory())) {
      await withExplainerLock(entry.name, scene.name, async () => {
        const session = await readExplainerSession(entry.name, scene.name);
        if (session.status !== "running" || alive(session.pid)) return;
        const next: ExplainerSession = {...session, status: "interrupted", progress: "制作进程已中断，素材已保留，可重试"};
        await writeExplainerSession(entry.name, scene.name, next); await syncExplainerResource(entry.name, scene.name, next);
      }).catch(() => undefined);
    }
  }
};
