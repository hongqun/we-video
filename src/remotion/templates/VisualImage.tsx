import {Img, Interactive, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import {useEffect, useMemo, useState} from "react";
import type {Caption, VideoScene} from "../schema";
import {VIDEO_COLORS, VIDEO_RADIUS, VIDEO_SHADOW} from "../theme";
import {buildVisualImageSchedule, parseVisualImageData, type VisualImageRevealSegment} from "./visual-image";

const WRITER_SRC = staticFile("template-assets/visual-image/writer_1.svg");
const CONTENT_GRID_WIDTH = 96;
const CONTENT_GRID_HEIGHT = 54;
const CONTENT_ALPHA_THRESHOLD = 8;
const VISUAL_IMAGE_SCAN_OVERLAP_PX = 2;
type ContentGrid = {width: number; height: number; cells: Uint8Array};
type ContentBand = {segment: VisualImageRevealSegment; overlap: number};
const visualImageContentCache = new Map<string, Promise<ContentGrid>>();

const loadImageAlphaMask = (source: string, imageWidth: number, imageHeight: number) => {
  const key = `${source}:${imageWidth}x${imageHeight}`;
  const existing = visualImageContentCache.get(key);
  if (existing) return existing;
  const task = new Promise<ContentGrid>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (image.naturalWidth !== imageWidth || image.naturalHeight !== imageHeight) {
        reject(new Error(`visual-image 图片尺寸不一致：读取到 ${image.naturalWidth}×${image.naturalHeight}，声明为 ${imageWidth}×${imageHeight}`));
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = CONTENT_GRID_WIDTH;
      canvas.height = CONTENT_GRID_HEIGHT;
      const context = canvas.getContext("2d", {willReadFrequently: true});
      if (!context) { reject(new Error("visual-image 无法创建 Canvas 读取上下文")); return; }
      try {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const cells = new Uint8Array(CONTENT_GRID_WIDTH * CONTENT_GRID_HEIGHT);
        for (let index = 0; index < cells.length; index += 1) cells[index] = pixels[index * 4 + 3]! > CONTENT_ALPHA_THRESHOLD ? 1 : 0;
        resolve({width: CONTENT_GRID_WIDTH, height: CONTENT_GRID_HEIGHT, cells});
      } catch (error) { reject(new Error(`visual-image 无法读取图片 alpha：${error instanceof Error ? error.message : "未知错误"}`)); }
    };
    image.onerror = () => reject(new Error("visual-image 图片加载失败，无法读取透明内容"));
    image.src = source;
  });
  visualImageContentCache.set(key, task);
  return task;
};

const hasContent = (grid: ContentGrid, x: number, y: number, width: number, height: number) => {
  const left = Math.max(0, Math.floor(x * grid.width));
  const top = Math.max(0, Math.floor(y * grid.height));
  const right = Math.min(grid.width, Math.ceil((x + width) * grid.width));
  const bottom = Math.min(grid.height, Math.ceil((y + height) * grid.height));
  for (let row = top; row < bottom; row += 1) for (let column = left; column < right; column += 1) if (grid.cells[row * grid.width + column]) return true;
  return false;
};

const segmentProgressAt = (timeMs: number, segment: VisualImageRevealSegment) => {
  if (timeMs <= segment.startMs) return 0;
  if (timeMs >= segment.endMs) return 1;
  return (timeMs - segment.startMs) / (segment.endMs - segment.startMs);
};

const segmentGeometry = (segment: VisualImageRevealSegment, progress: number, imageWidth: number, imageHeight: number) => {
  const width = segment.width * imageWidth;
  const height = segment.height * imageHeight;
  const left = segment.x * imageWidth;
  const top = segment.y * imageHeight;
  return {
    x: segment.reverse ? left + width * (1 - progress) : left,
    y: top + height / 2,
    width: width * progress,
    height,
    penX: segment.reverse ? left + width * (1 - progress) : left + width * progress,
  };
};

