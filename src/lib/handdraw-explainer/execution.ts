import {ExplainerMediaError} from "./bailian";

// 终止状态由程序持有，框架即使把工具异常转成消息，也不能继续调模型或付费工具。
export class ExplainerExecutionGuard {
  private failure?: ExplainerMediaError;
  stop(message: string): never {
    this.failure ??= new ExplainerMediaError(message);
    throw this.failure;
  }
  assertRunning() {
    if (this.failure) throw this.failure;
  }
}
