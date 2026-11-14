import {z} from "zod";
import {ToolInputParsingException} from "@langchain/core/tools";
import {DiagramSvgError} from "../../../src/remotion/templates/auto-diagram-schema";

// 只将已知的模型输入问题作为可修正反馈；磁盘、检查器和网络异常不吞掉。
export const diagramInputFeedback = (error: unknown) => {
  if (error instanceof DiagramSvgError) {
    const instruction = /不允许的 SVG 标签：pattern/u.test(error.message)
      ? "删除 pattern 定义及其 url(#...) 引用；背景改用 opening 内的纯色 rect，必要网格改用少量 line/path。重新提交完整安全 SVG，不要通过换属性绕过白名单。"
      : /候选已变化/u.test(error.message)
        ? "先 read_current_diagram 获取最新 hash 和相关分组，再提交补丁；不要覆盖更新后的候选。"
        : "根据具体错误修正 SVG、分组或本地资源引用；不要放宽白名单。未成功保存过时重新 save_diagram，已有安全候选时按最新 hash 修复。";
    return {valid: false as const, recoverable: true as const, candidateUnchanged: true as const, errors: [error.message.slice(0, 1500)], repairs: [{code: "svg_input_invalid", instruction}]};
  }
  if (error instanceof z.ZodError) {
    const errors = error.issues.slice(0, 12).map((issue) => `${issue.path.join(".") || "参数"}：${issue.message}`);
    return {valid: false as const, recoverable: true as const, candidateUnchanged: true as const, errors, repairs: [{code: "input_schema_invalid", instruction: "按工具参数契约修正字段、图型标识和绑定；输入校验失败没有修改候选，也没有占用保存次数。"}]};
  }
  // SDK 可能先于工具函数校验参数；异常正文含完整输入，不能直接回显。
  if (error instanceof ToolInputParsingException) return {valid: false as const, recoverable: true as const, candidateUnchanged: true as const, errors: ["工具参数不符合契约，请检查 type、svg、bindings 或补丁字段"], repairs: [{code: "input_schema_invalid", instruction: "对照当前工具参数 schema 修正后重新调用；未执行保存，不要把 SVG 写进普通对话当作已保存结果。"}]};
  return undefined;
};
