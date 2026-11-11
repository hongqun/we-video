"use client";
import {useMemo} from "react";

// 沿 SVG 祖先读取继承色；取色器改色时保留已有 RGBA 透明度。
export function diagramPaintOf(element: Element, attribute: string) {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const value = current.getAttribute(attribute);
    if (value && value !== "inherit") return value;
  }
  return attribute === "fill" ? "#000000" : "none";
}
export function DiagramColorPicker({element, attribute, disabled, onChange}: {element: Element; attribute: "fill" | "stroke"; disabled: boolean; onChange: (value: string) => void}) {
  const paint = diagramPaintOf(element, attribute);
  const color = useMemo(() => {
    const context = document.createElement("canvas").getContext("2d");
    if (!context || paint === "none" || paint.startsWith("url(")) return {hex: "#20352a", alpha: 1};
    context.fillStyle = paint; context.fillRect(0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    return {hex: `#${Array.from(pixel.slice(0, 3)).map((value) => value.toString(16).padStart(2, "0")).join("")}`, alpha: pixel[3]! / 255};
  }, [paint]);
  const label = attribute === "fill" ? "填充颜色" : "描边颜色";
  return <div className="diagram-manual-color"><label>{label}<input type="color" aria-label={label} value={color.hex} disabled={disabled} onChange={(event) => {
    const hex = event.target.value;
    onChange(color.alpha > 0 && color.alpha < 1 ? `rgba(${[1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)).join(", ")}, ${Number(color.alpha.toFixed(3))})` : hex);
  }} /></label><div className="auto-diagram-actions">
    <button className="secondary" type="button" disabled={disabled} aria-pressed={paint === "none"} onClick={() => onChange("none")}>无颜色</button>
    <button className="secondary" type="button" disabled={disabled || !element.hasAttribute(attribute)} onClick={() => onChange("")}>继承</button>
  </div></div>;
}
