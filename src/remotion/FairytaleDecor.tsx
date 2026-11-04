import {useVideoConfig} from "remotion";
import {FAIRYTALE_PALETTE as palette} from "./visual-style";

// 粉紫与蜜桃配饰共用主题调色板，限定在画面边缘；固定几何形状确保封面预览、逐帧定位与导出一致。
export const FairytaleDecor = ({quiet = false, opacity = 1}: {quiet?: boolean; opacity?: number}) => {
  const {width, height} = useVideoConfig();
  return <svg aria-hidden="true" width={width} height={height} viewBox="0 0 1080 1260" preserveAspectRatio="none" style={{position: "absolute", inset: 0, pointerEvents: "none", opacity: opacity * (quiet ? .22 : 1)}}>
    <g fill="none" strokeWidth={24}>
      {[palette.rose, palette.peach, palette.lilac, palette.butter].map((color, index) => <path key={color} d={`M ${770 + index * 24} 220 A ${230 - index * 24} ${230 - index * 24} 0 0 1 ${1230 - index * 24} 220`} stroke={color} />)}
    </g>
    <path d="M 815 235 C 785 235 785 195 815 190 C 812 155 864 148 875 180 C 900 157 937 180 925 207 C 952 215 940 242 915 242 H 817 Z" fill={palette.cloud} stroke={palette.outline} strokeWidth={3} />
    <g fill={palette.butter} stroke="#D5A66B" strokeWidth={2}>
      <path d="m 1000 340 11 25 27 3 -20 19 5 28 -23 -14 -24 14 5 -28 -20 -19 28 -3 Z" />
      <path d="m 45 920 11 25 27 3 -20 19 5 28 -23 -14 -24 14 5 -28 -20 -19 28 -3 Z" />
    </g>
    {!quiet ? <>
      <path d="M -40 1190 Q 100 1000 260 1190 T 600 1260 H -40 Z" fill={palette.lilac} opacity={.35} />
      <path d="M 680 1260 Q 850 1040 1120 1160 V 1260 Z" fill={palette.peach} opacity={.4} />
      <path d="m 980 890 7 21 21 7 -21 7 -7 21 -7 -21 -21 -7 21 -7 Z" fill={palette.rose} />
      <circle cx={1020} cy={1030} r={13} fill={palette.lilac} />
      <circle cx={42} cy={750} r={10} fill={palette.peach} />
    </> : null}
  </svg>;
};
