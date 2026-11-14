import {useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {cancelRender, continueRender, delayRender, staticFile, useCurrentFrame} from "remotion";
import type {VideoScene} from "../schema";
import {assertExplainerFrames, explainerMotionSchema, explainerPenAt, explainerSourceTimeAt, type ExplainerData, type ExplainerMotion} from "./handdraw-explainer-schema";
import {decodeHanddrawTimes, paintHanddrawPixels, type HanddrawPixels} from "./handdraw-pixels";
import {HanddrawTool} from "./HanddrawTool";

type LoadedLayer = HanddrawPixels & {motion: ExplainerMotion};
type Layer = ExplainerData["layers"][number];
const sourceURL = (source: string) => /^(?:https?:\/\/|data:|\/)/u.test(source) ? source : staticFile(source);
const pixels = (source: string, width: number, height: number) => new Promise<Uint8ClampedArray>((resolve, reject) => {
  const image = new Image(); image.crossOrigin = "anonymous";
  image.onload = () => {
    try {
      if (image.naturalWidth !== width || image.naturalHeight !== height) throw new Error("手绘讲解图层尺寸不匹配");
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d", {willReadFrequently: true});
      if (!context) throw new Error("无法创建手绘画布");
      context.drawImage(image, 0, 0); resolve(context.getImageData(0, 0, width, height).data);
    } catch (error) {reject(error);}
  };
  image.onerror = () => reject(new Error("手绘讲解图层加载失败")); image.src = sourceURL(source);
});
const cache = new Map<string, Promise<LoadedLayer>>();
const load = (layer: Layer) => {
  const key = JSON.stringify(layer);
  const current = cache.get(key); if (current) return current;
  const pending = Promise.all([
    pixels(layer.linePath, layer.width, layer.height), pixels(layer.colorPath, layer.width, layer.height),
    pixels(layer.lineTimePath, layer.width, layer.height), pixels(layer.colorTimePath, layer.width, layer.height),
    fetch(sourceURL(layer.motionPath)).then(async (response) => {if (!response.ok) throw new Error("手绘讲解轨迹加载失败"); return explainerMotionSchema.parse(await response.json());}),
  ]).then(([line, color, lineTime, colorTime, motion]): LoadedLayer => {
    if (motion.durationMs !== layer.durationMs) throw new Error("手绘讲解轨迹与图层不一致");
    return {line, color, lineTimes: decodeHanddrawTimes(lineTime), colorTimes: decodeHanddrawTimes(colorTime), motion, transparent: true, smooth: true};
  });
  cache.set(key, pending);
  if (cache.size > 60) cache.delete(cache.keys().next().value!);
  void pending.catch(() => cache.delete(key));
  return pending;
};

const DrawingLayer = ({layer, complete}: {layer: Layer; complete: boolean}) => {
  const frame = useCurrentFrame();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [assets, setAssets] = useState<LoadedLayer | null>(null);
  const [handle] = useState(() => delayRender("加载手绘讲解图层"));
  // 预览和导出统一把压缩后的帧区间映射回自然绘制时间。
  const time = complete ? layer.durationMs + 20 : explainerSourceTimeAt(layer, frame);
  useEffect(() => {
    let active = true;
    void load(layer).then((result) => {if (active) setAssets(result);}).catch((error: unknown) => {if (active) cancelRender(error instanceof Error ? error : new Error(String(error)));});
    return () => {active = false; continueRender(handle);};
  }, [handle, layer]);
  useLayoutEffect(() => {
    if (!assets || !canvas.current) return;
    const drawing = delayRender("绘制手绘讲解当前帧");
    try {
      const context = canvas.current.getContext("2d"); if (!context) throw new Error("手绘讲解画布不可用");
      const output = context.createImageData(layer.width, layer.height);
      paintHanddrawPixels(assets, time, output.data); context.putImageData(output, 0, 0); continueRender(handle);
    } catch (error) {cancelRender(error instanceof Error ? error : new Error(String(error)));}
    finally {continueRender(drawing);}
  }, [assets, time, layer.width, layer.height, handle]);
  const pen = assets && !complete ? explainerPenAt(assets.motion, time) : null;
  return <div style={{position: "absolute", left: `${layer.box[0] * 100}%`, top: `${layer.box[1] * 100}%`, width: `${layer.box[2] * 100}%`, height: `${layer.box[3] * 100}%`}}>
    <canvas ref={canvas} width={layer.width} height={layer.height} style={{display: "block", width: "100%", height: "100%"}} />
    {pen ? <HanddrawTool tool={pen.phase === 2 ? "marker" : "ink"} pen={pen} width={layer.width} height={layer.height} /> : null}
  </div>;
};

// 只读不可变图层，任意帧均从零重建；全片音轨、字幕与成片编码由上层 Remotion 管理。
export const HanddrawExplainer = ({scene, complete = false}: {scene: VideoScene; complete?: boolean}) => {
  const data = useMemo(() => assertExplainerFrames(scene, scene.templateData), [scene]);
  return <div style={{position: "relative", width: "100%", aspectRatio: "960 / 800", isolation: "isolate"}}>
    {data.layers.map((layer) => <DrawingLayer key={`${data.cacheKey}-${layer.id}`} layer={layer} complete={complete} />)}
  </div>;
};
