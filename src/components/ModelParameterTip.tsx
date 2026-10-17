"use client";
import {useEffect, useId, useRef, useState} from "react";
import {createPortal} from "react-dom";

// 浮层挂到 body，避免被可滚动的参数面板裁切；提示按钮不触发外层 label 的输入操作。
export const ModelParameterTip = ({text}: {text: string}) => {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{left: number; top: number; above: boolean} | null>(null);
  const show = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(280, window.innerWidth - 24);
    const above = rect.bottom > window.innerHeight - 160;
    setPosition({left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: above ? rect.top - 8 : rect.bottom + 8, above});
  };
  useEffect(() => {
    if (!position) return;
    const dismiss = () => setPosition(null);
    const outside = (event: PointerEvent) => {if (!button.current?.contains(event.target as Node)) dismiss();};
    const escape = (event: KeyboardEvent) => {if (event.key === "Escape") {event.stopPropagation(); dismiss();}};
    window.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("keydown", escape, true);
    };
  }, [position]);
  return <><button ref={button} type="button" className="model-parameter-tip" aria-label="查看参数说明" aria-describedby={position ? id : undefined} onMouseEnter={show} onMouseLeave={() => setPosition(null)} onFocus={show} onBlur={() => setPosition(null)} onClick={(event) => {event.preventDefault(); event.stopPropagation(); show();}}>ⓘ</button>{position ? createPortal(<span id={id} role="tooltip" className="model-parameter-tooltip" style={{left: position.left, top: position.top, transform: position.above ? "translateY(-100%)" : undefined}}>{text}</span>, document.body) : null}</>;
};
