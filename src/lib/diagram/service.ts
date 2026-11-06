import {promises as fs, openSync, closeSync} from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {updateJobState} from "../jobs";
import {assertVisualPlanEditableState, readVisualPlan, saveVisualPlan, type VisualPlan} from "../visual-plan";
import {mutateVisualResources} from "../visual-resources";
import {loadDiagramContext} from "./context";
import {diagramSettings} from "./settings";
import {validateDiagramMeaning} from "./meaning";
import {inspectDiagramGeometry} from "./geometry";
import {diagramBindingSchema, diagramDataSchema, validateDiagram} from "../../remotion/templates/auto-diagram-schema";
import {diagramDirectory, readDiagramSession, writeDiagramSession, readDiagramCandidate, writeDiagramCandidate, type DiagramSession} from "./store";

export const syncDiagramResource = async (jobId: string, sceneId: string, session: DiagramSession) => {
  const plan = await readVisualPlan(jobId);
  const segmentId = plan.scenes.find((scene) => scene.id === sceneId)?.segmentId ?? sceneId;
  await mutateVisualResources(jobId, (resources) => {
    const found = resources.resources.find((item) => item.sceneId === sceneId);
    return {...resources, resources: [...resources.resources.filter((item) => item.sceneId !== sceneId), {...(found ?? {segmentId, sceneId, polygons: []}), diagram: {status: session.status, requestId: session.requestId, message: session.error ?? session.progress, traceId: session.traceId}}]};
  });
};
const alive = (pid?: number) => {if (!pid) return false; try {process.kill(pid, 0); return true;} catch {return false;}};

export const readDiagramSnapshot = async (jobId: string, sceneId: string) => {
  const {context} = await loadDiagramContext(jobId, sceneId);
  let session = await readDiagramSession(jobId, sceneId);
  const candidate = await readDiagramCandidate(jobId, sceneId);
  if (session.status === "running" && ((!alive(session.pid) && Date.now() - (session.startedAt ?? 0) > 5000) || Date.now() - (session.startedAt ?? 0) > (session.timeoutMs ?? 180000) + 10000)) {
    // 进程消失后只标记中断，保留检查点，不自动续跑未完成的工具。
    session = {...session, status: "interrupted", progress: "worker 已中断，请重试", error: "上次请求未完成；保存的图形与会话仍可继续使用"};
    await writeDiagramSession(jobId, sceneId, session); await syncDiagramResource(jobId, sceneId, session);
  }
  const stale = Boolean(candidate && candidate.fingerprint !== context.fingerprint);
  if (stale && session.status !== "running" && session.status !== "stale") {
    session = {...session, status: "stale", progress: "镜头上下文已变化，请重新制图"};
    await writeDiagramSession(jobId, sceneId, session); await syncDiagramResource(jobId, sceneId, session);
  }
  let validationErrors = candidate?.errors ?? [];
  if (candidate && !stale) {
    try {validateDiagram(context.scene, context.captions, candidate.data); validateDiagramMeaning(candidate.data, context.scene.spokenText, candidate.cycleEvidence);}
    catch (error) {validationErrors = [error instanceof Error ? error.message : "图表校验失败"];}
  }
  const settings = await diagramSettings().catch(() => null);
  const runtimePresent = await fs.access(path.join(process.cwd(), "packages/diagram-agent/node_modules/tsx/dist/cli.mjs")).then(() => true, () => false);
  const skillPresent = await fs.access(path.join(process.cwd(), "packages/diagram-agent/resources/skills/diagram-design/SKILL.md")).then(() => true, () => false);
  const unavailable = !settings?.enabled ? "请在根目录 pipeline.config.json 设置 diagramAgent.enabled=true" : !runtimePresent ? "请执行 npm install --prefix packages/diagram-agent 安装独立依赖" : !skillPresent ? "内置 diagram-design 资源缺失，请重新部署完整 packages/diagram-agent/resources" : undefined;
  return {session, candidate, stale, validationErrors, canAdopt: Boolean(candidate?.valid && !stale && !validationErrors.length && session.status !== "running" && candidate.requestId === session.requestId && session.status === "ready"), unavailable};
};

