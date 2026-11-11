import assert from "node:assert/strict";
import {AIMessage, AIMessageChunk, HumanMessage, ToolMessage} from "@langchain/core/messages";
import {currentDiagramTurn, diagramAssistantText, diagramUserRequest} from "./model-context";
import {diagramCompletionBody} from "./model-request";

// 裁剪必须保留本轮工具调用与结果配对，同时隔离旧 SVG 和失败反馈。
const latest = new HumanMessage("箭头看不出来");
const call = new AIMessage({content: "", tool_calls: [{id: "tool-1", name: "read_current_diagram", args: {}}]});
const result = new ToolMessage({tool_call_id: "tool-1", content: "current svg"});
assert.deepEqual(currentDiagramTurn([new HumanMessage("旧请求"), new AIMessage("old svg"), latest, call, result]), [latest, call, result]);
const request = diagramUserRequest({threadId: "test", status: "running", progress: "", messages: [{id: "1", role: "user", text: "所有步骤着色"}, {id: "2", role: "tool", text: "old svg"}, {id: "3", role: "user", text: "箭头看不出来"}]});
assert.match(request, /所有步骤着色/);
assert.match(request, /本次要求：箭头看不出来/);
assert(!request.includes("old svg"));
// 工具正文和用户输入不能伪装为助手消息；模型流只保留公开 text 块。
assert.equal(diagramAssistantText(result), "");
assert.equal(diagramAssistantText(latest), "");
assert.equal(diagramAssistantText(new AIMessageChunk({content: "选择嵌套图"})), "选择嵌套图");
assert.equal(diagramAssistantText(new AIMessage({content: [{type: "reasoning", text: "内部分析"}, {type: "text", text: "开始绘制"}]})), "开始绘制");
// 发送边界保留思考，截图在同批工具结果之后传递；原始消息不被改写。
const thought = new AIMessage({content: "", additional_kwargs: {reasoning_content: "本轮思考"}, tool_calls: [{id: "inspect-1", name: "inspect_diagram", args: {}}, {id: "inspect-2", name: "validate_diagram", args: {}}]});
const screenshotUrl = "data:image/png;base64,cHJldmlldw==";
const wire = {model: "deepseek-flash", messages: [
  {role: "user", content: "复查"},
  {role: "assistant", content: "", tool_calls: thought.tool_calls},
  {role: "tool", tool_call_id: "inspect-1", content: [{type: "text", text: "几何报告"}, {type: "image_url", image_url: {url: screenshotUrl}}]},
  {role: "tool", tool_call_id: "inspect-2", content: "校验通过"},
]};
const body = JSON.stringify(wire);
const adapted = JSON.parse(diagramCompletionBody(body, [new HumanMessage("复查"), thought]));
assert.equal(adapted.messages[1].reasoning_content, "本轮思考");
assert.deepEqual(adapted.messages.map((message: {role: string}) => message.role), ["user", "assistant", "tool", "tool", "user"]);
assert.equal(adapted.messages[2].content, "几何报告");
assert.equal(adapted.messages[2].tool_call_id, "inspect-1");
assert.equal(adapted.messages[3].tool_call_id, "inspect-2");
assert.equal(adapted.messages[4].content[1].image_url.url, screenshotUrl);
assert.equal(JSON.stringify(wire), body);
assert.equal(diagramAssistantText(thought), "");
console.log("图表模型上下文裁剪契约通过");
