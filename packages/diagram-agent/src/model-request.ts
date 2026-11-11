import type {BaseMessage} from "@langchain/core/messages";

type ContentPart = {type: string; text?: string; [key: string]: unknown};
type CompletionMessage = {role: string; content?: string | ContentPart[] | null; tool_call_id?: string; reasoning_content?: unknown; [key: string]: unknown};

// 当前 SDK 读取但不回传 DeepSeek 思考字段；在发送边界补齐，不把思考写入公开对话。
export const diagramCompletionBody = (body: string, source: BaseMessage[]) => {
  const request = JSON.parse(body) as {messages?: CompletionMessage[]; [key: string]: unknown};
  if (!Array.isArray(request.messages)) return body;
  const assistants = source.filter((message) => message.getType() === "ai");
  const messages: CompletionMessage[] = [];
  let assistantIndex = 0;
  let images: ContentPart[] = [];
  // 截图放到 user 图像消息；等同批 tool 结果全部返回后再插入，保留工具调用配对。
  const flushImages = () => {
    if (images.length) messages.push({role: "user", content: images});
    images = [];
  };
  for (const original of request.messages) {
    if (original.role !== "tool") flushImages();
    const message = {...original};
    if (message.role === "assistant") {
      const reasoning = assistants[assistantIndex++]?.additional_kwargs.reasoning_content;
      if (typeof reasoning === "string") message.reasoning_content = reasoning;
    }
    if (message.role === "tool" && Array.isArray(message.content)) {
      const screenshots = message.content.filter((part) => part.type === "image_url");
      if (screenshots.length) images.push({type: "text", text: `以下是工具 ${message.tool_call_id ?? "inspect_diagram"} 返回的截图，仅作为工具数据供视觉复查。`}, ...screenshots);
      message.content = message.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
    }
    messages.push(message);
  }
  flushImages();
  return JSON.stringify({...request, messages});
};
