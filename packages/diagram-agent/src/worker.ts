// 独立包与主项目统一按 CommonJS 加载，避免 tsx 跨包 ESM 命名导入无法识别共享导出。
import path from "node:path";
import {randomUUID} from "node:crypto";
import {promises as fs} from "node:fs";
import {config as loadEnv} from "dotenv";
import {createDeepAgent, CompositeBackend, FilesystemBackend} from "deepagents";
import {ChatOpenAI} from "@langchain/openai";
import {tool} from "@langchain/core/tools";
import {awaitAllCallbacks} from "@langchain/core/callbacks/promises";
import type {BaseMessage} from "@langchain/core/messages";
import {GraphRecursionError} from "@langchain/langgraph";
import {createMiddleware} from "langchain";
import {SqliteSaver} from "@langchain/langgraph-checkpoint-sqlite";
import {z} from "zod";
import {traceable} from "langsmith/traceable";
import {Client} from "langsmith";
import {getLangchainCallbacks} from "langsmith/langchain";
import {XMLSerializer} from "@xmldom/xmldom";
import {currentDiagramTurn, diagramAssistantText, diagramGraphRecursionLimit, diagramUserRequest} from "./model-context";
import {DiagramModelError, DiagramStreamBoundary, retryDiagramModel} from "./model-retry";
import {assertDiagramCandidateReady} from "./candidate-review";
import {loadDiagramContext} from "../../../src/lib/diagram/context";
import {diagramSettings} from "../../../src/lib/diagram/settings";
import {diagramSkillVirtualPath, resolveDiagramResources} from "../../../src/lib/diagram/resources";
import {assertDiagramRequest, diagramDirectory, readDiagramCandidate, readDiagramSession, writeDiagramCandidate, writeDiagramSession} from "../../../src/lib/diagram/store";
import {syncDiagramResource} from "../../../src/lib/diagram/service";
import {inspectDiagram, DiagramInspectionError, type DiagramInspection} from "../../../src/lib/diagram/geometry";
import {DiagramSaveBudget, diagramCandidateHash, diagramPatchSchema, patchDiagram} from "../../../src/lib/diagram/candidate";
import {compactDiagramReport, validateDiagramCandidate, type DiagramValidationReport} from "../../../src/lib/diagram/validation";
import {diagramDataSchema, parseDiagramSvg, type DiagramData} from "../../../src/remotion/templates/auto-diagram-schema";
import {diagramTypeCatalog} from "../../../src/remotion/diagram-types";

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
// 工具中间件可能将异常转为模型反馈，另存停止原因以防下一步继续执行。
let executionFailure: DiagramExecutionError | undefined;
let modelFailure: DiagramModelError | undefined;
// 失败收尾也能读取最后计数，且只记录经过筛选的业务元数据。
const diagnostics = {requestId, category: "starting", candidateHash: undefined as string | undefined, saves: 0, calls: 0, modelRetries: 0};