export const submitDiagram = async (jobId: string, sceneId: string, message: string) => {
  const {context, job, profile} = await loadDiagramContext(jobId, sceneId);
  assertVisualPlanEditableState(job.state);
  if (job.state === "planning_visuals") throw new Error("镜头规划正在生成，请完成后再制图");
  const snapshot = await readDiagramSnapshot(jobId, sceneId);
  if (snapshot.unavailable) throw new Error(snapshot.unavailable);
  if (snapshot.session.status === "running") throw new Error("图表正在生成，请等待完成或取消");
  const text = z.string().trim().min(1).max(8000).parse(message);
  const settings = await diagramSettings(profile);
  const requestId = randomUUID();
  const session: DiagramSession = {...snapshot.session, requestId, status: "running", fingerprint: context.fingerprint, startedAt: Date.now(), timeoutMs: settings.timeoutMs, pid: undefined, traceId: undefined, error: undefined, progress: "启动独立 Agent", messages: [...snapshot.session.messages, {id: requestId, role: "user", text}]};
  await writeDiagramSession(jobId, sceneId, session);
  await syncDiagramResource(jobId, sceneId, session);
  const log = openSync(path.join(diagramDirectory(jobId, sceneId), "worker.log"), "a");
  try {
    const child = spawn(process.execPath, [path.join(process.cwd(), "packages/diagram-agent/node_modules/tsx/dist/cli.mjs"), "packages/diagram-agent/src/worker.ts", jobId, sceneId, requestId], {cwd: process.cwd(), detached: true, env: {...process.env}, stdio: ["ignore", log, log]});
    await new Promise<void>((resolve, reject) => {child.once("spawn", resolve); child.once("error", reject);});
    // worker 首先等待 PID 回写，避免启动阶段的状态覆盖。
    await writeDiagramSession(jobId, sceneId, {...session, pid: child.pid});
    child.unref();
  } catch {
    await writeDiagramSession(jobId, sceneId, {...session, status: "failed", progress: "worker 启动失败", error: "请检查独立依赖与 Node.js 运行环境后重试"});
  } finally {closeSync(log);}
  return readDiagramSnapshot(jobId, sceneId);
};

export const cancelDiagram = async (jobId: string, sceneId: string, reason = "用户取消了请求") => {
  const session = await readDiagramSession(jobId, sceneId);
  if (session.status !== "running") return;
  // 先使请求无效，再终止进程，迟到的工具写入无法被采用。
  const next: DiagramSession = {...session, status: "cancelled", progress: reason, error: undefined};
  await writeDiagramSession(jobId, sceneId, next); await syncDiagramResource(jobId, sceneId, next);
  if (alive(session.pid)) {try {process.kill(session.pid!, "SIGTERM");} catch { /* 进程可能已自行退出。 */ }}
};

export const changeDiagramBindings = async (jobId: string, sceneId: string, input: unknown) => {
  const {context, job} = await loadDiagramContext(jobId, sceneId); assertVisualPlanEditableState(job.state);
  const session = await readDiagramSession(jobId, sceneId);
  if (session.status === "running") throw new Error("生成期间不能修改绑定");
  const candidate = await readDiagramCandidate(jobId, sceneId);
  if (!candidate) throw new Error("尚无图表，请先发送生成指令");
  if (candidate.fingerprint !== context.fingerprint) throw new Error("口播、风格或布局已改变，请发送指令重新制图");
  const bindings = z.array(diagramBindingSchema).min(1).max(40).parse(input);
  const data = diagramDataSchema.parse({...candidate.data, bindings});
  const errors: string[] = [];
  // 手动调整绑定不能绕过循环证据与几何门槛。
  try {validateDiagram(context.scene, context.captions, data); validateDiagramMeaning(data, context.scene.spokenText, candidate.cycleEvidence); errors.push(...await inspectDiagramGeometry(data, context.canvas.safeArea));}
  catch (error) {errors.push(error instanceof Error ? error.message : "校验失败");}
  await writeDiagramCandidate(jobId, sceneId, {...candidate, data, valid: !errors.length, errors});
  const next: DiagramSession = {...session, requestId: candidate.requestId, status: errors.length ? "failed" : "ready", progress: errors.length ? "绑定待修正" : "绑定已重新校验", error: errors.join("；") || undefined};
  await writeDiagramSession(jobId, sceneId, next); await syncDiagramResource(jobId, sceneId, next);
  return readDiagramSnapshot(jobId, sceneId);
};

