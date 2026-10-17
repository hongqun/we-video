import {execFile} from "node:child_process";
import {promisify} from "node:util";

const execFileAsync = promisify(execFile);

export const FRAME_DIFFERENCE_THRESHOLD = 10;
export const MAX_CORRUPTION_SPAN_FRAMES = 3;

export type FrameDifference = {
  frame: number;
  ptsTime: number;
  yAverage: number;
};

export type FrameCorruption = {
  startFrame: number;
  endFrame: number;
  startTimeMs: number;
  endTimeMs: number;
  entryDifference: number;
  exitDifference: number;
};

export type RenderBrowserConfig = {
  browserExecutable: string | null;
  chromeMode: "headless-shell";
  concurrency: "50%" | 1;
  customBrowser: boolean;
};

/** 默认使用 Remotion 固定版本的 Headless Shell；自定义浏览器只允许单线程渲染。 */
export const renderBrowserConfig = (configuredExecutable: string | undefined): RenderBrowserConfig => {
  const browserExecutable = configuredExecutable?.trim() || null;
  return {
    browserExecutable,
    chromeMode: "headless-shell",
    concurrency: browserExecutable ? 1 : "50%",
    customBrowser: Boolean(browserExecutable),
  };
};

// 同时传给 composition 查询与实际渲染，拒绝拼错的后端配置。
export const modelRenderGl = (configured: string | undefined) => {
  const supported = ["angle", "egl", "swiftshader", "swangle", "vulkan", "angle-egl"] as const;
  const value = configured?.trim() || "swangle";
  const backend = supported.find((item) => item === value);
  if (!backend) throw new Error(`REMOTION_3D_GL 无效：${value}；可选 ${supported.join(", ")}`);
  return backend;
};

/** 解析 FFmpeg metadata=print 输出，只保留逐帧平均亮度差。 */
export const parseFrameDifferences = (metadata: string): FrameDifference[] => {
  const differences: FrameDifference[] = [];
  let current: Omit<FrameDifference, "yAverage"> | null = null;
  for (const line of metadata.split(/\r?\n/)) {
    const frameMatch = line.match(/^frame:\s*(\d+).*pts_time:\s*([\d.]+)/);
    if (frameMatch) {
      current = {frame: Number(frameMatch[1]), ptsTime: Number(frameMatch[2])};
      continue;
    }
    const averageMatch = line.match(/^lavfi\.signalstats\.YAVG=([\d.eE+-]+)/);
    if (!current || !averageMatch) continue;
    const yAverage = Number(averageMatch[1]);
    if (Number.isFinite(current.frame) && Number.isFinite(current.ptsTime) && Number.isFinite(yAverage)) {
      differences.push({...current, yAverage});
    }
    current = null;
  }
  return differences;
};

/**
 * 单个坏帧会在进入和离开时各产生一次高差异；正常硬切通常只有一次。
 * 允许两次高差异间隔最多 3 帧，也能拦截短暂连续的合成表面错切。
 */
export const detectFrameCorruptions = (
  differences: FrameDifference[],
  threshold = FRAME_DIFFERENCE_THRESHOLD,
  maxSpanFrames = MAX_CORRUPTION_SPAN_FRAMES,
): FrameCorruption[] => {
  const corruptions: FrameCorruption[] = [];
  let index = 0;
  while (index < differences.length) {
    const entry = differences[index];
    if (!entry || entry.yAverage < threshold) {
      index += 1;
      continue;
    }
    let exitIndex = index + 1;
    while (exitIndex < differences.length) {
      const exit = differences[exitIndex];
      if (!exit || exit.frame - entry.frame > maxSpanFrames) break;
      if (exit.yAverage >= threshold) {
        corruptions.push({
          startFrame: entry.frame,
          endFrame: Math.max(entry.frame, exit.frame - 1),
          startTimeMs: Math.round(entry.ptsTime * 1000),
          endTimeMs: Math.round(exit.ptsTime * 1000),
          entryDifference: entry.yAverage,
          exitDifference: exit.yAverage,
        });
        index = exitIndex + 1;
        break;
      }
      exitIndex += 1;
    }
    if (exitIndex >= differences.length || differences[exitIndex]?.frame - entry.frame > maxSpanFrames) index += 1;
  }
  return corruptions;
};

/** 解码成片并扫描孤立或短时的全帧合成异常；不依赖播放器是否恰好显示坏帧。 */
export const inspectRenderedFrameIntegrity = async (file: string): Promise<FrameCorruption[]> => {
  const {stdout} = await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel", "error",
    "-i", file,
    "-vf", "tblend=all_mode=difference,signalstats,metadata=print:file=-",
    "-an",
    "-f", "null",
    "-",
  ], {maxBuffer: 20_000_000});
  return detectFrameCorruptions(parseFrameDifferences(stdout));
};

export const formatFrameCorruptions = (corruptions: FrameCorruption[]) => corruptions
  .map((item) => `${(item.startTimeMs / 1000).toFixed(2)} 秒（帧 ${item.startFrame}–${item.endFrame}）`)
  .join("、");
