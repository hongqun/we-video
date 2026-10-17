"use client";
import {ModelParameterTip} from "./ModelParameterTip";
import {ANNOTATION_PRESETS, annotationStyle, type ModelAnnotation} from "@/remotion/templates/model-scene-annotations";

type Props = {annotation: ModelAnnotation; fps: number; onChange: (patch: Partial<ModelAnnotation>) => void; onTime: (field: "timeMs" | "endMs" | "offsetMs", ms: number) => void; onPick: () => void};
// 标注外观和屏幕偏移由 JSON 驱动；样式预设切换后仍可逐项调整。
export const ModelAnnotationInspector = ({annotation, fps, onChange, onTime, onPick}: Props) => {
  const style = annotationStyle(annotation);
  const updateStyle = (patch: Partial<NonNullable<ModelAnnotation["style"]>>) => onChange({style: {...annotation.style, preset: style.preset, ...patch}});
  return <>
    <label><span className="model-parameter-name">标注文字<ModelParameterTip text="显示在模型旁的标签内容；暂停后可拖动文字框调整位置。" /></span><input value={annotation.text} onChange={(e) => onChange({text: e.target.value})} /></label>
    <div className="model-annotation-presets">{Object.entries(ANNOTATION_PRESETS).map(([preset, item]) => <button type="button" key={preset} title={`切换为${item.label}，并恢复该预设的默认颜色、字号和引线设置。`} aria-pressed={style.preset === preset} className={style.preset === preset ? "is-selected" : "secondary"} onClick={() => onChange({style: {preset: preset as typeof style.preset}})}><span style={{background: item.backgroundColor, color: item.textColor, borderColor: item.accentColor}}>{item.label}</span></button>)}</div>
    {([['accentColor', '强调色'], ['textColor', '文字色'], ['backgroundColor', '背景色']] as const).map(([field, label]) => <label key={field}><span className="model-parameter-name">{label}<ModelParameterTip text={{accentColor: "修改边框、锚点和引线的强调色。", textColor: "修改标签文字颜色。", backgroundColor: "修改标签背景颜色。"}[field]} /></span><input type="color" value={style[field]} onChange={(e) => updateStyle({[field]: e.target.value})} /></label>)}
    <label><span className="model-parameter-name">字号<ModelParameterTip text="按成片画幅设置标签字号（16–48）；预览会按显示比例缩放。" /></span><input type="number" min={16} max={48} value={style.fontSize} onChange={(e) => updateStyle({fontSize: Math.max(16, Math.min(48, Number(e.target.value) || 28))})} /></label>
    <label className="model-checkbox"><input type="checkbox" checked={style.showLine} onChange={(e) => updateStyle({showLine: e.target.checked})} /><span className="model-parameter-name">显示引线<ModelParameterTip text="显示或隐藏连接文字标签和模型部件锚点的引线。" /></span></label>
    <p className="field-hint">拖动文字框调整位置；拖动部件上的圆点重新定位锚点。</p>
    {([['timeMs', '开始'], ['endMs', '结束'], ['offsetMs', '绑定偏移']] as const).map(([field, label]) => <label key={field}><span className="model-parameter-name">{label}（秒）<ModelParameterTip text={{timeMs: "标注开始显示的镜头内时间；绑定口播后修改此项会调整偏移。", endMs: "标注结束显示的镜头内时间，必须晚于开始且不超过镜头末尾。", offsetMs: "相对于口播匹配起点的偏移：正数延后，负数提前；仅在绑定后生效。"}[field]} /></span><input type="number" step={1 / fps} value={(annotation[field] ?? 0) / 1000} onChange={(e) => onTime(field, Number(e.target.value) * 1000)} /></label>)}
    <label><span className="model-parameter-name">绑定口播（可选）<ModelParameterTip text="填写当前镜头中的连续口播文字，标注从该片段开始显示；留空则使用开始时间。" /></span><input value={annotation.cueText} onChange={(e) => onChange({cueText: e.target.value})} /></label>
    <label><span className="model-parameter-name">出现次数<ModelParameterTip text="绑定文字重复出现时，指定使用第几次匹配，从 1 开始。" /></span><input type="number" min={1} max={20} value={annotation.cueOccurrence ?? 1} onChange={(e) => onChange({cueOccurrence: Number(e.target.value)})} /></label>
    <button type="button" className="secondary" title="点击后在模型表面重新设置锚点；也可拖动选中标注的圆点，释放到空白处会取消本次移动。" onClick={onPick}>{annotation.anchor ? "重新点选表面" : "点选表面（未完成）"}</button>
    <button type="button" className="secondary" title="恢复标签相对部件锚点的默认偏移，不改变锚点位置。" onClick={() => onChange({labelOffset: {x: 0.16, y: -0.12}})}>重置文字位置</button>
  </>;
};
