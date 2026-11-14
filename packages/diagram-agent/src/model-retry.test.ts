import assert from "node:assert/strict";
import {test} from "node:test";
import {DiagramModelError, DiagramStreamBoundary, diagramOutputWasTruncated, diagramTransientFailure, retryDiagramModel} from "./model-retry";

// 全部使用本地假调用，验证连接恢复不会重新执行模型调用之前已完成的工具。
test("连接恢复只重试当前模型，保留已经完成的工具结果", async () => {
  let tools = 0, calls = 0, retries = 0;
  const saved = {hash: "candidate-1", saves: ++tools};
  const result = await retryDiagramModel(async () => {
    if (++calls === 1) throw Object.assign(new Error("Connection error."), {name: "APIConnectionError"});
    return saved;
  }, {signal: new AbortController().signal, deadline: Date.now() + 5000, hasStreamed: () => false, assertActive: async () => {}, onRetry: async () => {retries++;}});
  assert.equal(result, saved); assert.equal(tools, 1); assert.equal(calls, 2); assert.equal(retries, 1);
});

test("限流和服务错误各自最多重试一次并保留明确类别", async () => {
  for (const [status, category] of [[429, "model_rate_limit"], [503, "model_server"]] as const) {
    let calls = 0, retries = 0;
    await assert.rejects(retryDiagramModel(() => {calls++; throw {status};}, {
      signal: new AbortController().signal, deadline: Date.now() + 5000, hasStreamed: () => false,
      assertActive: async () => {}, onRetry: async () => {retries++;},
    }), (error: unknown) => error instanceof DiagramModelError && error.category === category);
    assert.equal(calls, 2); assert.equal(retries, 1);
  }
});

test("鉴权和未知错误不重试、不暴露 SDK 请求信息", async () => {
  const error = {status: 401, cause: {code: "ECONNRESET"}, request: {headers: {authorization: "private"}}};
  assert.equal(diagramTransientFailure(error), undefined);
  assert.equal(diagramTransientFailure(new Error("unknown")), undefined);
  assert.equal(diagramTransientFailure({cause: {code: "ECONNRESET"}}), "model_connection");
  let calls = 0;
  await assert.rejects(retryDiagramModel(() => {calls++; throw error;}, {
    signal: new AbortController().signal, deadline: Date.now() + 5000, hasStreamed: () => false,
    assertActive: async () => {}, onRetry: async () => {assert.fail("鉴权错误不能重试");},
  }), (actual: unknown) => actual === error);
  assert.equal(calls, 1);
  assert(!new DiagramModelError("model_connection").message.includes("private"));
});

test("收到文字或只有工具参数的流片段后中断都不能重试", async () => {
  // SDK 对纯工具片段也分发空 token；同步回调必须先标记边界。
  for (const token of ["开始绘制", ""]) {
    let streamed = false, calls = 0;
    const boundary = new DiagramStreamBoundary(() => {streamed = true;});
    await assert.rejects(retryDiagramModel(() => {
      calls++; boundary.handleLLMNewToken(token);
      throw {status: 503};
    }, {signal: new AbortController().signal, deadline: Date.now() + 5000, hasStreamed: () => streamed,
      assertActive: async () => {}, onRetry: async () => {assert.fail("不能重放中断流");},
    }), (error: unknown) => error instanceof DiagramModelError && error.category === "model_stream_interrupted");
    assert.equal(calls, 1);
  }
});

test("取消、原始截止时间和过期请求均阻止后续模型调用", async () => {
  const controller = new AbortController(); controller.abort();
  for (const [signal, deadline] of [[controller.signal, Date.now() + 5000], [new AbortController().signal, Date.now() - 1]] as const) {
    await assert.rejects(retryDiagramModel(() => {assert.fail("不应调用模型");}, {
      signal, deadline, hasStreamed: () => false, assertActive: async () => {}, onRetry: async () => {},
    }), (error: unknown) => error instanceof DiagramModelError && error.category === "model_deadline");
  }
  let calls = 0, checks = 0;
  await assert.rejects(retryDiagramModel(() => {calls++; throw {code: "ECONNRESET"};}, {
    signal: new AbortController().signal, deadline: Date.now() + 5000, hasStreamed: () => false,
    assertActive: async () => {if (++checks > 1) throw new Error("请求已过期");}, onRetry: async () => {assert.fail("过期请求不能重试");},
  }), /请求已过期/);
  assert.equal(calls, 1);
});

test("重试等待中的取消和不足的剩余时间不发第二次请求", async () => {
  for (const cancel of [true, false]) {
    const controller = new AbortController(); let calls = 0, retries = 0;
    await assert.rejects(retryDiagramModel(() => {calls++; throw {code: "ECONNRESET"};}, {
      signal: controller.signal, deadline: Date.now() + (cancel ? 5000 : 100), hasStreamed: () => false,
      assertActive: async () => {}, onRetry: async () => {retries++; controller.abort();},
    }), (error: unknown) => error instanceof DiagramModelError && error.category === (cancel ? "model_deadline" : "model_connection"));
    assert.equal(calls, 1); assert.equal(retries, cancel ? 1 : 0);
  }
});

// 复现只在 generationInfo 中返回 length、正文为空的实际失败响应。
test("SDK 结束回调捕获纯思考截断，不依赖最终消息元数据", () => {
  const output = {generations: [[{text: "", generationInfo: {finish_reason: "length"}}]]};
  assert.equal(diagramOutputWasTruncated(output), true);
  assert.equal(diagramOutputWasTruncated({generations: [[{text: "", generationInfo: {finish_reason: "tool_calls"}}]]}), false);
  let failure: DiagramModelError | undefined;
  const boundary = new DiagramStreamBoundary(() => {}, (result) => {
    if (diagramOutputWasTruncated(result)) failure = new DiagramModelError("model_output_limit", 12000);
  });
  boundary.handleLLMEnd(output);
  assert.equal(failure?.category, "model_output_limit");
  assert.match(failure!.message, /12000/u);
  assert.match(failure!.message, /reasoningEffort/u);
});
test("截断不被包装成流中断，也不自动重试模型", async () => {
  const failure = new DiagramModelError("model_output_limit", 12000);
  let calls = 0;
  await assert.rejects(retryDiagramModel(() => {calls++; throw failure;}, {
    signal: new AbortController().signal, deadline: Date.now() + 10000, hasStreamed: () => true,
    assertActive: async () => {}, onRetry: async () => assert.fail("截断不能自动重新请求"),
  }), (error: unknown) => error === failure);
  assert.equal(calls, 1);
});