export const adoptDiagram = async (jobId: string, sceneId: string, withdraw = false) => {
  const {context, plan, scene, profile, job} = await loadDiagramContext(jobId, sceneId); assertVisualPlanEditableState(job.state);
  if (job.state === "planning_visuals") throw new Error("镜头规划正在生成，暂不能采用");
  const snapshot = await readDiagramSnapshot(jobId, sceneId);
  if (snapshot.session.status === "running") throw new Error("请等待生成结束再采用或撤回");
  if (!withdraw && !snapshot.canAdopt) throw new Error("当前图表未通过校验或已过期，请修正后重新采用");
  const source = withdraw ? scene.previousDiagram : snapshot.candidate ? {...snapshot.candidate.data, contextFingerprint: snapshot.candidate.fingerprint} : undefined;
  if (!source) throw new Error("没有上一份采用内容");
  // 重复采用同一候选不覆盖唯一的撤回槽位。
  if (!withdraw && JSON.stringify(source) === JSON.stringify(scene.diagram)) return plan;
  if (source.contextFingerprint !== context.fingerprint) throw new Error("图表上下文已变化，请重新生成");
  const data = diagramDataSchema.parse({type: source.type, svg: source.svg, bindings: source.bindings});
  validateDiagram(context.scene, context.captions, data);
  const geometry = await inspectDiagramGeometry(data, context.canvas.safeArea);
  if (geometry.length) throw new Error(geometry.join("；"));
  const next = {...plan, scenes: plan.scenes.map((item) => item.id === sceneId ? {...item, diagram: source, previousDiagram: withdraw ? undefined : item.diagram} : item)};
  const saved = await saveVisualPlan(jobId, {schemaVersion: next.schemaVersion, revision: next.revision, feedback: next.feedback, cover: next.cover, visualStyle: next.visualStyle, scenes: next.scenes}, profile);
  if (["ready", "completed", "failed"].includes(job.state)) await updateJobState(jobId, {state: "awaiting_visual_review", error: null});
  return saved;
};

export const reconcileDiagramRequests = async (jobId: string, previous: VisualPlan, next: VisualPlan) => {
  for (const before of previous.scenes) {
    if (before.templateId !== "rve/auto-diagram") continue;
    const after = next.scenes.find((scene) => scene.id === before.id);
    const changed = !after || after.templateId !== "rve/auto-diagram" || JSON.stringify({...before, diagram: undefined, previousDiagram: undefined}) !== JSON.stringify({...after, diagram: undefined, previousDiagram: undefined}) || previous.visualStyle !== next.visualStyle;
    if (changed) {
      await cancelDiagram(jobId, before.id, "镜头或上下文已变化，请重新制图");
      if (after?.templateId === "rve/auto-diagram") {
        const session = await readDiagramSession(jobId, before.id);
        const stale = {...session, status: "stale" as const, progress: "镜头上下文已变化，请重新制图"};
        await writeDiagramSession(jobId, before.id, stale); await syncDiagramResource(jobId, before.id, stale);
      }
    }
  }
  // 副本拥有独立会话与工作区；保留图形，但指纹要求在新边界下重新生成。
  for (const scene of next.scenes) {
    if (scene.templateId !== "rve/auto-diagram" || previous.scenes.some((item) => item.id === scene.id)) continue;
    const sourceId = scene.id.endsWith("-split") ? scene.id.slice(0, -6) : undefined;
    if (!sourceId) continue;
    const candidate = await readDiagramCandidate(jobId, sourceId);
    if (candidate) await writeDiagramCandidate(jobId, scene.id, {...candidate, valid: false, errors: ["镜头拆分后需要重新制图和绑定"]});
  }
};

// 服务重启时扫描会话，将已消失的 worker 请求显式标记为中断。
export const recoverDiagramRequests = async () => {
  const {JOBS_ROOT} = await import("../paths");
  const jobs = await fs.readdir(JOBS_ROOT, {withFileTypes: true}).catch(() => []);
  for (const job of jobs.filter((entry) => entry.isDirectory())) {
    const scenes = await fs.readdir(path.join(JOBS_ROOT, job.name, "diagrams"), {withFileTypes: true}).catch(() => []);
    for (const scene of scenes.filter((entry) => entry.isDirectory())) {
      const session = await readDiagramSession(job.name, scene.name).catch(() => null);
      if (session?.status === "running" && !alive(session.pid)) {
        const next: DiagramSession = {...session, status: "interrupted", progress: "worker 已中断，请重试"};
        await writeDiagramSession(job.name, scene.name, next); await syncDiagramResource(job.name, scene.name, next);
      }
    }
  }
};
