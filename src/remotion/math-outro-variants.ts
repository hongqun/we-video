import {z} from "zod";

export const mathOutroVariantSchema = z.enum(["orbit-trace", "blueprint-grid", "particle-reconstruct"]);
export type MathOutroVariant = z.infer<typeof mathOutroVariantSchema>;

export const MATH_OUTRO_VARIANTS = [
  {id: "orbit-trace", label: "轨迹聚合", description: "抽象光轨绕 Logo 聚合，强调品牌连续性。"},
  {id: "blueprint-grid", label: "坐标蓝图", description: "网格、坐标轴和扫描线组成数学系统锁定。"},
  {id: "particle-reconstruct", label: "粒子重组", description: "固定粒子聚合成 Logo 光环，节奏更强。"},
] as const satisfies ReadonlyArray<{id: MathOutroVariant; label: string; description: string}>;

const MATH_OUTRO_BACKGROUNDS: Record<MathOutroVariant, string> = {
  "orbit-trace": "#F4F8F1",
  "blueprint-grid": "#081612",
  "particle-reconstruct": "#F4F8F1",
};

export const mathOutroBackground = (variant: MathOutroVariant) => MATH_OUTRO_BACKGROUNDS[variant];
