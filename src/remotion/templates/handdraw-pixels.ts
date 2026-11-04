// 时间图是数据而非颜色：小端 RGB24 毫秒，透明像素为未使用位置。
export const decodeHanddrawTimes = (pixels: Uint8ClampedArray): Uint32Array => {
  const result = new Uint32Array(pixels.length / 4);
  for (let i = 0; i < result.length; i++) result[i] = pixels[i * 4 + 3] ? pixels[i * 4]! + pixels[i * 4 + 1]! * 256 + pixels[i * 4 + 2]! * 65536 : 0xffffffff;
  return result;
};
export type HanddrawPixels = {line: Uint8ClampedArray; color: Uint8ClampedArray; lineTimes: Uint32Array; colorTimes: Uint32Array; sketch?: Uint8ClampedArray; sketchTimes?: Uint32Array; eraseTimes?: Uint32Array; smooth?: boolean; transparent?: boolean; paperTimes?: Uint32Array};

/** 从画布边缘识别画外留白；被真实墨线或颜色围住的白色保留为物体底色。 */
export const handdrawPaperTimes = (assets: HanddrawPixels, width: number, height: number): Uint32Array => {
  const count = width * height;
  const result = new Uint32Array(count).fill(0xffffffff);
  const blocked = new Uint8Array(count);
  const seen = new Uint8Array(count);
  const queue = new Int32Array(count);
  for (let i = 0; i < count; i++) blocked[i] = assets.line[i * 4 + 3]! >= 32 || assets.color[i * 4 + 3]! >= 32 ? 1 : 0;
  let head = 0; let tail = 0;
  const visit = (index: number) => {
    if (!blocked[index] && !seen[index]) {seen[index] = 1; queue[tail++] = index;}
  };
  const neighbours = (index: number, apply: (next: number) => void) => {
    if (index % width > 0) apply(index - 1);
    if (index % width < width - 1) apply(index + 1);
    if (index >= width) apply(index - width);
    if (index < count - width) apply(index + width);
  };
  for (let x = 0; x < width; x++) {visit(x); visit(count - width + x);}
  for (let y = 0; y < height; y++) {visit(y * width); visit(y * width + width - 1);}
  while (head < tail) neighbours(queue[head++]!, visit);
  // 内部白色等围住它的边界画完再显现，不让尚未落笔的人物提前整块出现。
  for (let i = 0; i < count; i++) {
    if (blocked[i] || seen[i]) continue;
    head = 0; tail = 0; let boundaryTime = -1;
    visit(i);
    const explore = (next: number) => {
      if (blocked[next]) {
        const at = Math.min(assets.lineTimes[next]!, assets.colorTimes[next]!);
        if (at !== 0xffffffff) boundaryTime = Math.max(boundaryTime, at);
      } else visit(next);
    };
    while (head < tail) neighbours(queue[head++]!, explore);
    if (boundaryTime >= 0) for (let k = 0; k < tail; k++) result[queue[k]!] = boundaryTime;
  }
  return result;
};

/** 独立像素合成函数让跳帧、倒放与顺播具有相同结果，墨线始终覆盖颜色。 */
export const paintHanddrawPixels = (assets: HanddrawPixels, time: number, target = new Uint8ClampedArray(assets.line.length)) => {
  // 只在新版本使用短暂显现斜坡，避免前沿硬跳；最终像素始终恢复原图。
  const reveal = (at: number) => assets.smooth ? Math.max(0, Math.min(1, (time - at + 1) / 12)) : at <= time ? 1 : 0;
  for (let i = 0; i < assets.lineTimes.length; i++) {
    const offset = i * 4;
    const sketchAlpha = assets.sketch && assets.sketchTimes && assets.eraseTimes
      ? assets.sketch[offset + 3]! / 255 * reveal(assets.sketchTimes[i]!) * (1 - reveal(assets.eraseTimes[i]!)) : 0;
    const colorAlpha = reveal(assets.colorTimes[i]!) * assets.color[offset + 3]! / 255;
    const lineAlpha = reveal(assets.lineTimes[i]!) * assets.line[offset + 3]! / 255;
    // 透明合成使用预乘颜色，避免半透明墨线在主题底色上留下白边。
    const paperAlpha = assets.transparent ? (assets.paperTimes ? reveal(assets.paperTimes[i]!) : 0) : 1;
    const sketchOverPaper = sketchAlpha + paperAlpha * (1 - sketchAlpha);
    const colorOverPaper = colorAlpha + sketchOverPaper * (1 - colorAlpha);
    const outputAlpha = lineAlpha + colorOverPaper * (1 - lineAlpha);
    for (let channel = 0; channel < 3; channel++) {
      const paper = 255 * paperAlpha * (1 - sketchAlpha) + (assets.sketch?.[offset + channel] ?? 255) * sketchAlpha;
      const base = paper * (1 - colorAlpha) + assets.color[offset + channel]! * colorAlpha;
      target[offset + channel] = outputAlpha > 0 ? Math.round((base * (1 - lineAlpha) + assets.line[offset + channel]! * lineAlpha) / outputAlpha) : 0;
    }
    target[offset + 3] = Math.round(outputAlpha * 255);
  }
  return target;
};
