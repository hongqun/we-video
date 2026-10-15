"use client";

import {useRef, useState} from "react";
import type {TranslationReview as Review, TranslationText} from "@/lib/translation-review";
import {Icon} from "./Icon";

type Props = {
  review: Review;
  state: string;
  progress?: string;
  busy: boolean;
  notice: string | null;
  onAction: (action: "save" | "generate" | "confirm", translated: TranslationText) => Promise<void>;
};

export const TranslationReview = ({review, state, progress, busy, notice, onAction}: Props) => {
  // 父组件以保存时间作为 key：仅已保存内容变化时重置，不受任务进度轮询影响。
  const [translated, setTranslated] = useState(review.translated);
  const chineseTextRef = useRef<HTMLTextAreaElement>(null);
  const englishTextRef = useRef<HTMLTextAreaElement>(null);
  const syncedScrollPositions = useRef(new WeakMap<HTMLTextAreaElement, number>());
  const syncScroll = (source: HTMLTextAreaElement, target: HTMLTextAreaElement | null) => {
    // 忽略程序同步触发的滚动事件，避免两栏因像素取整反复回推、抖动。
    const expected = syncedScrollPositions.current.get(source);
    syncedScrollPositions.current.delete(source);
    if (expected !== undefined && Math.abs(source.scrollTop - expected) < 1) return;
    if (!target) return;
    const sourceRange = source.scrollHeight - source.clientHeight;
    const targetRange = target.scrollHeight - target.clientHeight;
    if (sourceRange <= 0 || targetRange <= 0) return;
    // 中英文长度和换行不同，按各自可滚动范围的比例对齐阅读进度。
    const ratio = Math.max(0, Math.min(1, source.scrollTop / sourceRange));
    const nextTop = ratio * targetRange;
    if (Math.abs(target.scrollTop - nextTop) < 1) return;
    target.scrollTop = nextTop;
    syncedScrollPositions.current.set(target, target.scrollTop);
  };
  const working = state === "translating" || state === "segmenting_translation";
  const confirmed = Boolean(review.confirmedAt);
  const locked = busy || working || confirmed;
  const changed = JSON.stringify(translated) !== JSON.stringify(review.translated);
  // 正文未改时复用已完成分段；编辑正文后仍需重新确认并分段。
  const retryVisual = review.failedStage === "visual" && translated.text === review.translated.text;
  const update = (field: keyof TranslationText, value: string) => setTranslated((current) => ({...current, [field]: value}));
  const regenerate = () => {
    if ((changed || translated.text.trim()) && !window.confirm("重新翻译会覆盖当前英文稿，是否继续？")) return;
    void onAction("generate", translated);
  };
  const metadata = [{key: "title", label: "标题"}, {key: "shortTitle", label: "短标题"}, {key: "summary", label: "摘要"}] as const;

  return <section className="panel translation-review" aria-busy={busy || working}>
    <div className="panel-heading">
      <div>
        <p className="review-section-label">第 1 步 · 翻译对照</p>
        <h2>{confirmed ? "已确认的全文译稿" : "确认英文口播全文"}</h2>
        <p className="hint">{confirmed ? "这里保留确认时的全文记录，后续修改请在第二步进行。" : "先核对完整译稿；认可后再按原镜头分段。"}</p>
      </div>
      <span className="status">{working ? state === "translating" ? "翻译中" : retryVisual ? "画面翻译中" : "分段与画面翻译中" : confirmed ? "已确认" : changed ? "有未保存修改" : "待确认"}</span>
    </div>
    {working ? <p className="translation-progress" role="status"><Icon name="sparkles" />{progress || (state === "translating" ? "正在翻译完整口播稿…" : "正在按原镜头分段…")}</p> : null}
    <div className="translation-columns">
      <div className="translation-column">
        <h3>原中文口播</h3>
        {metadata.map(({key, label}) => <label key={key}>{label}
          {key === "summary" ? <textarea rows={3} readOnly value={review.source[key]} /> : <input readOnly value={review.source[key]} />}
        </label>)}
        <label>中文全文<textarea ref={chineseTextRef} onScroll={(event) => syncScroll(event.currentTarget, englishTextRef.current)} className="translation-fulltext" rows={22} readOnly value={review.source.text} /></label>
      </div>
      <div className="translation-column">
        <h3>英文译稿</h3>
        {metadata.map(({key, label}) => <label key={key}>{label}
          {key === "summary" ? <textarea lang="en" rows={3} readOnly={confirmed} disabled={busy || working} value={translated[key]} onChange={(event) => update(key, event.target.value)} /> : <input lang="en" readOnly={confirmed} disabled={busy || working} value={translated[key]} onChange={(event) => update(key, event.target.value)} />}
        </label>)}
        <label>英文全文<textarea ref={englishTextRef} onScroll={(event) => syncScroll(event.currentTarget, chineseTextRef.current)} lang="en" className="translation-fulltext" rows={22} readOnly={confirmed} disabled={busy || working} value={translated.text} onChange={(event) => update("text", event.target.value)} placeholder={working ? "翻译完成后可修改或粘贴替换" : "在这里编辑译稿，或粘贴你自己的英文翻译稿"} /></label>
      </div>
    </div>
    {notice ? <p className="script-edit-notice" role="status">{notice}</p> : null}
    {!confirmed ? <div className="actions translation-actions">
      <button className="secondary" disabled={locked} onClick={regenerate}><Icon name="refresh" />重新翻译</button>
      <button className="secondary" disabled={locked || !changed} onClick={() => void onAction("save", translated)}>保存译稿</button>
      <button disabled={locked || !translated.title.trim() || !translated.text.trim()} onClick={() => void onAction("confirm", translated)}><Icon name="arrow-right" />{retryVisual ? "重试画面翻译" : "确认并分段"}</button>
    </div> : null}
  </section>;
};
