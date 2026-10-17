import path from "node:path";
import {constants, promises as fs} from "node:fs";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {bundle} from "@remotion/bundler";
import {ensureBrowser, renderMedia, selectComposition} from "@remotion/renderer";
import {atomicWriteJson, jobDir, normalizeArtifactManifest, readJob, readJson, resolveManifestAssets} from "../lib/jobs";
import {createRenderArtifactToken} from "../lib/render-access";
import {REMOTION_ENTRY, REMOTION_PUBLIC_DIR} from "../lib/paths";
import {artifactManifestSchema, type RenderManifest} from "../remotion/schema";
import {resolveManifestMedia} from "../lib/manifest-media";
import {assertNarrationFrameCoverage, narrationSceneFrameSpans} from "../remotion/timeline";
import {getTemplateStatus} from "../remotion/templates/registry";
import {formatFrameCorruptions, inspectRenderedFrameIntegrity, renderBrowserConfig, modelRenderGl} from "../lib/render-integrity";
import {buildVisualImageSchedule} from "../remotion/templates/visual-image";
import {resolveModelSceneSchedule} from "../remotion/templates/model-scene-timing";

const VISUAL_IMAGE_WRITER = path.join(REMOTION_PUBLIC_DIR, "template-assets", "visual-image", "writer_1.svg");

const execFileAsync = promisify(execFile);

const assertRenderPreflight = async (manifest: RenderManifest) => {
  const narrationFrames = Math.ceil(manifest.narration.durationMs / 1000 * manifest.video.fps);
  const spans = narrationSceneFrameSpans(manifest.scenes, manifest.narration.durationMs, manifest.video.fps);
  assertNarrationFrameCoverage(spans, narrationFrames);
  await Promise.all(manifest.scenes.map(async (scene) => {
    if (!getTemplateStatus(scene).usable) throw new Error(`渲染前检查失败：${scene.id} 的模板不可用`);
    if (scene.templateId === "rve/visual-image") {
      // 渲染前复用确认阶段的严格调度校验，禁止失配图片静默降级。
      buildVisualImageSchedule({scene, captions: manifest.captions, data: scene.templateData});
      await fs.access(VISUAL_IMAGE_WRITER).catch(() => { throw new Error("渲染前检查失败：visual-image 缺少手写笔资源 writer_1.svg"); });
    }
    if (scene.templateId === "rve/3d-model-scene") {
      const schedule = resolveModelSceneSchedule(scene, manifest.captions, scene.templateData, manifest.video.fps);
      const modelPath = schedule.data.modelPath.replace(/^artifact:\/\//u, "");
      if (!modelPath.startsWith("uploaded-models/") || modelPath.includes("..")) throw new Error(`渲染前检查失败：${scene.id} 的模型路径无效`);
      await fs.access(path.join(jobDir(manifest.jobId), modelPath)).catch(() => { throw new Error(`渲染前检查失败：${scene.id} 的 GLB 文件不存在`); });
    }
  }));
};

const assertRenderedMedia = async (file: string, expected: {width: number; height: number; fps: number; durationInFrames: number}) => {
  const {stdout} = await execFileAsync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], {maxBuffer: 2_000_000});
  const media = JSON.parse(stdout) as {
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      pix_fmt?: string;
      duration?: string;
      nb_frames?: string;
    }>;
    format?: {duration?: string};
  };
  const video = media.streams?.find((stream) => stream.codec_type === "video");
  const audio = media.streams?.find((stream) => stream.codec_type === "audio");
  if (!video || !audio) throw new Error("渲染后检查失败：成片必须同时包含音频流和视频流");
  if (video.width !== expected.width || video.height !== expected.height) throw new Error(`渲染后检查失败：尺寸为 ${video.width}×${video.height}`);
  // 交付统一使用标准 4:2:0 像素格式，减少不同平台播放器的色彩和硬解兼容差异。
  if (video.pix_fmt !== "yuv420p") throw new Error(`渲染后检查失败：像素格式为 ${video.pix_fmt}`);
  const [rateNumerator, rateDenominator] = (video.avg_frame_rate ?? "0/1").split("/").map(Number);
  const fps = rateDenominator ? rateNumerator / rateDenominator : 0;
  if (Math.abs(fps - expected.fps) > 0.01) throw new Error(`渲染后检查失败：FPS 为 ${fps}`);
  const actualFrames = Number(video.nb_frames);
  if (Number.isFinite(actualFrames) && actualFrames > 0 && actualFrames !== expected.durationInFrames) {
    throw new Error(`渲染后检查失败：视频帧数 ${actualFrames}，预期 ${expected.durationInFrames}`);
  }
  // 优先读取视频流时长；容器总时长可能包含 AAC 编码填充，不能作为帧时间轴的唯一依据。
  const actualDuration = Number(video.duration ?? media.format?.duration ?? 0);
  const expectedDuration = expected.durationInFrames / expected.fps;
  if (!Number.isFinite(actualDuration) || Math.abs(actualDuration - expectedDuration) > 1 / expected.fps + 0.02) throw new Error(`渲染后检查失败：总时长 ${actualDuration}s，预期 ${expectedDuration}s`);
};

const [manifestPath, origin] = process.argv.slice(2);
if (!manifestPath || !origin) {
  throw new Error("用法：npm run render:job -- <manifest.json> <base-url>");
}

const resolveBrowserConfig = async () => {
  const config = renderBrowserConfig(process.env.REMOTION_BROWSER_EXECUTABLE);
  if (config.browserExecutable) {
    await fs.access(config.browserExecutable, constants.X_OK).catch(() => {
      throw new Error(`自定义 Remotion 浏览器不可执行：${config.browserExecutable}`);
    });
    return config;
  }
  // 服务启动后的首次任务也要确保固定版本浏览器已就绪，避免回退到系统完整 Chrome。
  const status = await ensureBrowser({chromeMode: config.chromeMode});
  if (status.type === "no-browser") throw new Error("Remotion Chrome Headless Shell 未安装");
  return config;
};

