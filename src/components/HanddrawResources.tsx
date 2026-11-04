/* eslint-disable @remotion/warn-native-media-tag -- 原图审核使用浏览器图片，动画预览由 Remotion 负责。 */
"use client";
import {useEffect, useRef, useState} from "react";
import {handdrawTiming, type HanddrawResource, type HanddrawSceneWindow} from "@/remotion/templates/handdraw-schema";
import type {SceneVisualResource} from "@/lib/visual-resource-selection";
import {Icon} from "./Icon";

export type HanddrawResourcesSnapshot = {revision?: number; resources: SceneVisualResource[]};
type Props = {jobId: string; sceneId: string; scene: HanddrawSceneWindow; resource?: HanddrawResource; disabled: boolean; url: (path: string) => string; beforeChange: () => Promise<void>; onResources: (resources: HanddrawResourcesSnapshot) => void; onInvalidate: () => Promise<void>; onBusyChange: (busy: boolean) => void};
const labels = {waiting: "待上传", processing: "正在分析线条与色块…", ready: "绘制计划已就绪", failed: "处理失败"};

// 独立轮询手绘任务，主任务停在人工审核时也能收到后台分析结果。
export const HanddrawResources = ({jobId, sceneId, scene, resource, disabled, url, beforeChange, onResources, onInvalidate, onBusyChange}: Props) => {
  const endpoint = `/api/jobs/${encodeURIComponent(jobId)}/scenes/${encodeURIComponent(sceneId)}/handdraw`;
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [prompts, setPrompts] = useState<{lineart: string; color: string} | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  // 用真实按钮触发文件选择，保留键盘操作与禁用状态。
  const uploadInputs = useRef<Partial<Record<"lineart" | "color", HTMLInputElement | null>>>({});
  const hasResource = Boolean(resource);
  // 上传或保存尚未完成时锁住规划确认，避免沿用替换前的绘制计划。
  useEffect(() => {onBusyChange(busy); return () => onBusyChange(false);}, [busy, onBusyChange]);
  const current = useRef({onResources, onInvalidate}); current.current = {onResources, onInvalidate};
  useEffect(() => {
    const controller = new AbortController();
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(endpoint, {cache: "no-store", signal: controller.signal});
        const result = await response.json() as {resources?: HanddrawResourcesSnapshot; error?: string};
        if (!response.ok) throw new Error(result.error ?? "读取手绘状态失败");
        if (active && result.resources) current.current.onResources(result.resources);
      } catch (cause) {if (active) setError(cause instanceof Error ? cause.message : "读取手绘状态失败");}
      if (active) timer = setTimeout(() => void poll(), 2000);
    };
    // 新拆分镜头在保存之前没有服务端资源，不提前请求不存在的镜头。
    if (hasResource) void poll();
    return () => {active = false; controller.abort(); clearTimeout(timer);};
  }, [endpoint, hasResource]);

  const change = async (kind?: "lineart" | "color", file?: File, remove = false) => {
    setBusy(true); setError(""); setNotice("");
    try {
      await beforeChange();
      let body: FormData | string | undefined;
      if (file && kind) { const form = new FormData(); form.set("kind", kind); form.set("image", file); body = form; }
      else if (remove) body = JSON.stringify({kind});
      const response = await fetch(endpoint, {method: remove ? "DELETE" : "POST", ...(typeof body === "string" ? {headers: {"Content-Type": "application/json"}} : {}), body});
      const result = await response.json() as {resources?: HanddrawResourcesSnapshot; error?: string};
      if (!response.ok || !result.resources) throw new Error(result.error ?? "手绘素材保存失败");
      onResources(result.resources);
      await onInvalidate();
    } catch (cause) {setError(cause instanceof Error ? cause.message : "手绘素材保存失败");}
    finally {setBusy(false);}
  };
  const openPrompts = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      await beforeChange();
      const response = await fetch(`${endpoint}?prompts=1`, {cache: "no-store"});
      const result = await response.json() as {lineart?: string; color?: string; error?: string};
      if (!response.ok || !result.lineart || !result.color) throw new Error(result.error ?? "读取手绘提示词失败");
      setPrompts({lineart: result.lineart, color: result.color}); setPromptOpen(true);
    } catch (cause) {setError(cause instanceof Error ? cause.message : "读取手绘提示词失败");}
    finally {setBusy(false);}
  };
  const copy = async (text: string) => {
    try {await navigator.clipboard.writeText(text); setNotice("已复制提示词");}
    catch {setNotice("复制失败，请手动选择提示词");}
  };
  const locked = disabled || busy;
  const timingStatus = (() => {
    if (!resource?.data || resource.status !== "ready") return null;
    try {
      const timing = handdrawTiming(scene, resource.data);
      return {error: false, text: `按当前镜头编排：描线与上色合计 ${(timing.drawDurationMs / 1000).toFixed(1)} 秒，成图展示 ${(timing.holdMs / 1000).toFixed(1)} 秒，额外加速 ${timing.acceleration.toFixed(1)} 倍。`};
    } catch (cause) {return {error: true, text: cause instanceof Error ? cause.message : "镜头时间不足，请简化配图"};}
  })();
  return <section className="visual-plan-image-resources" aria-label="当前镜头手绘素材">
    <div className="visual-plan-section-heading"><h3>手绘插画</h3><span role="status">{labels[resource?.status ?? "waiting"]}</span></div>
    <p className="field-hint">先生成线稿，再将线稿附给外部模型上色。上传两图后自动处理，先描线再涂色，最后停留展示成图。</p>
    <div className="actions"><button type="button" className="secondary" disabled={locked} onClick={() => void openPrompts()}>查看生成提示词</button>
      {resource?.lineart && resource.color ? <button type="button" disabled={locked || resource.status === "processing"} onClick={() => void change()}>{resource.status === "failed" ? "重试处理" : "重新处理"}</button> : null}
    </div>
    <div style={{display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16}}>
      {(["lineart", "color"] as const).map((kind) => <div key={kind}>
        {/* 标题旁集中放置图标操作，提示中明确图片类型与上传或替换状态。 */}
        <div className="handdraw-resource-heading">
          <h4>{kind === "lineart" ? "黑白线稿" : "上色图"}</h4>
          <button type="button" className="secondary handdraw-resource-action" title={`${resource?.[kind] ? "替换" : "上传"}${kind === "lineart" ? "黑白线稿" : "上色图"}`} aria-label={`${resource?.[kind] ? "替换" : "上传"}${kind === "lineart" ? "黑白线稿" : "上色图"}`} disabled={locked} onClick={() => uploadInputs.current[kind]?.click()}><Icon name="upload" size={18} /></button>
          {resource?.[kind] ? <button type="button" className="secondary handdraw-resource-action" title={`删除${kind === "lineart" ? "黑白线稿" : "上色图"}`} aria-label={`删除${kind === "lineart" ? "黑白线稿" : "上色图"}`} disabled={locked} onClick={() => void change(kind, undefined, true)}><Icon name="trash" size={18} /></button> : null}
        </div>
        <input ref={(element) => {uploadInputs.current[kind] = element;}} hidden type="file" accept="image/png,image/jpeg,image/webp" disabled={locked} onChange={(event) => {const file = event.currentTarget.files?.[0]; if (file) void change(kind, file); event.currentTarget.value = "";}} />
        {resource?.[kind] ? <img src={url(resource[kind]!.path)} alt={kind === "lineart" ? "手绘黑白线稿" : "手绘上色图"} style={{display: "block", width: "100%", marginTop: 12, background: "white"}} /> : null}
      </div>)}
    </div>
    {resource?.status === "ready" && resource.data ? <div><p>参考绘制时间：{(resource.data.minimumDrawMs / 1000).toFixed(1)} 秒。</p>{timingStatus ? <p className={timingStatus.error ? "error-text" : "field-hint"} role={timingStatus.error ? "alert" : "status"}>{timingStatus.text}</p> : null}<img src={url(resource.data.completePath)} alt="配准后的手绘完成图" style={{maxWidth: "100%", maxHeight: 400, objectFit: "contain"}} /></div> : null}
    {resource?.error ? <p className="error-text" role="alert">{resource.error}</p> : null}
    {error ? <p className="error-text" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {promptOpen && prompts ? <div className="confirm-overlay" role="presentation" onClick={() => setPromptOpen(false)} onKeyDown={(event) => {if (event.key === "Escape") setPromptOpen(false);}}>
      <section className="confirm-dialog panel visual-plan-requirement-dialog" role="dialog" aria-modal="true" aria-label="手绘生成提示词" onClick={(event) => event.stopPropagation()}>
        <div className="visual-requirement-dialog-header"><h2>手绘生成提示词</h2><button type="button" className="secondary" onClick={() => setPromptOpen(false)}>关闭</button></div>
        <p className="field-hint">上色时必须附上第一步的线稿，保持原尺寸与构图。</p>
        {(["lineart", "color"] as const).map((kind) => <div key={kind}><h3>{kind === "lineart" ? "第一步：线稿" : "第二步：上色编辑"}</h3><textarea readOnly rows={6} value={prompts[kind]} aria-label={`${kind} 提示词`} /><button type="button" className="secondary" onClick={() => void copy(prompts[kind])}>复制提示词</button></div>)}
        {notice ? <p role="status">{notice}</p> : null}
      </section>
    </div> : null}
  </section>;
};
