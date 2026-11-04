"use client";
/* eslint-disable @remotion/warn-native-media-tag -- 配置表单不是视频画面，使用浏览器图片预览。 */
import {useEffect, useState} from "react";
import Link from "next/link";
import type {profileEditorData} from "@/lib/profile-store";
// 专栏与任务复用风格目录，保持童话等新增选项同步。
import {VISUAL_STYLE_OPTIONS} from "@/remotion/visual-style";

type Editor = Awaited<ReturnType<typeof profileEditorData>>;
type Form = Pick<Editor, "accountId" | "seriesId" | "version" | "accountVersion" | "title" | "description" | "expressionStyle" | "outputLanguage" | "defaultTextModel" | "defaultVoiceId" | "tts" | "visualStyle" | "archived" | "brand"> & {prompts: Record<string, string>; copyFromSeriesId?: string};
type Entry = {accountId: string; seriesId: string; data?: Editor; error?: string};
const blank = (): Form => ({accountId: "", seriesId: "", version: "", accountVersion: "", title: "", description: "", expressionStyle: "", outputLanguage: "zh-CN", visualStyle: "kinetic-lime", archived: false, defaultTextModel: undefined, defaultVoiceId: undefined, tts: undefined, brand: {title: "", subtitle: "", logo: "", presenterEnabled: false, outroEnabled: false}, prompts: {}});
const formFor = (data: Editor): Form => ({accountId: data.accountId, seriesId: data.seriesId, version: data.version, accountVersion: data.accountVersion, title: data.title, description: data.description, expressionStyle: data.expressionStyle, outputLanguage: data.outputLanguage, defaultTextModel: data.defaultTextModel, defaultVoiceId: data.defaultVoiceId, tts: data.tts, visualStyle: data.visualStyle, archived: data.archived, brand: data.brand, prompts: Object.fromEntries(Object.entries(data.prompts).flatMap(([name, value]) => value.override ? [[name, value.override]] : []))});
const responseJson = async (response: Response) => {
  const value = await response.json(); if (!response.ok || value.error) throw new Error(value.error || "配置操作失败"); return value;
};
// 普通设置直接呈现，内部 ID、目录与版本只在请求中传递。
export function ProfileManager() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [overrides, setOverrides] = useState<Array<{key: string; label: string}>>([]);
  const [form, setForm] = useState<Form>(blank);
  const [selected, setSelected] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [voices, setVoices] = useState<Array<{id: string; name: string}>>([]);
  const [settingsWarning, setSettingsWarning] = useState("");
  const [promptName, setPromptName] = useState("narration-system.md");
  const reload = async () => {
    const value = await responseJson(await fetch("/api/profile-management", {cache: "no-store"}));
    setEntries(value.profiles); setOverrides(value.overrides);
  };
  useEffect(() => {void reload().catch((e) => setError(String(e.message)));}, []);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({accountId: form.accountId || "builtin", seriesId: form.seriesId || "general"});
    void fetch(`/api/settings?${query}`, {signal: controller.signal}).then(responseJson).then((value) => {setVoices(value.voices); setSettingsWarning("");}).catch((e) => {if (!controller.signal.aborted) {setVoices([]); setSettingsWarning(e.message);}});
    return () => controller.abort();
  }, [form.accountId, form.seriesId]);
  const patch = (change: Partial<Form>) => setForm((current) => ({...current, ...change}));
  const open = (data: Editor | null) => {setSelected(data); setForm(data ? formFor(data) : blank()); setError(""); setMessage("");};
  const save = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const body = {...form, accountId: form.accountId || undefined, seriesId: form.seriesId || undefined, version: form.version || undefined, accountVersion: form.accountVersion || undefined};
      const result = await responseJson(await fetch("/api/profile-management", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)}));
      setSelected(result.profile); setForm(formFor(result.profile)); await reload(); setMessage("已保存，新的创作将使用此配置；已有任务保持原配置。");
    } catch (e) {setError(e instanceof Error ? e.message : "保存失败");} finally {setBusy(false);}
  };
  const upload = async (file: File, kind: "logo" | "presenter") => {
    setBusy(true); setError(""); setMessage("");
    try {
      const body = new FormData(); body.set("accountId", form.accountId); body.set("accountVersion", form.accountVersion); body.set("kind", kind); body.set("file", file);
      const result = await responseJson(await fetch("/api/profile-management", {method: "POST", body}));
      // 人物新增立即更新预览，专栏开关和 Logo 选择仍随表单保存。
      const fresh = await responseJson(await fetch("/api/profile-management", {cache: "no-store"}));
      setEntries(fresh.profiles);
      const current = (fresh.profiles as Entry[]).find((entry) => entry.accountId === form.accountId && entry.seriesId === form.seriesId)?.data;
      if (current) setSelected({...current, poses: result.pose && !current.poses.some((pose) => pose.id === result.pose.id) ? [...current.poses, result.pose] : current.poses});
      patch({accountVersion: result.accountVersion, brand: {...form.brand, ...(kind === "logo" ? {logo: result.filename} : {presenterEnabled: true})}});
      setMessage("素材已上传，请保存专栏以应用选择。人物素材由同账号专栏共享，已有任务不受影响。");
    } catch (e) {setError(e instanceof Error ? e.message : "上传失败");} finally {setBusy(false);}
  };
  const overridden = (key: string) => overrides.some((item) => item.key === key);
  return <main className="profile-manager">
    <header className="profile-manager-header"><div><p className="eyebrow">WE-VIDEO</p><h1>专栏设置</h1><p className="hint">通用创作随时可用。专栏用来保存内容风格与默认声音。</p></div><Link href="/" className="secondary">返回创作</Link></header>
    {error ? <p role="alert" className="profile-manager-error">{error}</p> : null}
    {message ? <p role="status" className="profile-manager-notice">{message}</p> : null}
    {overrides.length ? <p className="profile-manager-notice">部署覆盖正在生效：{overrides.map((item) => `${item.label}（${item.key}）`).join("、")}。受覆盖字段无法在此修改，覆盖目录中的提示词优先使用。</p> : null}
    <div className="profile-manager-grid"><aside className="panel profile-manager-list"><button disabled={busy} onClick={() => open(null)}>新建专栏</button><div className="profile-manager-default"><strong>通用创作</strong><p className="hint">内置默认配置 · 无需设置</p></div>
      {entries.map((entry) => <button type="button" className="secondary profile-manager-item" key={`${entry.accountId}/${entry.seriesId}`} disabled={busy || !entry.data} onClick={() => entry.data && open(entry.data)}><strong>{entry.data?.title || `${entry.accountId}/${entry.seriesId}`}</strong><small>{entry.error || (entry.data?.archived ? "已归档" : entry.data?.kind === "derived" ? "英文派生" : "可用于创作")}</small></button>)}
    </aside><section className="panel profile-manager-form"><h2>{form.seriesId ? "编辑专栏" : "新建专栏"}</h2>
      <label>专栏名称<input value={form.title} disabled={busy || overridden("TALK_VIDEO_SERIES_TITLE")} onChange={(e) => patch({title: e.target.value})} placeholder="例如：每天一个科学知识" /></label>
      <label>内容定位<textarea rows={3} value={form.description} disabled={busy || overridden("TALK_VIDEO_SERIES_DESCRIPTION")} onChange={(e) => patch({description: e.target.value})} placeholder="可选，例如：面向普通读者解释生活中的科学现象" /></label>
      <label>表达风格<textarea rows={2} value={form.expressionStyle} disabled={busy} onChange={(e) => patch({expressionStyle: e.target.value})} placeholder="可选，例如：简洁自然，多用日常例子" /></label>
      <div className="profile-manager-fields"><label>输出语言<select value={form.outputLanguage} disabled={busy || selected?.kind === "derived"} onChange={(e) => patch({outputLanguage: e.target.value as Form["outputLanguage"]})}><option value="zh-CN">中文</option><option value="en-US">英文</option></select></label>
      <label>默认模型<select value={form.defaultTextModel || ""} disabled={busy || overridden("TALK_VIDEO_DEFAULT_TEXT_MODEL")} onChange={(e) => patch({defaultTextModel: e.target.value as Form["defaultTextModel"]})}><option value="">使用系统默认</option><option value="deepseek-v4-flash">DeepSeek V4 Flash</option><option value="deepseek-v4-pro">DeepSeek V4 Pro</option></select></label>
      <label>默认音色<select value={form.defaultVoiceId || ""} disabled={busy} onChange={(e) => patch({defaultVoiceId: e.target.value})}><option value="">使用系统默认</option>{form.defaultVoiceId && !voices.some((v) => v.id === form.defaultVoiceId) ? <option value={form.defaultVoiceId}>{form.defaultVoiceId}（当前配置）</option> : null}{voices.map((voice) => <option value={voice.id} key={voice.id}>{voice.name}</option>)}</select></label>
      <label>语速<input type="number" min={0.5} max={1.5} step={0.05} placeholder="使用系统默认" value={form.tts?.rate ?? ""} disabled={busy} onChange={(e) => patch({tts: {...form.tts, rate: e.target.value ? Number(e.target.value) : undefined}})} /></label>
      <label>视觉风格<select value={form.visualStyle || "kinetic-lime"} disabled={busy} onChange={(e) => patch({visualStyle: e.target.value as Form["visualStyle"]})}>{VISUAL_STYLE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label></div>
      {settingsWarning ? <p className="hint">声音配置暂不可读取：{settingsWarning}。请在本地部署配置中修复服务连接。</p> : null}
      <fieldset disabled={busy}><legend>品牌与人物（可选）</legend><p className="hint">品牌文字与显示开关属于本专栏。人物素材由同账号专栏共享；上传只增加素材，已有任务使用自己的副本。</p>
        <label>品牌名称<input value={form.brand.title} disabled={overridden("TALK_VIDEO_BRAND_TITLE")} onChange={(e) => patch({brand: {...form.brand, title: e.target.value}})} /></label>
        <label>品牌副标题<input value={form.brand.subtitle} disabled={overridden("TALK_VIDEO_BRAND_SUBTITLE")} onChange={(e) => patch({brand: {...form.brand, subtitle: e.target.value}})} /></label>
        <div className="profile-manager-assets">{form.brand.logo && form.accountId ? <img alt="Logo 预览" src={`/api/profile-assets/${form.accountId}/brand/${form.brand.logo}`} /> : <span className="hint">未设置 Logo</span>}
        <label>上传 Logo<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!form.seriesId || overridden("TALK_VIDEO_LOGO")} onChange={(e) => {const file = e.target.files?.[0]; if (file) void upload(file, "logo"); e.target.value = "";}} /></label><button className="secondary" disabled={overridden("TALK_VIDEO_LOGO")} onClick={() => patch({brand: {...form.brand, logo: ""}})}>移除 Logo</button></div>
        <label className="profile-manager-checkbox"><input type="checkbox" checked={form.brand.presenterEnabled} onChange={(e) => patch({brand: {...form.brand, presenterEnabled: e.target.checked}})} />显示人物</label>
        <div className="profile-manager-assets">{selected?.poses.map((pose) => <img key={pose.id} alt={pose.label} src={pose.src} />)}<label>上传人物图片<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!form.seriesId} onChange={(e) => {const file = e.target.files?.[0]; if (file) void upload(file, "presenter"); e.target.value = "";}} /></label></div>
        {!form.seriesId ? <p className="hint">填写名称并保存后，即可上传素材。</p> : null}
        <label className="profile-manager-checkbox"><input type="checkbox" checked={form.brand.outroEnabled} onChange={(e) => patch({brand: {...form.brand, outroEnabled: e.target.checked}})} />添加品牌片尾</label>
      </fieldset>
      <details><summary>高级：提示词</summary><p className="hint">默认自动继承系统模板；覆盖后必须保留必要占位符。</p><label>模板<select value={promptName} onChange={(e) => setPromptName(e.target.value)}>{Object.keys(selected?.prompts ?? {"narration-system.md": null}).map((name) => <option key={name}>{name}</option>)}</select></label><p className="hint">来源：{overridden("TALK_VIDEO_PROMPT_DIR") ? selected?.prompts[promptName]?.source : form.prompts[promptName] ? "专栏覆盖" : selected?.prompts[promptName]?.inheritedSource ?? "系统默认"}</p><textarea rows={10} value={overridden("TALK_VIDEO_PROMPT_DIR") ? selected?.prompts[promptName]?.value ?? "" : form.prompts[promptName] ?? selected?.prompts[promptName]?.inheritedValue ?? ""} disabled={busy || overridden("TALK_VIDEO_PROMPT_DIR")} onChange={(e) => patch({prompts: {...form.prompts, [promptName]: e.target.value}})} /><button className="secondary" disabled={busy || overridden("TALK_VIDEO_PROMPT_DIR")} onClick={() => {const next = {...form.prompts}; delete next[promptName]; patch({prompts: next});}}>恢复继承模板（保存后生效）</button></details>
      <div className="actions"><button disabled={busy || !form.title.trim()} onClick={() => void save()}>{busy ? "处理中…" : "保存专栏"}</button>{form.seriesId ? <><button className="secondary" disabled={busy} onClick={() => {patch({copyFromSeriesId: form.seriesId, seriesId: "", title: `${form.title} 副本`, archived: false, prompts: Object.fromEntries(Object.entries(selected?.prompts ?? {}).map(([name, prompt]) => [name, prompt.value]))}); setMessage("已复制到新表单，保存后创建独立专栏，人物库仍与原账号共享。");}}>复制专栏</button><button className="secondary" disabled={busy} onClick={() => {patch({archived: !form.archived}); setMessage("归档状态已更改，请保存生效。");}}>{form.archived ? "恢复使用" : "归档专栏"}</button></> : null}</div>
    </section></div>
  </main>;
}
