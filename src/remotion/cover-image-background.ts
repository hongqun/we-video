/** 只移除与画布边缘连通的近白背景；封闭区域内的白色和已有透明 PNG 保持原样。 */
export const removeCoverWhiteBackground = (pixels: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray => {
  const output = new Uint8ClampedArray(pixels);
  const count = width * height;
  let transparent = 0;
  for (let i = 0; i < count; i++) if (pixels[i * 4 + 3]! < 16) transparent++;
  // 已经抠好的素材不再按白色二次抠图，避免白毛、白衣与外界相接时被误删。
  if (transparent > count * .01) return output;
  const exterior = new Uint8Array(count);
  const queue = new Int32Array(count);
  let head = 0; let tail = 0;
  const visit = (index: number) => {
    if (exterior[index]) return;
    const offset = index * 4;
    const low = Math.min(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!);
    const high = Math.max(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!);
    if (pixels[offset + 3]! < 16 || (low >= 236 && high - low <= 20)) {
      exterior[index] = 1;
      queue[tail++] = index;
    }
  };
  for (let x = 0; x < width; x++) {visit(x); visit(count - width + x);}
  for (let y = 0; y < height; y++) {visit(y * width); visit(y * width + width - 1);}
  while (head < tail) {
    const index = queue[head++]!;
    if (index % width > 0) visit(index - 1);
    if (index % width < width - 1) visit(index + 1);
    if (index >= width) visit(index - width);
    if (index < count - width) visit(index + width);
  }
  for (let i = 0; i < count; i++) {
    const offset = i * 4;
    if (exterior[i]) {output[offset + 3] = 0; continue;}
    const touchesBackground = (i % width > 0 && exterior[i - 1]) || (i % width < width - 1 && exterior[i + 1]) || (i >= width && exterior[i - width]) || (i < count - width && exterior[i + width]);
    if (!touchesBackground) continue;
    const low = Math.min(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!);
    const high = Math.max(pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!);
    // 仅对一像素宽的中性浅边去除白色混合，不模糊或改染主体颜色。
    if (low >= 180 && high - low <= 24) {
      const alpha = 1 - low / 255;
      output[offset + 3] = Math.round(pixels[offset + 3]! * alpha);
      for (let channel = 0; channel < 3; channel++) output[offset + channel] = Math.round((pixels[offset + channel]! - low) / Math.max(.0001, alpha));
    }
  }
  return output;
};
