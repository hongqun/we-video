import {useEffect, useLayoutEffect, useRef, useState, type CSSProperties} from "react";
import {continueRender, delayRender, Img} from "remotion";
import {removeCoverWhiteBackground} from "./cover-image-background";

// 在显示副本上去白底，上传原图及封面配置不变；预览与首帧导出使用相同处理结果。
const prepareIllustration = (src: string) => new Promise<string>((resolve) => {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => {
    try {
      // 封面配图最大显示 660px，处理到 1600px 足以保留细线并限制大图内存。
      const ratio = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * ratio));
      const height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d", {willReadFrequently: true});
      if (!context) {resolve(src); return;}
      context.drawImage(image, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height);
      pixels.data.set(removeCoverWhiteBackground(pixels.data, width, height));
      context.putImageData(pixels, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    } catch {resolve(src);} // 无跨域像素权限时保留可显示的原图，不阻断导出。
  };
  image.onerror = () => resolve(src);
  image.src = src;
});

export const CoverIllustration = ({src, sourceRevision, style}: {src: string; sourceRevision: object; style?: CSSProperties}) => {
  // 首帧先锁住导出，直到透明副本已经提交到 React，再让 Img 完成自身加载。
  const [initialHandle] = useState(() => delayRender("封面插画背景处理"));
  const pending = useRef<number | null>(initialHandle);
  const [prepared, setPrepared] = useState<{source: string; revision: object; url: string; handle: number} | null>(null);
  useEffect(() => {
    let active = true;
    const handle = pending.current ?? delayRender("封面插画背景处理");
    pending.current = handle;
    // 替换同名上传文件后，配置对象变化也会触发重新处理。
    void prepareIllustration(src).then((url) => {
      if (active) setPrepared({source: src, revision: sourceRevision, url, handle});
    });
    return () => {active = false; if (pending.current === handle) pending.current = null; continueRender(handle);};
  }, [src, sourceRevision]);
  useLayoutEffect(() => {
    if (!prepared || prepared.source !== src || prepared.revision !== sourceRevision) return;
    continueRender(prepared.handle);
    if (pending.current === prepared.handle) pending.current = null;
  }, [prepared, src, sourceRevision]);
  if (!prepared || prepared.source !== src || prepared.revision !== sourceRevision) return null;
  return <Img src={prepared.url} style={style} />;
};
