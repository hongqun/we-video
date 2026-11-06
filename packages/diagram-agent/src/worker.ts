// 独立包与主项目统一按 CommonJS 加载，避免 tsx 跨包 ESM 命名导入无法识别共享导出。
import path from "node:path";
import {randomUUID} from "node:crypto";
import {promises as fs} from "node:fs";
import {config as loadEnv} from "dotenv";
import {createDeepAgent, FilesystemBackend} from "deepagents";
import {ChatOpenAI} from "@langchain/openai";
import {tool} from "@langchain/core/tools";
import {awaitAllCallbacks} from "@langchain/core/callbacks/promises";
import {createMiddleware} from "langchain";
import {SqliteSaver} from "@langchain/langgraph-checkpoint-sqlite";
import {z} from "zod";
import {traceable} from "langsmith/traceable";
import {Client} from "langsmith";
import {getLangchainCallbacks} from "langsmith/langchain";
import {currentDiagramTurn, diagramUserRequest} from "./model-context";
import {loadDiagramContext} from "../../../src/lib/diagram/context";
import {diagramSettings} from "../../../src/lib/diagram/settings";
import {assertDiagramRequest, diagramDirectory, readDiagramCandidate, readDiagramSession, writeDiagramCandidate, writeDiagramSession} from "../../../src/lib/diagram/store";
import {syncDiagramResource} from "../../../src/lib/diagram/service";
import {inspectDiagram, DiagramInspectionError, type DiagramInspection} from "../../../src/lib/diagram/geometry";
import {validateDiagramMeaning} from "../../../src/lib/diagram/meaning";
import {diagramDataSchema, validateDiagram} from "../../../src/remotion/templates/auto-diagram-schema";

// 独立进程始终从项目根目录读取配置；不创建包级 .env 或密钥快照。
loadEnv({path: path.join(process.cwd(), ".env"), quiet: true});
process.env.LANGSMITH_PROJECT ||= "we-video-diagram-agent";
process.env.LANGCHAIN_CALLBACKS_BACKGROUND = "true";
const [jobId, sceneId, requestId] = process.argv.slice(2);
if (!jobId || !sceneId || !requestId) throw new Error("worker 需要 jobId、sceneId、requestId");
const controller = new AbortController();
let timedOut = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let saver: SqliteSaver | undefined;
let inspectionFailure: DiagramInspectionError | undefined;
// 仅将本地生成的诊断展示给界面，SDK 原始异常仍不包含在日志中。
class DiagramExecutionError extends Error {}

// 只读 backend 仅映射内置资源，不把项目或工作区暴露给通用文件工具。
class ReadOnlySkills extends FilesystemBackend {
  override async write() {return {error: "内置 Skill 只读，请使用 save_diagram 保存图表"};}
  override async edit() {return {error: "内置 Skill 只读"};}
  override async uploadFiles(files: Array<[string, Uint8Array]>) {return files.map(([filePath]) => ({path: filePath, error: "permission_denied" as const}));}
  override async delete() {return {error: "内置 Skill 只读"};}
}

