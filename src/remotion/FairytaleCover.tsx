import {AbsoluteFill, Img, staticFile} from "remotion";
import type {CoverConfig, RenderManifest} from "./schema";
import {comicTextSize} from "./ComicChrome";
import {ProtectedText, splitProtectedText} from "./ProtectedText";
import {openingBodyText, openingPresenterImageStyle} from "./OpeningLayout";
import {SANS_FONT_FAMILY} from "./typography";
import {useVisualTheme} from "./theme";
import {FAIRYTALE_PALETTE as palette} from "./visual-style";
import {VideoBrand} from "./VideoBrand";
import {CoverIllustration} from "./CoverIllustration";

const source = (value: string) => /^(?:https?:\/\/|data:|\/)/u.test(value) ? value : staticFile(value);
const star = "m0-16 5 11 12 5-12 5-5 12-5-12-12-5 12-5Z";

// 首帧使用静态完整构图；独立预览和成片共用此组件，不依赖入场动画。
export const FairytaleCover = ({brand, cover, pose}: {brand: RenderManifest["brand"]; cover: CoverConfig; pose?: {id: string; src: string}}) => {
  const theme = useVisualTheme();
  const rawTitle = cover.title.trim().replaceAll("\\n", "\n");
  // 长标题优先平衡成两段，显式换行和英文术语仍按用户原文保留。
  const title = !rawTitle.includes("\n") && Array.from(rawTitle).length > 12 ? splitProtectedText(rawTitle).join("\n") : rawTitle;
  const subtitle = openingBodyText(cover.subtitle.trim());
  const keywords = [...new Set(cover.keywords.map((word) => word.trim()).filter(Boolean))];
  const hasImage = Boolean(cover.imagePath);
  return <AbsoluteFill style={{fontFamily: SANS_FONT_FAMILY, color: theme.colors.ink, overflow: "hidden", background: `radial-gradient(ellipse at 18% 12%, #FFE1ED, transparent 48%), radial-gradient(ellipse at 90% 73%, #EEDFFF, transparent 48%), ${theme.colors.canvas}`}}>
    {/* 细双边框与底部云朵形成故事书封套，装饰避开标题及人物面部。 */}
    <svg aria-hidden="true" width={1080} height={1260} viewBox="0 0 1080 1260" style={{position: "absolute", inset: 0, pointerEvents: "none"}}>
      <rect x={28} y={28} width={1024} height={1204} rx={54} fill="none" stroke={palette.outline} strokeWidth={3} />
      <rect x={39} y={39} width={1002} height={1182} rx={46} fill="none" stroke="#FFFCFE" strokeWidth={2} />
      <g fill="none" strokeWidth={15} strokeLinecap="round" opacity={.8}>
        {[palette.rose, palette.peach, palette.lilac].map((color, index) => <path key={color} d={`M ${902 + index * 15} 151 A ${86 - index * 15} ${86 - index * 15} 0 0 1 ${1074 - index * 15} 151`} stroke={color} />)}
      </g>
      <path d="M89 1014C53 980 78 939 118 953c8-43 73-43 87-5 40-23 82 8 68 42 42 9 35 56-7 58H104Z" fill={palette.cloud} opacity={.85} />
      <path d="M802 1020c-32-27-12-66 23-62 4-49 72-56 91-15 41-18 78 14 62 47 40 4 45 48 9 59H830Z" fill={palette.cloud} opacity={.85} />
      {[{x: 79, y: 198, color: palette.butter}, {x: 1002, y: 431, color: palette.lilac}, {x: 87, y: 665, color: palette.rose}, {x: 977, y: 852, color: palette.butter}].map(({x, y, color}) => <path key={x} d={star} fill={color} stroke="#FFFCFE" strokeWidth={2} transform={`translate(${x} ${y})`} />)}
      <circle cx={113} cy={452} r={6} fill={palette.peach} />
      <circle cx={962} cy={620} r={7} fill={palette.rose} />
    </svg>
    <VideoBrand brand={brand} />
    {/* 标题独占上部安全区，白色细描边和粉色投影加强缩略图辨识度。 */}
    <div style={{position: "absolute", left: 112, top: 162, width: 856, height: 270, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center"}}>
      <div style={{fontSize: comicTextSize(title, 856, 270, 92, 40), fontWeight: 900, lineHeight: 1.15, letterSpacing: -.8, whiteSpace: "pre-wrap", overflowWrap: "anywhere", textWrap: "balance", WebkitTextStroke: "3px #FFFCFE", paintOrder: "stroke fill", textShadow: "0 5px 0 rgba(243,108,168,.18)"}}><ProtectedText>{title}</ProtectedText></div>
    </div>
    {subtitle ? <div style={{position: "absolute", left: 150, top: 450, width: 780, height: 148, padding: "16px 26px", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${palette.outline}`, borderRadius: 32, background: "rgba(255,252,254,.88)", boxShadow: "0 5px 0 rgba(188,139,232,.10)", textAlign: "center", fontSize: comicTextSize(subtitle, 728, 104, 34, 18), fontWeight: 650, lineHeight: 1.3, whiteSpace: "pre-wrap", overflowWrap: "anywhere"}}><ProtectedText>{subtitle}</ProtectedText></div> : null}
    <div aria-hidden="true" style={{position: "absolute", left: 150, top: 632, width: 780, height: 440, borderRadius: "48% 52% 44% 56%", background: `radial-gradient(ellipse, ${theme.colors.softAccent}, ${theme.colors.softInfo} 50%, transparent 72%)`}} />
    {/* 同时有人物与配图时分区展示；人物延续原透明图和近景裁切。 */}
    {pose ? <div style={{position: "absolute", left: hasImage ? 530 : 280, top: 628, width: hasImage ? 400 : 520, height: 438, overflow: "hidden"}}><Img src={source(pose.src)} style={{...openingPresenterImageStyle(pose.id), filter: "drop-shadow(0 10px 14px rgba(133,72,125,.12))"}} /></div> : null}
    {cover.imagePath ? <CoverIllustration src={source(cover.imagePath)} sourceRevision={cover} style={{position: "absolute", left: pose ? 150 : 210, top: pose ? 674 : 636, width: pose ? 350 : 660, height: pose ? 350 : 422, objectFit: "contain", borderRadius: 30}} /> : null}
    {!pose && !hasImage ? <svg aria-hidden="true" width={600} height={410} viewBox="0 0 600 410" style={{position: "absolute", left: 240, top: 644}}>
      {/* 无素材时用打开的故事书承接视觉中心，不替用户添加故事角色或文案。 */}
      <ellipse cx={300} cy={354} rx={220} ry={24} fill={palette.lilac} opacity={.14} />
      <path d="M70 108q110-30 230 18 120-48 230-18v220q-118-21-230 22-112-43-230-22Z" fill={palette.rose} stroke={palette.outline} strokeWidth={3} />
      <path d="M86 90q110-23 214 28 104-51 214-28v218q-110-18-214 30-104-48-214-30Z" fill="#FFF9EF" stroke={palette.outline} strokeWidth={3} />
      <path d="M300 118v220" stroke={palette.outline} strokeWidth={3} />
      <path d="M126 151q66-5 126 20m-126 28q66-5 126 20m-126 28q66-5 96 12M348 171q60-25 126-20m-126 68q60-25 126-20m-96 60q30-12 96-12" fill="none" stroke={palette.peach} strokeWidth={9} strokeLinecap="round" />
      <path d={star} transform="translate(300 52)" fill={palette.butter} />
      <path d={star} transform="translate(430 40)" fill={palette.lilac} />
    </svg> : null}
    {/* 关键词最多八项，四列两行留在底部安全区，长词自动缩小且完整展示。 */}
    {keywords.length ? <div style={{position: "absolute", left: 100, top: 1090, width: 880, display: "grid", gridTemplateColumns: `repeat(${Math.min(4, keywords.length)}, minmax(0, 1fr))`, gap: 12}}>{keywords.map((word, index) => <div key={word} style={{minHeight: 54, boxSizing: "border-box", padding: "6px 12px", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", borderRadius: 22, border: `2px solid ${palette.outline}`, background: ["#FFE1EE", "#EEE0FF", "#FFE9DB", "#FFF0CD"][index % 4], fontSize: comicTextSize(word, 184, 40, 23, 14), fontWeight: 750, lineHeight: 1.2, overflowWrap: "anywhere"}}><ProtectedText>{word}</ProtectedText></div>)}</div> : null}
  </AbsoluteFill>;
};
