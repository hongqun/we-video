import path from "node:path";
import {promises as fs} from "node:fs";
import {randomUUID} from "node:crypto";
import {config as loadEnv} from "dotenv";
import {createDeepAgent, CompositeBackend, FilesystemBackend} from "deepagents";
import {ChatOpenAI} from "@langchain/openai";
import {tool} from "@langchain/core/tools";
import {awaitAllCallbacks} from "@langchain/core/callbacks/promises";
import {traceable} from "langsmith/traceable";
import {Client} from "langsmith";
import {getLangchainCallbacks} from "langsmith/langchain";
import {createMiddleware} from "langchain";
import {z} from "zod";
import {BailianDrawingClient, ExplainerMediaError, ExplainerReviewError} from "../../../src/lib/handdraw-explainer/bailian";
import {artworkInputSchema, createExplainerArtwork, listExplainerAttempts, resumeExplainerArtwork, reviewExistingArtwork} from "../../../src/lib/handdraw-explainer/artwork";
import {ExplainerExecutionGuard} from "../../../src/lib/handdraw-explainer/execution";
import {loadExplainerContext} from "../../../src/lib/handdraw-explainer/context";
import {compileExplainer, explainerAsset, verifyExplainerArtifacts, ExplainerCompilationError} from "../../../src/lib/handdraw-explainer/compiler";
import {explainerSettings} from "../../../src/lib/handdraw-explainer/settings";
import {mutateExplainerRequest, publishExplainerCandidate} from "../../../src/lib/handdraw-explainer/service";
import {assertExplainerRequest, readExplainerArtworks, readExplainerCandidate, withExplainerLock, writeExplainerCandidate} from "../../../src/lib/handdraw-explainer/store";
import {explainerDesignSchema} from "../../../src/remotion/templates/handdraw-explainer-schema";

// 进程从项目根目录启动，所有连接继承根 .env，不创建包级配置。
loadEnv({path: path.join(process.cwd(), ".env"), quiet: true});
const [jobId, sceneId, requestId] = process.argv.slice(2);
if (!jobId || !sceneId || !requestId) throw new Error("worker 需要 jobId、sceneId、requestId");
const controller = new AbortController();
let timer: ReturnType<typeof setTimeout> | undefined;
let hardTimer: ReturnType<typeof setTimeout> | undefined;
let timedOut = false;
process.once("SIGTERM", () => controller.abort());
class ReadOnlySkill extends FilesystemBackend {
  override async write() {return {error: "Skill 只读，请使用镜头制作工具"};}
  override async edit() {return {error: "Skill 只读"};}
  override async delete() {return {error: "Skill 只读"};}
  override async uploadFiles(files: Array<[string, Uint8Array]>) {return files.map(([filePath]) => ({path: filePath, error: "permission_denied" as const}));}
}
const progress = (text: string) => mutateExplainerRequest(jobId, sceneId, requestId, (session) => ({...session, progress: text, messages: [...session.messages, {id: randomUUID(), role: "tool", text}]}));
const fail = async (message: string) => {
  await mutateExplainerRequest(jobId, sceneId, requestId, (session) => ({...session, status: "failed", progress: "制作未完成，已保留素材，可重试或继续对话", error: message})).catch(() => undefined);
};

