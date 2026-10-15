export type TemplateAdapterFamily = "text" | "chart" | "background" | "generic";

// Keep server-side template validation independent from React and Remotion.
export const ADAPTED_TEMPLATE_IDS = new Set([
  // 当前 tech-minute 用例的唯一 RVE 白名单；开场/结尾由 Presenter 模板独立注册。
  "text-reveal", "text-highlight", "visual-image",
]);

export const TEMPLATE_ADAPTER_FAMILY: Record<string, TemplateAdapterFamily> = {
  "text-reveal": "text", "text-highlight": "text",
};
