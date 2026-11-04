import type {handdrawToolAt} from "./handdraw-schema";
import {useVisualTheme} from "../theme";
import {FAIRYTALE_PALETTE} from "../visual-style";

// 四种工具共享 120×120 画布，接触点固定为 (12,108)，无需猜测图片透明边距。
export const HanddrawTool = ({tool, pen, width, height}: {tool: ReturnType<typeof handdrawToolAt>; pen: {x: number; y: number; lifted: boolean}; width: number; height: number}) => {
  // 童话主题的工具随全片切换为粉紫蜜桃，其他主题保留鲜艳工具色。
  const fairytale = useVisualTheme().id === "dopamine-fairytale";
  // 工具采用高饱和配色，白纸上更醒目；笔尖仍保留清晰的深色边缘。
  const scale = Math.max(1, Math.max(width, height) / 720);
  return <svg aria-hidden="true" viewBox="0 0 120 120" style={{position: "absolute", left: `${pen.x / width * 100}%`, top: `${pen.y / height * 100}%`, width: `${120 * scale / width * 100}%`, height: "auto", translate: "-10% -90%", overflow: "visible", opacity: pen.lifted ? .6 : 1, pointerEvents: "none"}}>
    {tool === "eraser" ? <g stroke="#a52d65" strokeWidth="1.5">
      <path d="M-8 108 49 38 82 65 32 116Z" fill={fairytale ? "#FFB4D4" : "#ffb7cc"} />
      <path d="m13 82 36-44 33 27-34 43Z" fill={fairytale ? FAIRYTALE_PALETTE.rose : "#ff4589"} />
      <path d="m-8 108 20-7 20 15" fill="#ffe7ef" />
    </g> : tool === "marker" ? <g stroke="#a64c12" strokeWidth="1.5">
      <path d="m5 108 9-19 11 6-6 13Z" fill="#e9561a" />
      <path d="m14 89 51-68 19 14-59 60Z" fill={fairytale ? FAIRYTALE_PALETTE.peach : "#ffcb32"} />
      <path d="m59 29 9-13 20 14-9 13Z" fill={fairytale ? "#F58CA4" : "#ff7628"} />
      <path d="m28 72 30-40" stroke={fairytale ? "#FFF1EC" : "#fff1a6"} strokeWidth="5" />
    </g> : <g stroke="#393068" strokeWidth="1.3">
      <path d="m12 108 9-26 15 12Z" fill={tool === "pencil" ? "#ffd18b" : "#d8c8ff"} />
      <path d="m12 108 3-10 5 4Z" fill={tool === "pencil" ? "#147be8" : "#3d236b"} />
      <path d="m21 82 52-68 15 12-52 68Z" fill={tool === "pencil" ? (fairytale ? FAIRYTALE_PALETTE.lilac : "#24a5ff") : (fairytale ? FAIRYTALE_PALETTE.rose : "#9854ed")} />
      <path d="m27 85 51-66" stroke={tool === "pencil" ? (fairytale ? "#EEDAFF" : "#b0eeff") : (fairytale ? "#FFD9EB" : "#dfb4ff")} strokeWidth="3" />
      <path d="m52 14 4-5 15 12-4 5Z" fill="#ffbc45" />
    </g>}
  </svg>;
};
