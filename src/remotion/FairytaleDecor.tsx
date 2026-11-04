import {useVideoConfig} from "remotion";

// 配饰限定在画面边缘；固定几何形状确保封面预览、逐帧定位与导出一致。
export const FairytaleDecor = ({quiet = false, opacity = 1}: {quiet?: boolean; opacity?: number}) => {
  const {width, height} = useVideoConfig();
  return <svg aria-hidden="true" width={width} height={height} viewBox="0 0 1080 1260" preserveAspectRatio="none" style={{position: "absolute", inset: 0, pointerEvents: "none", opacity: opacity * (quiet ? .22 : 1)}}>
    <g fill="none" strokeWidth={24}>
      {["#FF69A7", "#FFDC45", "#33C9ED", "#AE78E7"].map((color, index) => <path key={color} d={`M ${770 + index * 24} 220 A ${230 - index * 24} ${230 - index * 24} 0 0 1 ${1230 - index * 24} 220`} stroke={color} />)}
    </g>
    <path d="M 815 235 C 785 235 785 195 815 190 C 812 155 864 148 875 180 C 900 157 937 180 925 207 C 952 215 940 242 915 242 H 817 Z" fill="#FFFFFF" stroke="#D4B7ED" strokeWidth={3} />
    <g fill="#FFDC45" stroke="#CA8F25" strokeWidth={2}>
      <path d="m 1000 340 11 25 27 3 -20 19 5 28 -23 -14 -24 14 5 -28 -20 -19 28 -3 Z" />
      <path d="m 45 920 11 25 27 3 -20 19 5 28 -23 -14 -24 14 5 -28 -20 -19 28 -3 Z" />
    </g>
    {!quiet ? <>
      <path d="M -40 1190 Q 100 1000 260 1190 T 600 1260 H -40 Z" fill="#AE78E7" opacity={.35} />
      <path d="M 680 1260 Q 850 1040 1120 1160 V 1260 Z" fill="#33C9ED" opacity={.4} />
      <path d="m 980 890 7 21 21 7 -21 7 -7 21 -7 -21 -21 -7 21 -7 Z" fill="#E83B89" />
      <circle cx={1020} cy={1030} r={13} fill="#AE78E7" />
      <circle cx={42} cy={750} r={10} fill="#33C9ED" />
    </> : null}
  </svg>;
};