const main = async () => {
  for (let i = 0; i < 100; i++) {if ((await assertExplainerRequest(jobId, sceneId, requestId)).pid === process.pid) break; await new Promise((resolve) => setTimeout(resolve, 50));}
  const {context, profile} = await loadExplainerContext(jobId, sceneId);
  const session = await assertExplainerRequest(jobId, sceneId, requestId);
  if (session.fingerprint !== context.fingerprint) throw new ExplainerMediaError("镜头上下文已变化，请重新发送指令");
  const settings = await explainerSettings(profile, true);
  if (!settings.enabled) throw new ExplainerMediaError("手绘讲解 Agent 未启用");
  timer = setTimeout(() => {timedOut = true; controller.abort();}, settings.timeoutMs);
  hardTimer = setTimeout(() => {void fail("手绘讲解制作超时，已完成素材已保留").finally(() => process.exit(1));}, settings.timeoutMs + 10000);
  hardTimer.unref();
  const execution = new ExplainerExecutionGuard();
  // 百炼工具内部调用单独显示模型名称；闭包不上传图片、密钥或签名下载地址。
  const client = new class extends BailianDrawingClient {
    override async generate(model: string, prompt: string, signal: AbortSignal, reference?: Buffer) {
      return traceable(() => super.generate(model, prompt, signal, reference), {client: traceClient, name: reference ? "bailian-color" : "bailian-line", run_type: "llm", metadata: {ls_provider: "bailian", ls_model_name: model, jobId, sceneId, requestId}, processOutputs: () => ({format: "png"})})();
    }
    override async review(model: string, prompt: string, images: Buffer[], signal: AbortSignal) {
      return traceable(() => super.review(model, prompt, images, signal), {client: traceClient, name: "bailian-vision-review", run_type: "llm", metadata: {ls_provider: "bailian", ls_model_name: model, jobId, sceneId, requestId}})();
    }
  }(settings.bailian);
  let generationCount = 0;
  let compileCount = 0;
  let resumeCount = 0;
  let firstToolFailure = "";
  let lastToolFailure = "";
  // 可修正的业务问题同时反馈给模型和网页，不把 SDK 或文件系统原始异常写入对话。
  const sceneTool = async <T>(action: () => Promise<T>): Promise<T | {error: string}> => {
    execution.assertRunning();
    try {return await action();}
    catch (error) {
      if (controller.signal.aborted) throw new ExplainerMediaError("手绘请求已取消或超时");
      lastToolFailure = error instanceof ExplainerMediaError || error instanceof ExplainerCompilationError ? error.message : error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join("；") : "制作步骤失败，请检查素材和预处理环境后重试";
      firstToolFailure ||= lastToolFailure;
      await progress(`制作步骤未通过：${lastToolFailure}`);
      if (error instanceof ExplainerReviewError) execution.stop(lastToolFailure);
      execution.assertRunning();
      return {error: lastToolFailure};
    }
  };
  const tools = [
    tool(async () => ({...context, artworks: await readExplainerArtworks(jobId, sceneId), attempts: await listExplainerAttempts(jobId, context), currentDesign: (await readExplainerCandidate(jobId, sceneId))?.design}), {name: "get_scene_context", description: "读取当前口播、真实时间范围、主题、安全区、已有插画、可复用线稿及方案。", schema: z.object({})}),
    tool(async (input) => sceneTool(async () => {
      if (++generationCount > settings.maxArtworks) execution.stop(`本轮已用完 ${settings.maxArtworks} 次新图预算；首个问题：${firstToolFailure || "无"}。请复用已保存素材或停止生成`);
      return createExplainerArtwork(jobId, context, requestId, input, settings, client, controller.signal, progress);
    }), {name: "create_artwork", description: "按简报生成线稿，检查预算和视觉，再以上传线稿为输入上色并复核。返回实际部位框；失败保留已有素材。", schema: artworkInputSchema}),
    tool(async ({version}) => sceneTool(async () => {
      if (++resumeCount > 4) execution.stop(`本轮恢复已达四次；首个问题：${firstToolFailure || "无"}。请停止重试并说明问题`);
      return resumeExplainerArtwork(jobId, context, requestId, version, settings, client, controller.signal, progress);
    }), {name: "resume_artwork", description: "优先继续 attempts 中 canResume=true 的版本。有彩图时只重试视觉复核，无彩图时继续上色；不重新生成线稿，不占新图预算。", schema: z.object({version: z.string().uuid()})}),
    tool(async ({id}) => sceneTool(() => reviewExistingArtwork(jobId, context, requestId, id, settings, client, controller.signal)), {name: "review_artwork", description: "按当前口播与风格重新复核既有插画，再决定是否复用。", schema: z.object({id: z.string()})}),
    tool(async ({design}) => sceneTool(async () => {
      if (++compileCount > 5) execution.stop("本轮已达到五次编译预算，请说明尚未解决的问题");
      await progress("编译部位、手写文字与口播窗口");
      const output = await compileExplainer(jobId, context, design, await readExplainerArtworks(jobId, sceneId), requestId, controller.signal);
      await publishExplainerCandidate(jobId, sceneId, requestId, context.fingerprint, output.design, output.data);
      return {cacheKey: output.data.cacheKey, schedule: output.data.layers.map(({id, startFrame, endFrame}) => ({id, startFrame, endFrame})), notes: output.notes, next: "调用 inspect_scene 复核这份完整成图"};
    }), {name: "compile_scene", description: "把已审核插画、部位和短语绑定编译为 Remotion 绘制数据。严格校验路径时长、阅读窗口、素材配准、布局和文字。", schema: z.object({design: explainerDesignSchema})}),
    tool(async () => sceneTool(async () => {
      const candidate = await readExplainerCandidate(jobId, sceneId);
      if (!candidate || candidate.requestId !== requestId) throw new ExplainerMediaError("本轮尚无编译完成的候选");
      const data = await verifyExplainerArtifacts(jobId, candidate.data);
      await progress("视觉复核完整成图与文字布局");
      const bytes = await fs.readFile(await explainerAsset(jobId, data.completePath));
      const review = await client.review(settings.visionModel, `这是手绘讲解镜头最终完成图。检查主体是否可识别、画面能否解释口播、正式文字是否完整清晰、插画与标签是否遮挡、构图是否符合主题和安全区。只检查实际图片，不声称已看动画或听音。口播：${context.scene.spokenText}；主题与安全区：${JSON.stringify({style: context.style, canvas: context.canvas})}；设计：${JSON.stringify(candidate.design)}`, [bytes], controller.signal);
      await withExplainerLock(jobId, sceneId, async () => {
        await assertExplainerRequest(jobId, sceneId, requestId);
        const latest = await readExplainerCandidate(jobId, sceneId);
        if (!latest || latest.data.cacheKey !== data.cacheKey || latest.requestId !== requestId) throw new ExplainerMediaError("候选已变化，请重新复核");
        await writeExplainerCandidate(jobId, sceneId, {...latest, review: {cacheKey: data.cacheKey, pass: review.pass && !review.issues.length, evidence: review.evidence, issues: review.issues}});
      });
      return review;
    }), {name: "inspect_scene", description: "调用百炼视觉模型复核当前候选的完整成图，记录与候选哈希匹配的复核结果。", schema: z.object({})}),
  ];
  const allowed = new Set(["ls", "read_file", "glob", "grep", "write_todos", ...tools.map((item) => item.name)]);
  let calls = 0;
  let toolQueue = Promise.resolve();
  const guard = createMiddleware({name: "HanddrawSceneBoundary", beforeModel: async () => {
    execution.assertRunning();
    await assertExplainerRequest(jobId, sceneId, requestId);
    if (controller.signal.aborted) throw new ExplainerMediaError("手绘请求已取消或超时");
    if (++calls > settings.maxSteps) throw new ExplainerMediaError("手绘讲解达到本轮执行预算，请缩小修改范围后重试");
  }, wrapToolCall: async (request, handler) => {
    execution.assertRunning();
    if (!allowed.has(request.toolCall.name)) throw new ExplainerMediaError("仅开放只读 Skill 和镜头制作工具");
    if (++calls > settings.maxSteps) throw new ExplainerMediaError("手绘讲解达到本轮执行预算");
    // 框架可并行发起工具调用，串行队列确保编译不会抢在生图、复核之前执行。
    const pending = toolQueue.then(async () => {execution.assertRunning(); await assertExplainerRequest(jobId, sceneId, requestId); if (controller.signal.aborted) throw new ExplainerMediaError("手绘请求已取消或超时"); return handler(request);});
    toolQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }, wrapModelCall: (request, handler) => handler({...request, tools: request.tools.filter((item) => typeof item.name === "string" && allowed.has(item.name))})});
  const skill = path.join(process.cwd(), "packages/handdraw-agent/skills/we-video-handdraw");
  const backend = new CompositeBackend(new ReadOnlySkill({rootDir: skill, virtualMode: true}), {"/skills/we-video-handdraw/": new ReadOnlySkill({rootDir: skill, virtualMode: true})});
  const model = new ChatOpenAI({model: settings.text.model, apiKey: settings.text.apiKey, configuration: {baseURL: settings.text.baseURL}, modelKwargs: {thinking: {type: "disabled"}}, temperature: .3, maxTokens: 12000, maxRetries: 0, timeout: settings.timeoutMs});
  const agent = await createDeepAgent({name: "we-video-handdraw-agent", model, backend, skills: ["/skills/we-video-handdraw/"], subagents: [], permissions: [{operations: ["write"], paths: ["/**"], mode: "deny"}], tools, middleware: [guard], systemPrompt: "你是 We-Video 手绘讲解镜头设计 Agent。首先完整读取 /skills/we-video-handdraw/SKILL.md，再按需读取其 references。Skill 是制作规范，当前工具上下文是事实来源。使用实际口播和已审核插画设计成图，再安排笔画与文字。不要生成 MP4，不改音频、字幕、源码或镜头边界。首次制作和后续修改都应使用 Skill；完成本轮编译后必须 inspect_scene。所有正式文字由本地笔画绘制。只调用提供的专用工具和只读资料工具，不执行 shell、不委派。"});
  await progress("读取内置 Skill 并设计当前镜头");
  const users = session.messages.filter((item) => item.role === "user");
  const request = `最近要求（按时间排列，最新优先）：\n${users.slice(-7).map((item) => item.text.slice(0, 8000)).join("\n")}\n先读取当前上下文与已有素材。有 canResume=true 且 hasColor=true 的失败版本时，优先 resume_artwork，只重试复核，不要重新生图。完成本轮修改后编译和复核。`;
  const result = await agent.invoke({messages: [{role: "user", content: request}]}, {signal: controller.signal, callbacks: await getLangchainCallbacks(), metadata: {jobId, sceneId, requestId}, recursionLimit: settings.maxSteps * 6 + 12}).catch((error: unknown) => {execution.assertRunning(); throw error;});
  execution.assertRunning();
  const candidate = await readExplainerCandidate(jobId, sceneId);
  if (!candidate || candidate.requestId !== requestId || !candidate.review?.pass || candidate.review.cacheKey !== candidate.data.cacheKey) throw new ExplainerMediaError(firstToolFailure || lastToolFailure || candidate?.review?.issues.join("；") || "本轮未完成编译或视觉复核，请根据保留的素材继续修改");
  await verifyExplainerArtifacts(jobId, candidate.data);
  const latest = await loadExplainerContext(jobId, sceneId);
  if (latest.context.fingerprint !== context.fingerprint) throw new ExplainerMediaError("口播、音频或布局已变化，请重新制作");
  const last = result.messages.at(-1);
  const answer = typeof last?.content === "string" ? last.content.slice(0, 6000) : "已编译并复核完成图，请带声预览后采用。";
  await mutateExplainerRequest(jobId, sceneId, requestId, (state) => ({...state, status: "ready", progress: "制作完成，等待带声预览和采用", error: undefined, messages: [...state.messages, {id: randomUUID(), role: "assistant", text: answer}]}));
};

// 根追踪涵盖工具业务失败和最终校验，避免 trace 显示成功而网页已经失败。
const traceClient = new Client();
const tracedRequest = traceable(async () => {
  try {await main();}
  catch (error: unknown) {
    const message = timedOut ? "手绘讲解制作超时，已完成素材已保留" : error instanceof ExplainerMediaError || error instanceof ExplainerCompilationError ? error.message : "手绘讲解未完成，请检查模型连接、独立依赖和预处理环境后重试";
    await fail(message);
    throw new ExplainerMediaError(message);
  }
}, {client: traceClient, id: requestId, name: "handdraw-request", metadata: {jobId, sceneId, requestId, thread_id: `${jobId}:${sceneId}`}});
tracedRequest().catch(() => {process.exitCode = 1;}).finally(async () => {
  if (timer) clearTimeout(timer);
  if (hardTimer) clearTimeout(hardTimer);
  await awaitAllCallbacks();
  await traceClient.awaitPendingTraceBatches().catch(() => undefined);
});
