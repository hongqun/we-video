import {setTimeout as delay} from "node:timers/promises";
import type {LLMResult} from "@langchain/core/outputs";
import {BaseCallbackHandler} from "@langchain/core/callbacks/base";

// SDK 有时只把结束原因放在 generationInfo，不能只检查最终消息的 response_metadata。
export const diagramOutputWasTruncated = (output: LLMResult) => output.generations.some((batch) => batch.some((generation) => {
  const message = "message" in generation ? generation.message as {response_metadata?: {finish_reason?: unknown}} : undefined;
  return generation.generationInfo?.finish_reason === "length" || message?.response_metadata?.finish_reason === "length";
}));

// 在 SDK 分发每个片段时同步标记，包含只有工具参数而没有公开文字的片段。
export class DiagramStreamBoundary extends BaseCallbackHandler {
  name = "DiagramStreamBoundary";
  constructor(private readonly mark: () => void, private readonly finish?: (output: LLMResult) => void) {super({_awaitHandler: true});}
  handleLLMNewToken(token: string) {void token; this.mark();}
  handleLLMEnd(output: LLMResult) {this.finish?.(output);}
}

export class DiagramModelError extends Error {
  constructor(readonly category: "model_connection" | "model_rate_limit" | "model_server" | "model_stream_interrupted" | "model_deadline" | "model_output_limit", maxTokens?: number) {
    const messages = {
      model_connection: "模型连接失败，有限重试后仍未恢复；候选已保留，请稍后重试",
      model_rate_limit: "模型请求被限流，有限重试后仍未恢复；请稍后重试",
      model_server: "模型服务暂时不可用，有限重试后仍未恢复；请稍后重试",
      model_stream_interrupted: "模型输出流中断；未执行未完成的工具，候选已保留，请重试",
      model_deadline: "图表请求已取消或达到执行时限，候选已保留",
      model_output_limit: `模型输出达到 ${maxTokens ?? "配置的"} token 上限，图表未完成；请降低 diagramAgent.reasoningEffort、简化图表或提高 maxTokens，已完成候选保留`,
    };
    super(messages[category]);
  }
}

// 仅检查固定字段，不将 SDK 异常、URL、请求配置或响应体写入业务诊断。
export const diagramTransientFailure = (error: unknown): "model_connection" | "model_rate_limit" | "model_server" | undefined => {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const value = current as {status?: unknown; name?: unknown; code?: unknown; message?: unknown; cause?: unknown};
    const status = Number(value.status);
    if (status === 429) return "model_rate_limit";
    if (status >= 500 && status <= 599) return "model_server";
    // 鉴权、参数和权限错误即使携带连接类 cause 也不重试。
    if (status >= 400 && status <= 499) return undefined;
    if (["APIConnectionError", "APIConnectionTimeoutError"].includes(String(value.name)) || ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_SOCKET"].includes(String(value.code)) || value.message === "Connection error.") return "model_connection";
    current = value.cause;
  }
  return undefined;
};

type RetryOptions = {
  signal: AbortSignal; deadline: number; hasStreamed: () => boolean;
  assertActive: () => Promise<void>; onRetry: () => Promise<void>;
};

// 只重试本次模型调用，绝不重放图或已执行工具；收到任何流片段后立即放弃重试。
export const retryDiagramModel = async <T>(invoke: () => T | Promise<T>, options: RetryOptions): Promise<T> => {
  for (let attempt = 0; ; attempt++) {
    await options.assertActive();
    if (options.signal.aborted || Date.now() >= options.deadline) throw new DiagramModelError("model_deadline");
    try {return await invoke();}
    catch (error) {
      if (options.signal.aborted || Date.now() >= options.deadline) throw new DiagramModelError("model_deadline");
      // 截断属于确定的停止原因，不得被流中断分类覆盖，也不自动重新付费调用。
      if (error instanceof DiagramModelError) throw error;
      const category = diagramTransientFailure(error);
      if (options.hasStreamed()) throw new DiagramModelError("model_stream_interrupted");
      if (!category) throw error;
      if (attempt || Date.now() + 500 >= options.deadline) throw new DiagramModelError(category);
      await options.assertActive();
      await options.onRetry();
      try {await delay(500, undefined, {signal: options.signal});}
      catch {throw new DiagramModelError("model_deadline");}
    }
  }
};
