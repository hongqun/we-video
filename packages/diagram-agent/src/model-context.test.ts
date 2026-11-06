import assert from "node:assert/strict";
import {AIMessage, HumanMessage, ToolMessage} from "@langchain/core/messages";
import {currentDiagramTurn, diagramUserRequest} from "./model-context";

// 裁剪必须保留本轮工具调用与结果配对，同时隔离旧 SVG 和失败反馈。
const latest = new HumanMessage("箭头看不出来");
const call = new AIMessage({content: "", tool_calls: [{id: "tool-1", name: "read_current_diagram", args: {}}]});
const result = new ToolMessage({tool_call_id: "tool-1", content: "current svg"});
assert.deepEqual(currentDiagramTurn([new HumanMessage("旧请求"), new AIMessage("old svg"), latest, call, result]), [latest, call, result]);
const request = diagramUserRequest({threadId: "test", status: "running", progress: "", messages: [{id: "1", role: "user", text: "所有步骤着色"}, {id: "2", role: "tool", text: "old svg"}, {id: "3", role: "user", text: "箭头看不出来"}]});
assert.match(request, /所有步骤着色/);
assert.match(request, /本次要求：箭头看不出来/);
assert(!request.includes("old svg"));
console.log("图表模型上下文裁剪契约通过");