// 只读 backend 分别映射视频契约与独立安装的 Skill，不暴露整个项目或其他 Skill。
class ReadOnlySkills extends FilesystemBackend {
  override async write() {return {error: "设计资料只读，请使用 save_diagram 保存图表"};}
  override async edit() {return {error: "设计资料只读"};}
  override async uploadFiles(files: Array<[string, Uint8Array]>) {return files.map(([filePath]) => ({path: filePath, error: "permission_denied" as const}));}
  override async delete() {return {error: "设计资料只读"};}
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
  const resources = await resolveDiagramResources();
  if (resources.unavailable) throw new DiagramExecutionError(resources.unavailable);
  // 保持模型看到的虚拟路径不变；直接指定单个 Skill，避免扫描其他本地安装。
  const backend = new CompositeBackend(
    new ReadOnlySkills({rootDir: resources.contractDirectory, virtualMode: true, maxFileSizeMb: 4}),
    {[diagramSkillVirtualPath]: new ReadOnlySkills({rootDir: resources.skillDirectory, virtualMode: true, maxFileSizeMb: 4})},
  );
  const session = await assertDiagramRequest(jobId, sceneId, requestId);
  if (session.fingerprint !== context.fingerprint) throw new Error("镜头上下文已改变，请重新发送指令");
  timer = setTimeout(() => {timedOut = true; controller.abort();}, settings.timeoutMs);
  const deadline = Date.now() + settings.timeoutMs;
  // 父进程失联与模型挂起也受硬超时保护，避免后台长期占用。
  const hardTimer = setTimeout(() => {diagnostics.category = "timeout"; void fail("Agent 执行超时，请重试").finally(() => process.exit(1));}, settings.timeoutMs + 5000);
  hardTimer.unref();
  process.once("SIGTERM", () => {controller.abort(); process.exit(0);});
  const budget = new DiagramSaveBudget(settings.maxSaves);
  let calls = 0, modelStreamStarted = false;
  let previousSaveErrors = new Set<string>();
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
    await mutateSession((latest) => ({...latest, diagnostics: {...diagnostics}, traceId: process.env.LANGSMITH_TRACING === "true" ? requestId : undefined, progress, messages: toolResult ? [...latest.messages.filter((item) => item.id !== id), {id, role: "tool" as const, text: toolResult}] : latest.messages}), true);
  };
  // 同一候选的保存、复查和收尾复用检查，截图与候选内容严格关联。
  let inspection: {key: string; report: DiagramInspection; screenshotPath: string} | undefined;
  let reviewedKey = "";
  const candidateKey = diagramCandidateHash;
  let checked: {key: string; report: DiagramValidationReport} | undefined;
  const checkCurrent = async () => {
    const candidate = await readDiagramCandidate(jobId, sceneId);
    if (!candidate) throw new DiagramExecutionError("尚未提交 SVG，请先保存图表");
    const key = candidateKey(candidate.data, candidate.loopEvidence);
    let report: DiagramValidationReport;
    try {
      report = checked?.key === key ? checked.report : await validateDiagramCandidate(candidate.data, {scene: context.scene, captions: context.captions, spokenText: context.scene.spokenText, safeArea: context.canvas.safeArea, loopEvidence: candidate.loopEvidence}, async () => {
        const screenshotPath = path.join(diagramDirectory(jobId, sceneId), `preview-${requestId}.png`);
        if (inspection?.key !== key) inspection = {key, report: await inspectDiagram(candidate.data, context.canvas.safeArea, screenshotPath), screenshotPath};
        return inspection.report;
      });
    } catch (error) {
      if (error instanceof DiagramInspectionError) {
        inspectionFailure = error;
        await assertDiagramRequest(jobId, sceneId, requestId);
        await writeDiagramCandidate(jobId, sceneId, {...candidate, valid: false, errors: [error.message]});
      }
      throw error;
    }
    await assertDiagramRequest(jobId, sceneId, requestId);
    const latest = await loadDiagramContext(jobId, sceneId);
    if (latest.context.fingerprint !== context.fingerprint || candidate.fingerprint !== context.fingerprint) throw new DiagramExecutionError("镜头上下文已变化，请重新制图");
    checked = {key, report}; diagnostics.candidateHash = key;
    await writeDiagramCandidate(jobId, sceneId, {...candidate, hash: key, valid: false, errors: report.errors, geometry: inspection?.key === key ? inspection.report.errors : [], validation: report});
    return {...compactDiagramReport(report, candidate.data), candidateHash: key};
  };
  const saveCandidate = async (data: DiagramData, loopEvidence?: string) => {
    // 安全检查和补丁解析失败不覆盖已有候选，也不会占用保存次数。
    const hash = candidateKey(data, loopEvidence);
    const current = await readDiagramCandidate(jobId, sceneId);
    let currentHash: string | undefined;
    try {currentHash = current ? candidateKey(current.data, current.loopEvidence) : undefined;}
    catch { /* 旧候选不安全时不复用校验，也不阻止提交新的安全内容。 */ }
    let changed: boolean;
    try {changed = budget.accept(hash, currentHash);}
    catch (error) {executionFailure = new DiagramExecutionError((error as Error).message); throw executionFailure;}
    diagnostics.saves = budget.attempts; diagnostics.candidateHash = hash; diagnostics.category = "validating";
    await assertDiagramRequest(jobId, sceneId, requestId);
    // 同内容跨请求仍需认领请求并重新检查，不能直接采用上次失败调用的结果。
    if (changed || current?.requestId !== requestId) {
      reviewedKey = "";
      await writeDiagramCandidate(jobId, sceneId, {data, loopEvidence, hash, fingerprint: context.fingerprint, requestId, valid: false, errors: ["待校验"]});
    }
    await update(changed ? `制图与修复 ${budget.attempts}/${settings.maxSaves}` : "内容未变化，复用校验结果");
    const report = await checkCurrent();
    const unchangedErrors = report.errors.filter((error) => previousSaveErrors.has(error));
    previousSaveErrors = new Set(report.errors);
    const feedback = {...report, duplicate: !changed, attempts: budget.attempts, remainingSaves: settings.maxSaves - budget.attempts, ...(unchangedErrors.length ? {unchangedErrors, repairInstruction: "相同问题仍未修复。请使用 patch_diagram，按 repairs.groupId 替换实际路径、调整文字或更新绑定；仅表达包含关系的多余连线应移除。不要重交整张未改变的 SVG。"} : {})};
    diagnostics.category = report.valid ? "validated" : "validation_failed";
    // 界面对话只保留简洁合法 JSON；完整诊断在 current.json，模型收到可执行修复数据。
    await update(report.valid ? "图表校验通过" : "校验失败，等待修复", JSON.stringify({valid: report.valid, errors: report.errors, candidateHash: hash, attempts: budget.attempts, remainingSaves: feedback.remainingSaves}));
    return feedback;
  };
  const tools = [
    // 模型只需要口播、布局和品牌，避免重复发送旧 templateData 与整份字幕时间。
    tool(async () => ({spokenText: context.scene.spokenText, title: context.scene.content.title, style: context.style, canvas: context.canvas, timing: context.timing}), {name: "get_scene_context", description: "读取本镜头口播、画布、视频风格及人物安全区，不返回字幕时间或旧模板数据。", schema: z.object({})}),
    tool(async ({groupIds}) => {
      const candidate = await readDiagramCandidate(jobId, sceneId);
      if (!candidate) return null;
      const hash = candidateKey(candidate.data, candidate.loopEvidence);
      if (!groupIds?.length) return {...candidate, hash, validation: undefined};
      const {doc} = parseDiagramSvg(candidate.data);
      const serializer = new XMLSerializer();
      return {hash, loopEvidence: candidate.loopEvidence, groups: groupIds.map((id) => ({groupId: id, svg: doc.getElementById(id) ? serializer.serializeToString(doc.getElementById(id)!) : null, binding: candidate.data.bindings.find((binding) => binding.groupId === id)}))};
    }, {name: "read_current_diagram", description: "读取当前图表及 hash；修复时用 groupIds 仅读取失败分组，避免重复读取完整 SVG。", schema: z.object({groupIds: z.array(z.string()).max(40).optional()})}),
    tool(async (input) => {
      const {loopEvidence, ...payload} = input;
      return saveCandidate(diagramDataSchema.parse(payload), loopEvidence);
    }, {name: "save_diagram", description: `保存当前 SVG 与口播绑定并执行安全、时间和浏览器几何校验。本轮最多 ${settings.maxSaves} 次保存（含首次），失败时按 repairs 与 unchangedErrors 修复。`, schema: diagramDataSchema.extend({loopEvidence: z.string().trim().min(1).max(500).optional().describe("仅 loop 必填：引用口播中明确返回前序步骤或重复执行的原文")})}),
    tool(async (input) => {
      const candidate = await readDiagramCandidate(jobId, sceneId);
      if (!candidate) throw new Error("尚无图表，请先 save_diagram");
      if (candidate.fingerprint !== context.fingerprint) throw new Error("候选上下文已过期，请用 save_diagram 重新制图");
      return saveCandidate(patchDiagram(candidate.data, candidate.loopEvidence, input), candidate.loopEvidence);
    }, {name: "patch_diagram", description: "优先用于修复：baseHash 使用最新 candidateHash/hash；replace_group 提交相同 ID 的单个完整 g；update_binding 只提交要改的字段；remove_group 同时清理 SVG、binding 和 after 引用。补丁原子应用并完整校验，与 save_diagram 共用保存预算。", schema: diagramPatchSchema}),
    tool(async () => {await update("校验当前 SVG 与绑定"); return checkCurrent();}, {name: "validate_diagram", description: "对当前图表重新执行白名单、依赖、口播和浏览器几何检查。", schema: z.object({})}),
    tool(async () => {
      const result = await checkCurrent();
      const candidate = await readDiagramCandidate(jobId, sceneId);
      const current = inspection && candidate && inspection.key === candidateKey(candidate.data, candidate.loopEvidence) ? inspection : undefined;
      if (result.valid && current) reviewedKey = current.key;
      const text = JSON.stringify({...result, screenshotPath: current?.screenshotPath, visualReview: settings.supportsVision ? "附图供视觉审核" : "文本模型仅收到几何报告，截图供人工查看，未完成模型看图审核"});
      if (!settings.supportsVision || !current) return [{type: "text" as const, text}];
      return [{type: "text" as const, text}, {type: "image_url" as const, image_url: {url: `data:image/png;base64,${(await fs.readFile(current.screenshotPath)).toString("base64")}`}}];
    }, {name: "inspect_diagram", description: "复查当前图表的文字、连接点和安全区，保存并返回预览截图位置；支持图像输入的模型还会收到截图。完成前必须调用。", schema: z.object({})}),
  ];
  const allowed = new Set(["get_scene_context", "read_current_diagram", "save_diagram", "patch_diagram", "validate_diagram", "inspect_diagram", "ls", "read_file", "glob", "grep", "write_todos"]);
  // 模型可并行调用工具；候选的读、改、校验共用队列，避免相同 baseHash 同时落盘。
  let candidateTasks = Promise.resolve();
  const candidateTools = new Set(["read_current_diagram", "save_diagram", "patch_diagram", "validate_diagram", "inspect_diagram"]);
  // 在执行边界阻止 shell、子 Agent 和所有通用写入工具，不能仅依赖提示词限制。
  const guard = createMiddleware({name: "DiagramBudgetAndIsolation", wrapToolCall: async (request, handler) => {
    await assertDiagramRequest(jobId, sceneId, requestId);
    if (inspectionFailure) throw inspectionFailure;
    if (executionFailure) throw executionFailure;
    if (modelFailure) throw modelFailure;
    if (controller.signal.aborted) throw new DiagramExecutionError("图表请求已取消或超时");
    diagnostics.calls = ++calls;
    if (calls > settings.maxSteps) {executionFailure = new DiagramExecutionError(`图表模型与工具调用达到 ${settings.maxSteps} 次预算，请缩小本轮修改范围或提高 diagramAgent.maxSteps`); throw executionFailure;}
    if (!allowed.has(request.toolCall.name)) throw new Error("首版仅支持读取 Skill 和专用图表工具，不开放 shell 或子 Agent");
    if (!candidateTools.has(request.toolCall.name)) return handler(request);
    const pending = candidateTasks.then(async () => {
      await assertDiagramRequest(jobId, sceneId, requestId);
      if (executionFailure) throw executionFailure;
      if (modelFailure) throw modelFailure;
      if (inspectionFailure) throw inspectionFailure;
      if (controller.signal.aborted) throw new DiagramExecutionError("图表请求已取消或超时");
      return handler(request);
    });
    candidateTasks = pending.then(() => undefined, () => undefined);
    return pending;
  }, wrapModelCall: async (request, handler) => {
    modelStreamStarted = false;
    try {return await retryDiagramModel(() => handler({...request, messages: currentDiagramTurn(request.messages), tools: request.tools.filter((item) => typeof item.name === "string" && allowed.has(item.name))}), {
      signal: controller.signal, deadline, hasStreamed: () => modelStreamStarted,
      assertActive: async () => {await assertDiagramRequest(jobId, sceneId, requestId);},
      onRetry: async () => {
        diagnostics.modelRetries++; diagnostics.calls = ++calls; diagnostics.category = "model_retry";
        if (calls > settings.maxSteps) {executionFailure = new DiagramExecutionError(`图表模型与工具调用达到 ${settings.maxSteps} 次预算`); throw executionFailure;}
        await update("模型连接暂时失败，正在重试本次模型调用（1/1）");
      },
    });} catch (error) {
      // 框架可能包装中间件异常；保存筛选后的模型停止原因，避免再次变成通用报错。
      if (error instanceof DiagramModelError) modelFailure = error;
      throw error;
    }
  }, beforeModel: async () => {
    await assertDiagramRequest(jobId, sceneId, requestId);
    if (inspectionFailure) throw inspectionFailure;
    if (executionFailure) throw executionFailure;
    if (modelFailure) throw modelFailure;
    if (controller.signal.aborted) throw new DiagramExecutionError("图表请求已取消或超时");
    diagnostics.calls = ++calls;
    if (calls > settings.maxSteps) {executionFailure = new DiagramExecutionError(`图表模型与工具调用达到 ${settings.maxSteps} 次预算，请缩小本轮修改范围或提高 diagramAgent.maxSteps`); throw executionFailure;}
    return undefined;
  }});
  saver = SqliteSaver.fromConnString(path.join(diagramDirectory(jobId, sceneId), "checkpoints.sqlite"));
  // 与主项目镜头规划保持一致，关闭 DeepSeek 思考模式，避免输出预算全部消耗在思考中。
  const model = new ChatOpenAI({model: settings.model, apiKey: settings.apiKey, configuration: {baseURL: settings.baseURL}, modelKwargs: {thinking: {type: "disabled"}}, temperature: 0.3, streaming: true, maxTokens: settings.maxTokens, maxRetries: 0, timeout: settings.timeoutMs,
    // 必须同步标记含工具参数的空文本片段，防止中断后误判为尚未开始流式输出。
    callbacks: [new DiagramStreamBoundary(() => {modelStreamStarted = true;})],
  });
  // 模型路由与保存工具枚举、资源预检共用目录；只发送所选类型的具体资料。
  const typeRouting = diagramTypeCatalog.map(({id, label, reference, example}) => `${id}（${label}） → ${diagramSkillVirtualPath}${reference}；${diagramSkillVirtualPath}${example}`).join("\n");
  const agent = await createDeepAgent({name: "we-video-diagram-agent", model, checkpointer: saver, backend, skills: [diagramSkillVirtualPath], subagents: [], permissions: [{operations: ["write"], paths: ["/**"], mode: "deny"}], tools, middleware: [guard], systemPrompt: `你是视频自动图表设计 Agent。先读取 /video-diagram-contract.md，再读取 /skills/diagram-design/SKILL.md，并按视频契约路由读取匹配的类型参考和一个静态示例；首次生成和后续修改都必须使用这些设计资料。不得委派、联网、执行 shell 或运行 HTML 控制器。
严格遵守视频适配契约。先 get_scene_context；修改已有图时先 read_current_diagram。本轮上下文是事实源，用户历史偏好按最新要求覆盖。
支持以下 45 种主类型，使用目录中的原始标识；根据语义选择一种，变体归属主类型，首次生成与修改都必须读取对应参考和示例：
${typeRouting}
先依据口播和上述目录确定主类型，最多读取两种候选的类型参考与示例作比较，选定后进入布局与保存，不要逐类遍历。语义地图表达定性接近关系而没有数值时使用概念区域或嵌套关系，不虚构散点坐标；所需数据缺失且无法忠实表达时说明缺少什么。
“先、再、接着、最后”优先 flowchart；“环环相扣”不构成 loop 依据。loop 必须提交 loopEvidence 引用明确返回或重复的口播。
只使用镜头上下文及用户指令提供的事实与数值。定量图缺少必要数据时说明缺少什么，不得编造数据、比例或精度。轴测图以静态 SVG 投影表达，不使用 3D 运行时。
安全区约束包含区域标题和标签的实际文字边界，text 的 y 是基线，顶部必须为字高预留空间。保存失败时用返回的 measurements、boundary、edgeEndpoints 和 safeArea 精确修正。区域包含已有节点时通常无需再画指向容器内部的箭头；确有有向关系时终点须接触目标主形状边界，修改依赖 ID 不能代替修改路径坐标。
SVG 只能包含 svg/g/defs/path/rect/circle/ellipse/line/polyline/polygon/text/tspan/linearGradient/radialGradient/stop/marker/clipPath/title/desc。viewBox="0 0 960 800"，使用本地 Studio Sans / Studio Serif，中文至少 12px。
每个可见元素归属 opening 或唯一绑定 g，分组不嵌套。每个绑定含 groupId、name、cueText、occurrence、after、kind。kind：node 为实体节点；edge 为有向边；region 为允许包含或重叠的区域；mark 为图表数据标记或投影；label 为独立文字；connector 为无向连接。edge 与 connector 的 after 均须包含两个不同的 node/region/mark 端点，触发词不得早于任何依赖；目标区域的讲述比连线更晚时，将连线触发词改为目标出现时或更后的原文，不删除真实依赖。节点文字在节点主形状内；图表外部标签用 label。有意重叠的区域或数据系列不可标为 node。最多 40 个绑定，按口播语义分组多枚数据标记。
先说明图型与布局，再 save_diagram，本轮最多 ${settings.maxSaves} 次真正修改（含首次）；save_diagram 和 patch_diagram 共用预算。修复优先 patch_diagram({baseHash: 最新 candidateHash, operations:[...]})，不要重发整张 SVG。replace_group 使用相同 ID 的单个完整 g；update_binding 只提交变化字段；remove_group 自动删除分组、binding 和其他 after 对它的引用。需要查看失败分组时用 read_current_diagram({groupIds:[...]})。重复提交不会扣保存预算，但仍消耗工具步数。
失败报告同时包含时间、语义和几何问题。先逐项处理 repairs 的 code 和 groupId：cue_before_dependency 使用报告中的两个 cue 位置调整触发词；text_overflow 按文字实测边界分行或扩大主框；edge_crosses_node 必须替换 path，绕开 obstructionBounds，不能将障碍加入 after。nearestBoundaryPoint 只是参考，不能把箭头接回源节点。包含关系无需额外连线时用 remove_group。unchangedErrors 表示上次修复未生效，必须实际修改相关路径或表达。remainingSaves、模型/工具步数和超时独立限制。最后调用 inspect_diagram 复查当前版本；有图像输入时检查截图，文本模式不得宣称已看图。检查器自身异常应停止，不能反复重画。失败如实说明，成功简短说明待预览。`});
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
  // 业务预算仍由上方 guard 严格限制，额外图步数仅供中间件调度使用。
  const runConfig = {configurable: {thread_id: session.threadId}, runId: randomUUID(), callbacks: await getLangchainCallbacks(), metadata: {jobId, sceneId, threadId: session.threadId, requestId}, recursionLimit: diagramGraphRecursionLimit(settings.maxSteps), signal: controller.signal};
  const stream = await agent.stream({messages: [{role: "user", content: userRequest} ]}, {...runConfig, streamMode: ["messages", "values"]});
  for await (const [mode, payload] of stream) {
    if (mode === "values") {result = payload as typeof result; await flushText(); continue;}
    const [chunk] = payload as unknown as [BaseMessage];
    const text = diagramAssistantText(chunk);
    if (!text) continue;
    const id = `${requestId}:assistant:${chunk.id ?? "current"}`;
    if (id !== messageId) {await flushText(); pendingText = ""; messageId = id;}
    pendingText += text;
    if (Date.now() - lastWrite >= 120) await flushText();
  }
  await flushText();
  if (executionFailure) throw executionFailure;
  if (modelFailure) throw modelFailure;
  // 截断响应不能视作正常完成，也不能用通用连接错误掩盖实际原因。
  const finalMessage = (result as unknown as {messages?: Array<{response_metadata?: {finish_reason?: string}}>}).messages?.at(-1);
  if (finalMessage?.response_metadata?.finish_reason === "length") throw new DiagramExecutionError(`模型输出达到 ${settings.maxTokens} token 上限，图表未完成，请重试或提高 diagramAgent.maxTokens`);
  await checkCurrent();
  const candidate = await readDiagramCandidate(jobId, sceneId);
  try {assertDiagramCandidateReady(candidate, {requestId, fingerprint: context.fingerprint, reviewedHash: reviewedKey, saves: budget.attempts, maxSaves: settings.maxSaves});}
  catch (error) {throw new DiagramExecutionError((error as Error).message);}
  await assertDiagramRequest(jobId, sceneId, requestId);
  await writeDiagramCandidate(jobId, sceneId, {...candidate, valid: true, errors: []});
  const latest = await assertDiagramRequest(jobId, sceneId, requestId);
  const lastMessage = result.messages?.at(-1);
  const answer = typeof lastMessage?.content === "string" ? lastMessage.content : "图表与口播绑定已通过校验，请预览后采用。";
  const finalId = lastMessage?.id ? `${requestId}:assistant:${lastMessage.id}` : messageId || `${requestId}:assistant`;
  diagnostics.category = "ready";
  const next = {...latest, diagnostics: {...diagnostics}, status: "ready" as const, progress: "等待预览和采用", messages: latest.messages.some((item) => item.id === finalId) ? latest.messages.map((item) => item.id === finalId ? {...item, text: answer.slice(0, 6000)} : item) : [...latest.messages, {id: finalId, role: "assistant" as const, text: answer.slice(0, 6000)}]};
  await writeDiagramSession(jobId, sceneId, next); await syncDiagramResource(jobId, sceneId, next);
  return {status: "ready", valid: true, requestId, review: settings.supportsVision ? "image" : "geometry", attempts: budget.attempts};
};
const fail = async (message: string) => {
  const session = await readDiagramSession(jobId, sceneId);
  if (session.requestId !== requestId || session.status !== "running") return;
  const candidate = await readDiagramCandidate(jobId, sceneId);
  // 停止原因与当前候选问题同时保留，避免旧几何错误掩盖超时、步数或保存预算。
  const candidateErrors = candidate?.requestId === requestId ? candidate.errors.filter((error) => error !== "待校验" && error !== message) : [];
  const error = [message, ...(candidateErrors.length ? [`当前候选未通过校验：${candidateErrors.join("；")}`] : [])].join("\n");
  const next = {...session, diagnostics: {...diagnostics}, status: "failed" as const, error, progress: "生成失败，文件已保留，可重试或继续对话"};
  await writeDiagramSession(jobId, sceneId, next); await syncDiagramResource(jobId, sceneId, next);
};
// 根追踪覆盖启动、Agent、最终检查及业务状态回写，失败时根调用也显示失败。
const traceClient = new Client();
const tracedRequest = traceable(async () => {
  try {return await main();}
  catch (error: unknown) {
    diagnostics.category = timedOut ? "timeout" : inspectionFailure ? "inspection_failed" : modelFailure?.category ?? (executionFailure ? "budget_exhausted" : error instanceof GraphRecursionError ? "graph_limit" : error instanceof DiagramExecutionError ? "validation_failed" : "execution_failed");
    // 仅公开已知执行故障，不把含请求配置的 SDK 原始异常写入界面或追踪。
    const message = timedOut ? "Agent 执行超时，请重试" : inspectionFailure?.message ?? executionFailure?.message ?? modelFailure?.message ?? (error instanceof DiagramExecutionError || error instanceof DiagramModelError ? error.message : error instanceof GraphRecursionError ? "图表内部执行步数达到上限，请缩小本轮修改范围后重试" : "Agent 运行失败，请检查模型连接、独立依赖和 diagram-design 安装后重试");
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