const main = async () => {
  const resolvedManifestPath = path.resolve(manifestPath);
  const rawManifest = await readJson<unknown>(resolvedManifestPath);
  const normalizedManifest = normalizeArtifactManifest(rawManifest);
  let manifest = artifactManifestSchema.parse(normalizedManifest);
  if (manifest.contentMode !== "math") {
    manifest = await resolveManifestMedia(manifest, jobDir(manifest.jobId));
    await assertRenderPreflight(manifest);
  }
  const props = resolveManifestAssets(
    manifest,
    origin,
    createRenderArtifactToken(manifest.jobId),
  );
  const directory = jobDir(manifest.jobId);
  const has3dScene = manifest.contentMode !== "math" && manifest.scenes.some((scene) => scene.templateId === "rve/3d-model-scene");
  let chromiumOptions: {gl: ReturnType<typeof modelRenderGl>} | undefined;
  const outputLocation = path.join(directory, "output.mp4");
  const renderAttemptId = `${process.pid}-${Date.now()}`;
  const temporaryOutputLocations = [1, 2].map((attempt) => path.join(
    directory,
    `.output-${renderAttemptId}-attempt-${attempt}.tmp.mp4`,
  ));
  const jobPath = path.join(directory, "job.json");
  let lastProgress = -1;
  let progressWrites = Promise.resolve();
  const updateProgress = (percent: number, force = false) => {
    const monotonicPercent = Math.max(lastProgress, Math.min(99, percent));
    if (!force && monotonicPercent < lastProgress + 2) return;
    lastProgress = monotonicPercent;
    progressWrites = progressWrites.then(async () => {
      const job = await readJob(manifest.jobId);
      await atomicWriteJson(jobPath, {
        ...job,
        state: "rendering",
        renderProgress: monotonicPercent,
        updatedAt: new Date().toISOString(),
      });
    });
  };
  try {
    chromiumOptions = has3dScene ? {gl: modelRenderGl(process.env.REMOTION_3D_GL)} : undefined;
    if (chromiumOptions) console.info(`[3D render] GL=${chromiumOptions.gl}, concurrency=1`);
    const browserConfig = await resolveBrowserConfig();
    const serveUrl = await bundle({entryPoint: REMOTION_ENTRY, publicDir: REMOTION_PUBLIC_DIR});
    const composition = await selectComposition({
      serveUrl,
      id: "contentMode" in manifest && manifest.contentMode === "math" ? "TechMathVideo" : "TechShortVideo",
      inputProps: props,
      browserExecutable: browserConfig.browserExecutable,
      chromeMode: browserConfig.chromeMode,
      chromiumOptions,
      timeoutInMilliseconds: 60_000,
    });
    const renderAttempt = async (attempt: 1 | 2, concurrency: "50%" | 1) => {
      const output = temporaryOutputLocations[attempt - 1]!;
      const progressStart = attempt === 1 ? 0 : 85;
      const progressEnd = attempt === 1 ? 80 : 99;
      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        audioCodec: "aac",
        pixelFormat: "yuv420p",
        outputLocation: output,
        inputProps: props,
        browserExecutable: browserConfig.browserExecutable,
        chromeMode: browserConfig.chromeMode,
        chromiumOptions,
        concurrency: has3dScene ? 1 : concurrency,
        timeoutInMilliseconds: 60_000,
        // PNG 中间帧消除 JPEG 块效应；最终仍由 Remotion 编码为标准 H.264 成片。
        imageFormat: "png",
        colorSpace: "bt709",
        onProgress: ({progress}) => updateProgress(Math.floor(progressStart + progress * (progressEnd - progressStart))),
      });
      await progressWrites;
      const renderedOutput = await fs.stat(output);
      if (!renderedOutput.isFile() || renderedOutput.size === 0) throw new Error("渲染输出为空，未发布成片");
      await assertRenderedMedia(output, {width: composition.width, height: composition.height, fps: composition.fps, durationInFrames: composition.durationInFrames});
      const corruptions = manifest.contentMode === "math" ? [] : await inspectRenderedFrameIntegrity(output);
      return {output, corruptions};
    };

    let accepted = await renderAttempt(1, browserConfig.concurrency);
    updateProgress(85, true);
    await progressWrites;
    if (accepted.corruptions.length) {
      process.stderr.write(`首轮成片检测到异常帧：${formatFrameCorruptions(accepted.corruptions)}；改用单线程重渲染。\n`);
      await fs.unlink(accepted.output).catch(() => undefined);
      accepted = await renderAttempt(2, 1);
      if (accepted.corruptions.length) {
        throw new Error(`渲染后检查失败：单线程成片仍包含异常帧 ${formatFrameCorruptions(accepted.corruptions)}`);
      }
    }
    await fs.rename(accepted.output, outputLocation);
    const job = await readJob(manifest.jobId);
    await atomicWriteJson(jobPath, {
      ...job,
      state: "completed",
      error: null,
      renderProgress: 100,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    await Promise.all(temporaryOutputLocations.map((file) => fs.unlink(file).catch(() => undefined)));
    const job = await readJob(manifest.jobId);
    await atomicWriteJson(jobPath, {
      ...job,
      state: "failed",
      error: `${has3dScene ? `[3D GL=${chromiumOptions?.gl ?? "配置校验失败"}] ` : ""}${error instanceof Error ? error.message : "渲染失败"}`,
      updatedAt: new Date().toISOString(),
    });
    throw error;
  }
};

void main();
