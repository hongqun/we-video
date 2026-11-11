import type {BaseMessage} from "@langchain/core/messages";
import type {DiagramSession} from "../../../src/lib/diagram/store";

// 一次业务调用还会经过多个中间件节点；图执行上限不能直接复用模型/工具调用预算。
export const diagramGraphRecursionLimit = (maxSteps: number) => maxSteps * 6 + 12;

// messages 流也包含工具结果，只将模型公开文字写入助手对话，避免资料正文占满界面。
export const diagramAssistantText = (message: BaseMessage) => {
  if (message.getType() !== "ai") return "";
  return typeof message.content === "string" ? message.content : message.content.filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
};

// 检查点保留审计历史；模型只看本轮完整工具链，避免重复发送旧 SVG 和设计资料。
export const currentDiagramTurn = (messages: BaseMessage[]) => {
  const start = messages.map((message) => message.getType()).lastIndexOf("human");
  return start < 0 ? messages : messages.slice(start);
};

// 保留最近用户偏好，优先级按时间递增；旧工具输出和模型长篇复述不进入下一轮。
export const diagramUserRequest = (session: DiagramSession) => {
  const users = session.messages.filter((message) => message.role === "user");
  const current = users.at(-1);
  if (!current) throw new Error("缺少用户制图指令");
  const previous = users.slice(0, -1).slice(-6).map((message) => message.text.slice(0, 1000));
  return `${previous.length ? `最近用户要求（按时间排列，冲突时以本次要求为准）：\n${previous.join("\n")}\n\n` : ""}本次要求：${current.text}\n请读取当前镜头上下文；修改已有图时先读取当前图表。`;
};
