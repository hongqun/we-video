import path from "node:path";

// 拆分后应用、配置、品牌资料与默认运行数据都以 Video 项目根目录为基准。
export const PLATFORM_ROOT = process.cwd();
export const REPO_ROOT = process.cwd();
export const DATA_ROOT = process.env.TALK_VIDEO_DATA_DIR
  ? path.resolve(process.env.TALK_VIDEO_DATA_DIR)
  : REPO_ROOT;
export const JOBS_ROOT = path.join(DATA_ROOT, "jobs");
export const DRAFT_ROOT = path.join(DATA_ROOT, "draft");
export const REMOTION_ENTRY = path.join(process.cwd(), "src", "remotion", "index.ts");
export const REMOTION_PUBLIC_DIR = path.join(process.cwd(), "public");
