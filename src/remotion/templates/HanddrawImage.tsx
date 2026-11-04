import {useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {cancelRender, continueRender, delayRender, Img, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import type {VideoScene} from "../schema";
import {handdrawDataSchema, handdrawMotionSchema, handdrawPenAt, handdrawTiming, handdrawPlaybackTrack, handdrawSourceTimeAt, handdrawLiftMs, type HanddrawData, type HanddrawMotion} from "./handdraw-schema";
import {decodeHanddrawTimes, paintHanddrawPixels} from "./handdraw-pixels";

const sourceUrl = (value: string) => /^(?:https?:\/\/|data:|\/)/u.test(value) ? value : staticFile(value);
type Pixels = {line: Uint8ClampedArray; color: Uint8ClampedArray; lineTimes: Uint32Array; colorTimes: Uint32Array; motion: HanddrawMotion};
const cache = new Map<string, Promise<Pixels>>();
const loadPixels = (source: string, width: number, height: number) => new Promise<Uint8ClampedArray>((resolve, reject) => {
  const image = new Image(); image.crossOrigin = "anonymous";
  image.onload = () => {
    try {
      if (image.naturalWidth !== width || image.naturalHeight !== height) throw new Error("手绘产物尺寸不匹配，请重新处理");
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d", {willReadFrequently: true});
      if (!context) throw new Error("无法创建手绘画布");
      context.drawImage(image, 0, 0);
      resolve(context.getImageData(0, 0, width, height).data);
    } catch (error) { reject(error); }
  };
  image.onerror = () => reject(new Error("手绘产物加载失败")); image.src = sourceUrl(source);
});
const load = (data: HanddrawData) => {
  const key = JSON.stringify(data);
  const existing = cache.get(key); if (existing) return existing;
  const task = Promise.all([
    ...[data.lineLayerPath, data.colorLayerPath, data.lineTimePath, data.colorTimePath].map((source) => loadPixels(source, data.width, data.height)),
    fetch(sourceUrl(data.motionPath)).then(async (response) => { if (!response.ok) throw new Error("手绘运动计划加载失败"); return handdrawMotionSchema.parse(await response.json()); }),
  ]).then(([line, color, lineTime, colorTime, motion]) => {
    const plan = motion as HanddrawMotion;
    if (plan.cacheKey !== data.cacheKey || plan.width !== data.width || plan.height !== data.height || plan.minimumDrawMs !== data.minimumDrawMs) throw new Error("手绘运动计划与素材不一致");
    if (data.motionTiming && Math.abs(handdrawLiftMs(plan) - data.motionTiming.liftMs) > .01) throw new Error("手绘抬笔统计与运动计划不一致");
    for (let i = 1; i < plan.points.length; i++) if (plan.points[i]![0] < plan.points[i - 1]![0]) throw new Error("手绘运动计划时间无效");
    return {line: line as Uint8ClampedArray, color: color as Uint8ClampedArray, lineTimes: decodeHanddrawTimes(lineTime as Uint8ClampedArray), colorTimes: decodeHanddrawTimes(colorTime as Uint8ClampedArray), motion: plan};
  });
  cache.set(key, task);
  // 最多保留少量镜头，避免切换长片时一直累积全分辨率像素。
  if (cache.size > 4) cache.delete(cache.keys().next().value!);
  void task.catch(() => cache.delete(key));
  return task;
};

/** 当前帧直接重建白纸、颜色、墨线；不依赖上一帧的 Canvas 状态。 */
export const HanddrawImage: React.FC<{scene: VideoScene}> = ({scene}) => {
  const data = useMemo(() => handdrawDataSchema.parse(scene.templateData), [scene.templateData]);
  const frame = useCurrentFrame(); const {fps} = useVideoConfig();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [assets, setAssets] = useState<Pixels | null>(null);
  // 旧缓存缺少统计时直接从运动计划补算，无需重新分析图片。
  const motionTiming = useMemo(() => assets ? {liftMs: handdrawLiftMs(assets.motion)} : data.motionTiming, [assets, data.motionTiming]);
  const timing = handdrawTiming(scene, {...data, motionTiming});
  const track = useMemo(() => assets ? handdrawPlaybackTrack(assets.motion, {liftScale: timing.liftScale, speed: timing.speed}) : null, [assets, timing.liftScale, timing.speed]);
  const time = track ? handdrawSourceTimeAt(track, frame / fps * 1000 - timing.drawStartMs) : -1;
  const [handle] = useState(() => delayRender("手绘图层与时间图加载"));
  useEffect(() => {
    let active = true;
    void load(data).then((value) => { if (active) setAssets(value); }).catch((error: unknown) => { if (active) cancelRender(error instanceof Error ? error : new Error(String(error))); });
    return () => { active = false; continueRender(handle); };
  }, [data, handle]);
  useLayoutEffect(() => {
    if (!assets || !canvas.current) return;
    const drawing = delayRender("手绘当前帧绘制");
    try {
      const context = canvas.current.getContext("2d"); if (!context) throw new Error("手绘 Canvas 不可用");
      const output = context.createImageData(data.width, data.height);
      paintHanddrawPixels(assets, time, output.data);
      context.putImageData(output, 0, 0);
      continueRender(handle);
    } catch (error) { cancelRender(error instanceof Error ? error : new Error(String(error))); }
    finally { continueRender(drawing); }
  }, [assets, data.height, data.width, handle, time]);
  const pen = assets ? handdrawPenAt(assets.motion, time) : null;
  return <div style={{width: "100%", height: 700, display: "flex", alignItems: "center", justifyContent: "center", background: "white", overflow: "hidden"}}>
    {/* 用同一等比容器放置画布和笔尖，横图与竖图都不挤压素材或改变锚点。 */}
    <div style={{aspectRatio: `${data.width}/${data.height}`, width: `min(100%, ${700 * data.width / data.height}px)`, position: "relative", flexShrink: 0}}>
      <canvas ref={canvas} width={data.width} height={data.height} style={{width: "100%", height: "auto", display: "block"}} />
      {pen ? <Img src={staticFile("template-assets/visual-image/writer_1.svg")} style={{position: "absolute", left: `${pen.x / data.width * 100}%`, top: `${pen.y / data.height * 100}%`, width: "13%", height: "auto", translate: "-12% -88%", opacity: pen.lifted ? .45 : 1}} /> : null}
    </div>
  </div>;
};