const main = async () => {
  // 请求创建者先写入 PID，worker 再开始回写进度。
  for (let attempt = 0; attempt < 50; attempt++) {
    const state = await assertDiagramRequest(jobId, sceneId, requestId);
    if (state.pid === process.pid) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const {context, profile} = await loadDiagramContext(jobId, sceneId);
  const settings = await diagramSettings(profile, true);
  if (!settings.enabled) throw new Error("自动图表 Agent 未启用");
  const resources = path.join(process.cwd(), "packages/diagram-agent/resources");
  await fs.access(path.join(resources, "skills/diagram-design/SKILL.md"));
  const session = await assertDiagramRequest(jobId, sceneId, requestId);
  if (session.fingerprint !== context.fingerprint) throw new Error("镜头上下文已改变，请重新发送指令");
  timer = setTimeout(() => {timedOut = true; controller.abort();}, settings.timeoutMs);
  // 父进程失联与模型挂起也受硬超时保护，避免后台长期占用。
  const hardTimer = setTimeout(() => {void fail("Agent 执行超时，请重试").finally(() => process.exit(1));}, settings.timeoutMs + 5000);
  hardTimer.unref();
  process.once("SIGTERM", () => {controller.abort(); process.exit(0);});
  let attempts = 0, calls = 0;
  // 流式文本和工具进度共用写入队列，避免并发覆盖同一会话文件。
  let sessionWrites = Promise.resolve();
  const mutateSession = (change: (latest: Awaited<ReturnType<typeof readDiagramSession>>) => Awaited<ReturnType<typeof readDiagramSession>>, sync = false) => {
    const pending = sessionWrites.then(async () => {
      const latest = await assertDiagramRequest(jobId, sceneId, requestId);
      const next = change(latest);
      await writeDiagramSession(jobId, sceneId, next);
      if (sync) await syncDiagramResource(jobId, sceneId, next);
    });
    sessionWrites = pending.catch(() => undefined);
    return pending;
  };
  const update = async (progress: string, toolResult?: string) => {
    const id = `${requestId}:tool:${calls}`;
    await mutateSession((latest) => ({...latest, traceId: process.env.LANGSMITH_TRACING === "true" ? requestId : undefined, progress, messages: toolResult ? [...latest.messages.filter((item) => item.id !== id), {id, role: "tool" as const, text: toolResult.slice(0, 6000)}] : latest.messages}), true);
  };
  // 同一候选的保存、复查和收尾复用检查，截图与候选内容严格关联。
  let inspection: {key: string; report: DiagramInspection; screenshotPath: string} | undefined;
  let reviewedKey = "";
  const candidateKey = (data: unknown) => JSON.stringify(data);
  const checkCurrent = async () => {
    const candidate = await readDiagramCandidate(jobId, sceneId);
    if (!candidate) return {valid: false, errors: ["尚未提交 SVG"]};
    const errors: string[] = [];
    try {
      validateDiagram(context.scene, context.captions, candidate.data);
      validateDiagramMeaning(candidate.data, context.scene.spokenText, candidate.cycleEvidence);
      const key = candidateKey(candidate.data);
      if (inspection?.key !== key) {
        const screenshotPath = path.join(diagramDirectory(jobId, sceneId), `preview-${requestId}.png`);
        const report = await inspectDiagram(candidate.data, context.canvas.safeArea, screenshotPath);
        inspection = {key, report, screenshotPath};
      }
      errors.push(...inspection.report.errors);
    } catch (error) {
      if (error instanceof DiagramInspectionError) {
        inspectionFailure = error;
        await writeDiagramCandidate(jobId, sceneId, {...candidate, valid: false, errors: [error.message]});
        throw error;
      }
      errors.push(error instanceof Error ? error.message : "图表校验失败");
    }
    await assertDiagramRequest(jobId, sceneId, requestId);
    const latest = await loadDiagramContext(jobId, sceneId);
    if (latest.context.fingerprint !== context.fingerprint) throw new Error("镜头上下文已变化");
    await writeDiagramCandidate(jobId, sceneId, {...candidate, valid: false, errors, geometry: errors});
    return {valid: errors.length === 0, errors};
  };
  const tools = [
    // 模型只需要口播、布局和品牌，避免重复发送旧 templateData 与整份字幕时间。
    tool(async () => ({spokenText: context.scene.spokenText, title: context.scene.content.title, style: context.style, canvas: context.canvas, timing: context.timing}), {name: "get_scene_context", description: "读取本镜头口播、画布、视频风格及人物安全区，不返回字幕时间或旧模板数据。", schema: z.object({})}),
    tool(async () => await readDiagramCandidate(jobId, sceneId), {name: "read_current_diagram", description: "读取当前保存的 SVG、绑定及校验结果，便于多轮修改。", schema: z.object({})}),
    tool(async (input) => {
      if (attempts >= 3) throw new Error("已达到首次提交加两次自动修复预算，请继续对话修改");
      attempts++;
      await update(attempts === 1 ? "制图与绑定" : `自动修复 ${attempts - 1}/2`);
      const {cycleEvidence, ...payload} = input;
      const data = diagramDataSchema.parse(payload);
      // 先保存候选，校验失败时仍有文件可供继续修复；只有请求完成才能采用。
      await assertDiagramRequest(jobId, sceneId, requestId);
      await writeDiagramCandidate(jobId, sceneId, {data, cycleEvidence, fingerprint: context.fingerprint, requestId, valid: false, errors: ["待校验"]});
      const report = await checkCurrent(); await update(report.valid ? "图表校验通过" : "校验失败，等待修复", JSON.stringify(report)); return report;
    }, {name: "save_diagram", description: "保存当前 SVG 与口播绑定并执行安全、时间和浏览器几何校验。失败后最多再提交两次。", schema: diagramDataSchema.extend({cycleEvidence: z.string().trim().min(1).max(500).optional().describe("仅 cycle 必填：引用口播中明确返回前序步骤或重复执行的原文")})}),
    tool(async () => {await update("校验当前 SVG 与绑定"); return checkCurrent();}, {name: "validate_diagram", description: "对当前图表重新执行白名单、依赖、口播和浏览器几何检查。", schema: z.object({})}),
    tool(async () => {
      const result = await checkCurrent();
      const candidate = await readDiagramCandidate(jobId, sceneId);
      const current = inspection && candidate && inspection.key === candidateKey(candidate.data) ? inspection : undefined;
      if (result.valid && current) reviewedKey = current.key;
      const text = JSON.stringify({...result, measurements: current?.report, screenshotPath: current?.screenshotPath, visualReview: settings.supportsVision ? "附图供视觉审核" : "文本模型仅收到几何报告，截图供人工查看，未完成模型看图审核"});
      if (!settings.supportsVision || !current) return [{type: "text" as const, text}];
      return [{type: "text" as const, text}, {type: "image_url" as const, image_url: {url: `data:image/png;base64,${(await fs.readFile(current.screenshotPath)).toString("base64")}`}}];
    }, {name: "inspect_diagram", description: "复查当前图表的文字、连接点和安全区，保存并返回预览截图位置；支持图像输入的模型还会收到截图。完成前必须调用。", schema: z.object({})}),
  ];
  const allowed = new Set(["get_scene_context", "read_current_diagram", "save_diagram", "validate_diagram", "inspect_diagram", "ls", "read_file", "glob", "grep", "write_todos"]);
  // 在执行边界阻止 shell、子 Agent 和所有通用写入工具，不能仅依赖提示词限制。
  const guard = createMiddleware({name: "DiagramBudgetAndIsolation", wrapToolCall: async (request, handler) => {
    await assertDiagramRequest(jobId, sceneId, requestId);
    if (inspectionFailure) throw inspectionFailure;
    if (controller.signal.aborted || ++calls > settings.maxSteps) throw new Error("执行预算耗尽或请求已取消");
    if (!allowed.has(request.toolCall.name)) throw new Error("首版仅支持读取 Skill 和专用图表工具，不开放 shell 或子 Agent");
    return handler(request);
  }, wrapModelCall: async (request, handler) => handler({...request, messages: currentDiagramTurn(request.messages), tools: request.tools.filter((item) => typeof item.name === "string" && allowed.has(item.name))}), beforeModel: async () => {
    await assertDiagramRequest(jobId, sceneId, requestId);
    if (inspectionFailure) throw inspectionFailure;
    if (controller.signal.aborted || ++calls > settings.maxSteps) throw new Error("执行预算耗尽或请求已取消");
    return undefined;
  }});
  saver = SqliteSaver.fromConnString(path.join(diagramDirectory(jobId, sceneId), "checkpoints.sqlite"));
  // 与主项目镜头规划保持一致，关闭 DeepSeek 思考模式，避免输出预算全部消耗在思考中。
  const model = new ChatOpenAI({model: settings.model, apiKey: settings.apiKey, configuration: {baseURL: settings.baseURL}, modelKwargs: {thinking: {type: "disabled"}}, temperature: 0.3, streaming: true, maxTokens: settings.maxTokens, maxRetries: 0, timeout: settings.timeoutMs});
  const agent = await createDeepAgent({name: "we-video-diagram-agent", model, checkpointer: saver, backend: new ReadOnlySkills({rootDir: resources, virtualMode: true, maxFileSizeMb: 4}), skills: ["/skills/"], subagents: [], permissions: [{operations: ["write"], paths: ["/**"], mode: "deny"}], tools, middleware: [guard], systemPrompt: `你是视频自动图表设计 Agent。先读取 /video-diagram-contract.md，再按其路由读取匹配的 diagram-design 类型参考和一个静态示例；不得委派、联网、执行 shell 或运行 HTML 控制器。
严格遵守视频适配契约。先 get_scene_context；修改已有图时先 read_current_diagram。本轮上下文是事实源，用户历史偏好按最新要求覆盖。
只支持 flow、architecture、hierarchy、cycle、timeline。“先、再、接着、最后”优先 flow；“环环相扣”不构成 cycle 依据。cycle 必须提交 cycleEvidence 引用明确返回或重复的口播。
SVG 只能包含 svg/g/defs/path/rect/circle/ellipse/line/polyline/polygon/text/tspan/linearGradient/radialGradient/stop/marker/clipPath/title/desc。viewBox="0 0 960 800"，使用本地 Studio Sans / Studio Serif，中文至少 12px。
每个可见元素归属 opening 或唯一绑定 g，分组不嵌套。每个绑定含 groupId、name、cueText、occurrence、after、kind。边 after 含两端节点且触发不早于两端。
先说明图型与布局，再 save_diagram，按返回的具体几何错误修正，最多三次保存。最后调用 inspect_diagram 复查当前版本；有图像输入时检查截图，文本模式不得宣称已看图。检查器自身异常应停止，不能反复重画。失败如实说明，成功简短说明待预览。`});
  await update("读取设计资料、选择图型");
  const userRequest = diagramUserRequest(session);
  // 始终开始新调用，持久检查点仅恢复对话；不续跑上个中断调用的 pending tools。
  type StreamMessage = {id?: string; content: unknown; response_metadata?: {finish_reason?: string}};
  let result: {messages?: StreamMessage[]} = {};
  let pendingText = "", messageId = "", lastWrite = 0;
  const flushText = async () => {
    if (!pendingText || !messageId) return;
    const text = pendingText.slice(0, 6000), id = messageId;
    await mutateSession((latest) => ({...latest, messages: latest.messages.some((item) => item.id === id) ? latest.messages.map((item) => item.id === id ? {...item, text} : item) : [...latest.messages, {id, role: "assistant", text}]}));
    lastWrite = Date.now();
  };
  // messages 只消费公开文本，不展示思考或 SVG 工具参数；values 保留最终校验所需状态。
  const runConfig = {configurable: {thread_id: session.threadId}, runId: randomUUID(), callbacks: await getLangchainCallbacks(), metadata: {jobId, sceneId, threadId: session.threadId, requestId}, recursionLimit: settings.maxSteps, signal: controller.signal};
  const stream = await agent.stream({messages: [{role: "user", content: userRequest} ]}, {...runConfig, streamMode: ["messages", "values"]});
  for await (const [mode, payload] of stream) {
    if (mode === "values") {result = payload as typeof result; await flushText(); continue;}
    const [chunk] = payload as unknown as [StreamMessage];
    const id = `${requestId}:assistant:${chunk.id ?? "current"}`;
    if (id !== messageId) {await flushText(); pendingText = ""; messageId = id;}
    const text = typeof chunk.content === "string" ? chunk.content : Array.isArray(chunk.content) ? chunk.content.filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("") : "";
    pendingText += text;
    if (Date.now() - lastWrite >= 120) await flushText();
  }
  await flushText();
  // 截断响应不能视作正常完成，也不能用通用连接错误掩盖实际原因。
  const finalMessage = (result as unknown as {messages?: Array<{response_metadata?: {finish_reason?: string}}>}).messages?.at(-1);
  if (finalMessage?.response_metadata?.finish_reason === "length") throw new DiagramExecutionError(`模型输出达到 ${settings.maxTokens} token 上限，图表未完成，请重试或提高 diagramAgent.maxTokens`);
  const report = await checkCurrent();
  const candidate = await readDiagramCandidate(jobId, sceneId);
  if (!candidate || candidate.requestId !== requestId || !report.valid) throw new DiagramExecutionError(report.errors.join("；") || "Agent 未提交有效图表，请继续对话");
  await assertDiagramRequest(jobId, sceneId, requestId);
  if (reviewedKey !== candidateKey(candidate.data)) throw new DiagramExecutionError("当前图表尚未执行 inspect_diagram 复查，请继续对话完成检查");
  await writeDiagramCandidate(jobId, sceneId, {...candidate, valid: true, errors: []});
  const latest = await assertDiagramRequest(jobId, sceneId, requestId);
  const lastMessage = result.messages?.at(-1);
  const answer = typeof lastMessage?.content === "string" ? lastMessage.content : "图表与口播绑定已通过校验，请预览后采用。";
  const finalId = lastMessage?.id ? `${requestId}:assistant:${lastMessage.id}` : messageId || `${requestId}:assistant`;
  const next = {...latest, status: "ready" as const, progress: "等待预览和采用", messages: latest.messages.some((item) => item.id === finalId) ? latest.messages.map((item) => item.id === finalId ? {...item, text: answer.slice(0, 6000)} : item) : [...latest.messages, {id: finalId, role: "assistant" as const, text: answer.slice(0, 6000)}]};
  await writeDiagramSession(jobId, sceneId, next); await syncDiagramResource(jobId, sceneId, next);
  return {status: "ready", valid: true, requestId, review: settings.supportsVision ? "image" : "geometry", attempts};
};
const fail = async (message: string) => {
  const session = await readDiagramSession(jobId, sceneId);
  if (session.requestId !== requestId || session.status !== "running") return;
  const candidate = await readDiagramCandidate(jobId, sceneId);
  const error = candidate?.requestId === requestId && candidate.errors.length ? candidate.errors.join("；") : message;
  const next = {...session, status: "failed" as const, error, progress: "生成失败，文件已保留，可重试或继续对话"};
  await writeDiagramSession(jobId, sceneId, next); await syncDiagramResource(jobId, sceneId, next);
};
// 根追踪覆盖启动、Agent、最终检查及业务状态回写，失败时根调用也显示失败。
const traceClient = new Client();
const tracedRequest = traceable(async () => {
  try {return await main();}
  catch (error: unknown) {
    const message = timedOut ? "Agent 执行超时，请重试" : inspectionFailure?.message ?? (error instanceof DiagramExecutionError ? error.message : "Agent 运行失败，请检查模型连接、独立依赖和内置 Skill 后重试");
    await fail(message);
    // 上传经过筛选的业务诊断，不将 SDK 配置或请求头写入根追踪错误。
    throw new DiagramExecutionError(message);
  }
}, {client: traceClient, id: requestId, name: "diagram-request", metadata: {jobId, sceneId, requestId, threadId: `${jobId}:${sceneId}`, thread_id: `${jobId}:${sceneId}`}});
tracedRequest().catch(() => {process.exitCode = 1;}).finally(async () => {
  if (timer) clearTimeout(timer);
  saver?.db.close();
  await awaitAllCallbacks();
  // 根追踪使用独立 SDK 队列，需单独等待，追踪上传失败不改变业务结果。
  await traceClient.awaitPendingTraceBatches().catch(() => undefined);
});
