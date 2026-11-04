// 时间图是数据而非颜色：小端 RGB24 毫秒，透明像素为未使用位置。
export const decodeHanddrawTimes = (pixels: Uint8ClampedArray): Uint32Array => {
  const result = new Uint32Array(pixels.length / 4);
  for (let i = 0; i < result.length; i++) result[i] = pixels[i * 4 + 3] ? pixels[i * 4]! + pixels[i * 4 + 1]! * 256 + pixels[i * 4 + 2]! * 65536 : 0xffffffff;
  return result;
};
export type HanddrawPixels = {line: Uint8ClampedArray; color: Uint8ClampedArray; lineTimes: Uint32Array; colorTimes: Uint32Array};

/** 独立像素合成函数让跳帧、倒放与顺播具有相同结果，墨线始终覆盖颜色。 */
export const paintHanddrawPixels = (assets: HanddrawPixels, time: number, target = new Uint8ClampedArray(assets.line.length)) => {
  for (let i = 0; i < assets.lineTimes.length; i++) {
    const offset = i * 4;
    const colorAlpha = assets.colorTimes[i]! <= time ? assets.color[offset + 3]! / 255 : 0;
    const lineAlpha = assets.lineTimes[i]! <= time ? assets.line[offset + 3]! / 255 : 0;
    for (let channel = 0; channel < 3; channel++) {
      const base = 255 * (1 - colorAlpha) + assets.color[offset + channel]! * colorAlpha;
      target[offset + channel] = Math.round(base * (1 - lineAlpha) + assets.line[offset + channel]! * lineAlpha);
    }
    target[offset + 3] = 255;
  }
  return target;
};
