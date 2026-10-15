import {getIconData, iconToSVG} from "@iconify/utils";
import type {IconifyJSON} from "@iconify/types";
import logos from "@iconify-json/logos/icons.json";
import materialSymbols from "@iconify-json/material-symbols/icons.json";
import simpleIcons from "@iconify-json/simple-icons/icons.json";

export type LocalIcon = {src: string; name: string; aspectRatio: number};
const sets = [
  // Logos 集合保留 Claude、DeepSeek 等品牌 SVG 的原始多色 path，优先于单色品牌图标。
  {label: "彩色 Logos", data: logos as unknown as IconifyJSON},
  {label: "Material Symbols", data: {prefix: "material-symbols", icons: materialSymbols.icons, width: 24, height: 24} as IconifyJSON},
  {label: "Simple Icons", data: {prefix: "simple-icons", icons: simpleIcons.icons, width: 24, height: 24} as IconifyJSON},
] as const;

const svgDataUrl = (body: string, attributes: Record<string, string>) => {
  const attrs = Object.entries({...attributes, overflow: "visible", preserveAspectRatio: "xMidYMid meet"}).map(([key, value]) => `${key}="${value}"`).join(" ");
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`)}`;
};

/** 图标搜索只读本地包；选择后保存 SVG data URL，预览和离线渲染不依赖远程服务。 */
export const searchLocalIcons = (query: string, limit = 30): LocalIcon[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const results: LocalIcon[] = [];
  for (const set of sets) {
    for (const name of Object.keys(set.data.icons)) {
      if (!name.toLowerCase().includes(needle)) continue;
      const icon = getIconData(set.data, name);
      if (!icon) continue;
      const built = iconToSVG(icon, {height: "1em", width: "1em"});
      // 给贴近边界的 SVG 路径留透明安全边距，避免图标在 img 容器内被视觉裁切。
      const [viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight] = built.viewBox;
      const padding = Math.max(viewBoxWidth, viewBoxHeight) * 0.08;
      const attributes = {...built.attributes, viewBox: `${viewBoxX - padding} ${viewBoxY - padding} ${viewBoxWidth + padding * 2} ${viewBoxHeight + padding * 2}`};
      results.push({name: `${set.label} · ${name}`, src: svgDataUrl(built.body, attributes), aspectRatio: (viewBoxWidth + padding * 2) / (viewBoxHeight + padding * 2)});
      if (results.length >= limit) return results;
    }
  }
  return results;
};
