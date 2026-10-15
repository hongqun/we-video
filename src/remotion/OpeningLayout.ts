import type {CSSProperties} from "react";

// 封面与开场共用编辑分栏坐标，人物切场时只换内容，不改变头部和手势的构图基准。
export const OPENING_TITLE_LEFT = 80;
export const OPENING_TITLE_TOP = 154;
export const OPENING_TITLE_WIDTH = 700;
export const OPENING_TITLE_HEIGHT = 248;
export const OPENING_SUMMARY_LEFT = 80;
export const OPENING_SUMMARY_TOP = 510;
export const OPENING_SUMMARY_WIDTH = 420;
// 人物向上收拢并扩大近景，让封面与场景一的视觉重心落在标题和人物之间。
export const OPENING_PRESENTER_BOX = {left: 548, top: 330, width: 508, height: 684};
export const openingPresenterImageStyle = (poseId: string): CSSProperties => {
  const wideGesture = /(?:left|right|two-hands)/u.test(poseId);
  const width = wideGesture ? 134 : 146;
  return {position: "absolute", width: `${width}%`, height: "auto", left: `${(100 - width) / 2}%`, top: 0, objectFit: "contain", objectPosition: "top center"};
};
// 只转换用户显式写入的换行，不擅自拆分正文，保证场景 1 的口播文字按原文连续显示。
export const openingBodyText = (text: string, protectedWords: string[] = []) => {
  const value = text.replaceAll("\\n", "\n");
  // 保留参数以兼容已有调用方；重点词绑定由 OpeningEmphasis 独立处理。
  void protectedWords;
  return value;
};
