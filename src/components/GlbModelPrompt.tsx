"use client";
import {useEffect, useRef, useState} from "react";
import type {GlbPromptResult} from "@/lib/glb-model-prompt";

type Props = {jobId: string; segmentId: string; spokenText: string; disabled?: boolean};

// 窗口卸载即丢弃结果；每次打开、切换上下文或重新生成均读取最新模板。
export const GlbModelPrompt = (props: Props) => {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="secondary" disabled={props.disabled} title="查看并复制专题定义的 GLB 生成提示词，无需先上传模型。" onClick={() => setOpen(true)}>查看 GLB 提示词</button>{open ? <GlbPromptDialog {...props} onClose={() => setOpen(false)} /> : null}</>;
};

const GlbPromptDialog = ({jobId, segmentId, spokenText, onClose}: Props & {onClose: () => void}) => {
  const [includeNarration, setIncludeNarration] = useState(true);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<GlbPromptResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const dialog = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {document.body.style.overflow = overflow; previousFocus?.focus();};
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setResult(null); setError(""); setCopyStatus("idle");
    const load = async () => {
      try {
        const response = await fetch(`/api/model-prompts/${encodeURIComponent(jobId)}`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({segmentId, spokenText, includeNarration}), signal: controller.signal});
        const value = await response.json() as Partial<GlbPromptResult> & {error?: string};
        if (!response.ok || !value.prompt || !value.templateSource) throw new Error(value.error ?? "读取 GLB 提示词失败，请重试");
        if (!controller.signal.aborted) setResult({prompt: value.prompt, templateSource: value.templateSource});
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取 GLB 提示词失败");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [jobId, segmentId, spokenText, includeNarration, revision]);
  const copy = async () => {
    if (!result) return;
    try {await navigator.clipboard.writeText(result.prompt); setCopyStatus("copied");}
    catch {setCopyStatus("failed"); text.current?.focus(); text.current?.select();}
  };
  return <div className="confirm-overlay" onClick={onClose}><div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="glb-prompt-title" tabIndex={-1} className="confirm-dialog panel visual-requirement-dialog glb-prompt-dialog" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
    if (event.key === "Escape") {event.stopPropagation(); onClose();}
    if (event.key === "Tab") {
      const nodes = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea');
      const first = nodes?.[0], last = nodes?.[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {event.preventDefault(); last?.focus();}
      else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}
    }
  }}>
    <div className="visual-requirement-dialog-header"><h2 id="glb-prompt-title">GLB 提示词</h2><button type="button" className="secondary" onClick={onClose}>关闭</button></div>
    <p className="field-hint">复制提示词，并在外部生成工具中上传参考图片；生成后将 GLB 上传回来。</p>
    <label className="glb-prompt-context"><input type="checkbox" checked={includeNarration} onChange={(event) => setIncludeNarration(event.target.checked)} />附带当前镜头口播</label>
    <div className="glb-prompt-body" aria-busy={loading}>
      {loading ? <p role="status">正在读取模板…</p> : error ? <p role="alert" className="error-text">{error}</p> : result ? <><p className="metadata">模板来源：{result.templateSource}</p><textarea ref={text} aria-label="GLB 生成提示词，可手动选择复制" readOnly value={result.prompt} spellCheck={false} /></> : null}
    </div>
    <div className="actions"><button type="button" disabled={loading || !result} onClick={() => void copy()}>复制</button><button type="button" className="secondary" disabled={loading} onClick={() => setRevision((previous) => previous + 1)}>{error ? "重试" : "重新生成"}</button><span role="status">{copyStatus === "copied" ? "已复制" : copyStatus === "failed" ? "复制失败，已选中文本，请手动复制。" : ""}</span></div>
  </div></div>;
};