/** 栅格配图按口播框逐带涌现；所有状态由当前帧计算，跳帧与离线渲染结果一致。 */
export const VisualImage: React.FC<{scene: VideoScene; captions: Caption[]}> = ({scene, captions}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const data = parseVisualImageData(scene, scene.templateData);
  const schedule = buildVisualImageSchedule({scene, captions, data});
  const absoluteTimeMs = scene.startMs + frame / fps * 1000;
  // 规划预览使用当前任务的 /api 附件地址；它和 http/data 一样不能再经过 staticFile 拼接。
  const source = /^(?:https?:\/\/|data:|\/)/u.test(data.imagePath) ? data.imagePath : staticFile(data.imagePath);
  const [contentGrid, setContentGrid] = useState<ContentGrid | null>(null);
  const [contentError, setContentError] = useState<Error | null>(null);
  const [contentRenderHandle] = useState(() => delayRender("visual-image alpha content analysis"));
  useEffect(() => {
    void loadImageAlphaMask(source, data.imageWidth, data.imageHeight).then((grid) => { setContentGrid(grid); continueRender(contentRenderHandle); }).catch((error: unknown) => { const cause = error instanceof Error ? error : new Error("visual-image 透明内容分析失败"); setContentError(cause); continueRender(contentRenderHandle); });
    return () => undefined;
  }, [contentRenderHandle, data.imageHeight, data.imageWidth, source]);
  const contentBands = useMemo<ContentBand[]>(() => contentGrid ? schedule.cues.flatMap((cue) => {
    const bands = cue.revealSegments.filter((segment) => hasContent(contentGrid, segment.x, segment.y, segment.width, segment.height));
    // 透明通道采样不稳定时不能吞掉整组扫描带，否则最后一个多边形会无动画地消失。
    const visibleBands = bands.length ? bands : cue.revealSegments;
    // 每个多边形的第一条保持原尺寸，只让同一多边形内的后续条带向上叠加。
    return visibleBands.map((segment, index) => ({segment, overlap: index === 0 ? 0 : Math.min(VISUAL_IMAGE_SCAN_OVERLAP_PX, segment.y * data.imageHeight)}));
  }) : [], [contentGrid, data.imageHeight, schedule.cues]);
  const activeBand = contentBands.find(({segment}) => absoluteTimeMs >= segment.startMs && absoluteTimeMs < segment.endMs);
  const activeSegment = activeBand?.segment;
  const activeProgress = activeSegment ? segmentProgressAt(absoluteTimeMs, activeSegment) : 0;
  const pen = activeSegment ? segmentGeometry(activeSegment, activeProgress, data.imageWidth, data.imageHeight) : null;
  const hasRevealBands = contentGrid !== null && !contentError && contentBands.length > 0;
  // 仅换外围描边色与硬阴影，保留边框厚度、内距和揭示坐标。
  return <Interactive.Div name="Visual requirement image" style={{alignItems: "center", backgroundColor: "transparent", border: `2px solid ${VIDEO_COLORS.line}`, borderRadius: VIDEO_RADIUS.feature, boxShadow: VIDEO_SHADOW.card, display: "flex", height: 700, justifyContent: "center", overflow: "hidden", padding: 22, position: "relative", width: "100%"}}>
    <Interactive.Div name="Visual image drawing canvas" style={{aspectRatio: `${data.imageWidth} / ${data.imageHeight}`, height: "100%", maxWidth: "100%", overflow: "hidden", position: "relative"}}>
      {!hasRevealBands ? <Img name="Complete visual image" src={source} style={{height: "100%", left: 0, position: "absolute", top: 0, width: "100%"}} /> : null}
      {hasRevealBands ? contentBands.map(({segment, overlap}, segmentIndex) => {
        const progress = segmentProgressAt(absoluteTimeMs, segment);
        const geometry = segmentGeometry(segment, progress, data.imageWidth, data.imageHeight);
        const segmentTop = segment.y * data.imageHeight;
        // 每条扫描带使用普通 Img 的矩形裁剪，避免 SVG mask 在离线渲染中丢失透明 PNG。
        const maskY = Math.max(0, segmentTop - overlap);
        const maskBottom = Math.min(data.imageHeight, segmentTop + geometry.height);
        const right = Math.max(0, data.imageWidth - geometry.x - geometry.width);
        return <Img
          key={`${segment.startMs}-${segmentIndex}`}
          name="Revealed visual image band"
          src={source}
          style={{clipPath: `inset(${maskY / data.imageHeight * 100}% ${right / data.imageWidth * 100}% ${(data.imageHeight - maskBottom) / data.imageHeight * 100}% ${geometry.x / data.imageWidth * 100}%)`, height: "100%", left: 0, position: "absolute", top: 0, width: "100%"}}
        />;
      }) : null}
      {activeSegment && pen ? <Img
        name="Handwriting pen"
        src={WRITER_SRC}
        style={{height: "13%", left: `${pen.penX / data.imageWidth * 100}%`, opacity: Math.max(0, Math.min(1, activeProgress * 8, (1 - activeProgress) * 8)), position: "absolute", top: `${pen.y / data.imageHeight * 100}%`, translate: "-12% -88%", width: "13%"}}
      /> : null}
    </Interactive.Div>
  </Interactive.Div>;
};
