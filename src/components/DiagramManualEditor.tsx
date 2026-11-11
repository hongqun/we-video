"use client";
import {useEffect, useId, useMemo, useRef, useState} from "react";
import {diagramSvgAtFrame, type DiagramData} from "@/remotion/templates/auto-diagram-schema";
import {diagramLinePoints, setDiagramLinePoints, type DiagramPoint} from "@/lib/diagram/manual-geometry";
import {DiagramColorPicker, diagramPaintOf} from "./DiagramColorPicker";

type Props = {data: DiagramData; busy: boolean; disabled: boolean; errors: string[]; onDirty: (dirty: boolean) => void; onSave: (data: DiagramData, baseData: DiagramData) => Promise<DiagramData | null>};
// 只编辑既有 SVG 分组与属性，保留 ID、口播绑定和文字的 tspan 排版结构。
const readSvg = (svg: string) => new DOMParser().parseFromString(svg, "image/svg+xml");
const writeSvg = (doc: Document) => new XMLSerializer().serializeToString(doc.documentElement);
const editableElements = (group: Element | null) => group ? Array.from(group.querySelectorAll("text, tspan, rect, circle, ellipse, path, line, polyline, polygon")).filter((element) => !element.children.length && !element.closest("[data-manual-overlay]")) : [];
export function DiagramManualEditor({data, busy, disabled, errors, onDirty, onSave}: Props) {
  const namespace = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [baseData, setBaseData] = useState(data);
  const [history, setHistory] = useState([data.svg]);
  const [groupId, setGroupId] = useState(data.bindings[0]?.groupId ?? "opening");
  const [elementIndex, setElementIndex] = useState(0);
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{group: SVGGElement; groupId: string; x: number; y: number; transform: string; inverse: DOMMatrix; dx: number; dy: number} | null>(null);
  const pointDrag = useRef<{element: SVGGraphicsElement; groupId: string; elementIndex: number; pointIndex: number; points: DiagramPoint[]; original: Element; inverse: DOMMatrix; handle: Element; moved: boolean} | null>(null);
  const svg = history[history.length - 1]!;
  const dirty = svg !== baseData.svg;
  const locked = busy || disabled;
  useEffect(() => {onDirty(dirty);}, [dirty, onDirty]);
  const document = useMemo(() => readSvg(svg), [svg]);
  const group = document.getElementById(groupId);
  const elements = editableElements(group);
  const element = elements[elementIndex];
  const linePoints = element ? diagramLinePoints(element) : null;
  // 输入中的不完整属性只显示提示，不把未经白名单检查的 SVG 注入页面。
  const preview = useMemo(() => {
    try {return {svg: diagramSvgAtFrame({...data, svg}, [], 0, true, namespace), error: ""};}
    catch (cause) {return {svg: "", error: cause instanceof Error ? cause.message : "图表属性无效"};}
  }, [data, svg, namespace]);
  useEffect(() => {
    const root = canvas.current?.querySelector("svg");
    if (!root) return;
    const overlays: Element[] = [];
    // 透明加宽命中线只存在于编辑预览，不写回 SVG；细线和箭头均可直接点击。
    for (const id of ["opening", ...data.bindings.map((binding) => binding.groupId)]) {
      const owner = root.querySelector(`[id="${namespace}-${id}"]`);
      for (const [index, original] of editableElements(owner).entries()) {
        if (!["path", "line", "polyline"].includes(original.tagName)) continue;
        const hit = original.cloneNode(false) as Element;
        for (const name of ["id", "marker-start", "marker-mid", "marker-end", "class", "style"]) hit.removeAttribute(name);
        hit.setAttribute("data-manual-overlay", "hit"); hit.setAttribute("data-manual-element", String(index));
        hit.setAttribute("fill", "none"); hit.setAttribute("stroke", "transparent"); hit.setAttribute("stroke-opacity", "1");
        hit.setAttribute("stroke-width", "16"); hit.setAttribute("vector-effect", "non-scaling-stroke");
        hit.setAttribute("pointer-events", "stroke");
        original.parentNode?.appendChild(hit); overlays.push(hit);
      }
    }
    return () => {overlays.forEach((overlay) => overlay.remove());};
  }, [preview, namespace, data.bindings]);
  useEffect(() => {
    const selected = canvas.current?.querySelector(`[id="${namespace}-${groupId}"]`);
    selected?.classList.add("diagram-manual-selected");
    const original = editableElements(selected ?? null)[elementIndex];
    const points = original ? diagramLinePoints(original) : null;
    let handles: Element | undefined;
    if (original && points) {
      handles = globalThis.document.createElementNS("http://www.w3.org/2000/svg", "g");
      handles.setAttribute("data-manual-overlay", "handles");
      if (original.hasAttribute("transform")) handles.setAttribute("transform", original.getAttribute("transform")!);
      points.forEach((point, index) => {
        const handle = globalThis.document.createElementNS("http://www.w3.org/2000/svg", "circle");
        handle.setAttribute("cx", String(point.x)); handle.setAttribute("cy", String(point.y)); handle.setAttribute("r", "5");
        handle.setAttribute("class", "diagram-manual-point"); handle.setAttribute("data-manual-point", String(index));
        handle.setAttribute("data-manual-element", String(elementIndex));
        handles!.appendChild(handle);
      });
      original.parentNode?.appendChild(handles);
    }
    return () => {selected?.classList.remove("diagram-manual-selected"); handles?.remove();};
  }, [groupId, elementIndex, preview, namespace]);
  const commit = (next: string) => {if (next !== svg) setHistory((old) => [...old.slice(-59), next]);};
  const updateElement = (attribute: string, value: string) => {
    if (!element || locked) return;
    if (attribute === "text") element.textContent = value;
    else if (value) element.setAttribute(attribute, value);
    else element.removeAttribute(attribute);
    if (attribute === "stroke") {
      // 箭头尖随线身改色；共享 marker 先复制，避免其他连线被连带修改。
      for (const key of ["marker-start", "marker-end", "marker-mid"]) {
        const reference = /^url\(#([^()]+)\)$/.exec(element.getAttribute(key) ?? "");
        const marker = reference ? document.getElementById(reference[1]!) : null;
        if (!marker) continue;
        const prefix = `manual-${key.slice(7)}-${groupId.slice(0, 24)}-${elementIndex}`;
        let id = prefix, suffix = 0;
        while (document.getElementById(id) && id !== reference![1]) id = `${prefix}-${++suffix}`;
        const copy = marker.cloneNode(true) as Element;
        copy.setAttribute("id", id);
        for (const child of Array.from(copy.querySelectorAll("*"))) {
          child.removeAttribute("id");
          if (child.getAttribute("fill") !== "none") child.setAttribute("fill", diagramPaintOf(element, "stroke"));
          if (child.hasAttribute("stroke") && child.getAttribute("stroke") !== "none") child.setAttribute("stroke", diagramPaintOf(element, "stroke"));
        }
        if (id === reference![1]) marker.replaceWith(copy); else marker.parentNode?.appendChild(copy);
        element.setAttribute(key, `url(#${id})`);
      }
    }
    commit(writeSvg(document));
  };
  const moveGroup = (dx: number, dy: number) => {
    if (!group || locked) return;
    group.setAttribute("transform", `translate(${dx} ${dy}) ${group.getAttribute("transform") ?? ""}`.trim());
    commit(writeSvg(document));
  };
  const finishDrag = (cancel = false) => {
    const control = pointDrag.current;
    if (control) {
      pointDrag.current = null;
      for (const name of ["d", "points", "x1", "y1", "x2", "y2"]) if (control.original.hasAttribute(name)) control.element.setAttribute(name, control.original.getAttribute(name)!);
      if (!cancel && control.moved) {
        const doc = readSvg(svg);
        const target = editableElements(doc.getElementById(control.groupId))[control.elementIndex];
        if (target) {setDiagramLinePoints(target, control.points); commit(writeSvg(doc));}
      } else {
        const originalPoints = diagramLinePoints(control.original)!;
        control.handle.setAttribute("cx", String(originalPoints[control.pointIndex]!.x)); control.handle.setAttribute("cy", String(originalPoints[control.pointIndex]!.y));
      }
      return;
    }
    const movement = drag.current;
    if (!movement) return;
    drag.current = null;
    movement.group.setAttribute("transform", movement.transform);
    if (!cancel && (movement.dx || movement.dy)) {
      const doc = readSvg(svg);
      const target = doc.getElementById(movement.groupId);
      target?.setAttribute("transform", `translate(${movement.dx} ${movement.dy}) ${target.getAttribute("transform") ?? ""}`.trim());
      commit(writeSvg(doc));
    }
  };
  return <div className="diagram-manual-editor">
    <section className="diagram-manual-workspace" aria-label="手工调整画布">
      <p className="auto-diagram-hint">拖动分组可移动位置；选中连线后拖动圆点可调整起点、终点与折点。移动节点后需同步调整连线。</p>
      <div className="diagram-manual-viewport">
        <div ref={canvas} className="auto-diagram-full diagram-manual-canvas" aria-label="可拖动的完整图表"
          onPointerDown={(event) => {
            if (locked || event.button !== 0 || !(event.target instanceof Element)) return;
            // 可见元素可能还有内部 g，向上找到真正拥有口播绑定的分组。
            let target = event.target.closest<SVGGElement>("g[id]");
            while (target && target.id !== `${namespace}-opening` && !data.bindings.some((binding) => target!.id === `${namespace}-${binding.groupId}`)) target = target.parentElement?.closest<SVGGElement>("g[id]") ?? null;
            if (!target || !target.id.startsWith(`${namespace}-`)) return;
            const id = target.id.slice(namespace.length + 1);
            if (id !== "opening" && !data.bindings.some((binding) => binding.groupId === id)) return;
            const clickedIndex = event.target.getAttribute("data-manual-element");
            const index = clickedIndex === null ? Math.max(0, editableElements(target).indexOf(event.target)) : Number(clickedIndex);
            setGroupId(id); setElementIndex(index);
            const pointIndex = event.target.getAttribute("data-manual-point");
            if (pointIndex !== null) {
              const original = editableElements(target)[index] as SVGGraphicsElement | undefined;
              const points = original ? diagramLinePoints(original) : null;
              const matrix = original?.getScreenCTM();
              if (!original || !points || !matrix) return;
              pointDrag.current = {element: original, groupId: id, elementIndex: index, pointIndex: Number(pointIndex), points, original: original.cloneNode(false) as Element, inverse: matrix.inverse(), handle: event.target, moved: false};
              event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); return;
            }
            // 使用父坐标系换算位移，缩放预览和已有 transform 都不会导致拖动跳跃。
            const parent = target.parentElement as unknown as SVGGraphicsElement;
            const matrix = parent.getScreenCTM?.();
            if (!matrix) return;
            drag.current = {group: target, groupId: id, x: event.clientX, y: event.clientY, transform: target.getAttribute("transform") ?? "", inverse: matrix.inverse(), dx: 0, dy: 0};
            event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
          }}
          onPointerMove={(event) => {
            const control = pointDrag.current;
            if (control) {
              const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(control.inverse);
              const position = {x: Math.round(point.x), y: Math.round(point.y)};
              control.points[control.pointIndex] = position; control.moved = true;
              setDiagramLinePoints(control.element, control.points);
              control.handle.setAttribute("cx", String(position.x)); control.handle.setAttribute("cy", String(position.y)); return;
            }
            const movement = drag.current;
            if (!movement) return;
            const from = new DOMPoint(movement.x, movement.y).matrixTransform(movement.inverse);
            const to = new DOMPoint(event.clientX, event.clientY).matrixTransform(movement.inverse);
            movement.dx = Math.round(to.x - from.x); movement.dy = Math.round(to.y - from.y);
            movement.group.setAttribute("transform", `translate(${movement.dx} ${movement.dy}) ${movement.transform}`.trim());
          }} onPointerUp={() => finishDrag()} onPointerCancel={() => finishDrag(true)} onLostPointerCapture={() => finishDrag(true)} dangerouslySetInnerHTML={{__html: preview.svg}} />
      </div>
    </section>
    <aside className="diagram-manual-properties" aria-label="图表手工属性">
      <h4>手工调整</h4>
      <label>分组<select value={groupId} disabled={locked} onChange={(event) => {setGroupId(event.target.value); setElementIndex(0);}}>
        {document.getElementById("opening") ? <option value="opening">开场元素</option> : null}
        {data.bindings.map((binding) => <option key={binding.groupId} value={binding.groupId}>{binding.name}</option>)}
      </select></label>
      <div className="diagram-manual-nudge" aria-label="移动分组">
        {[["←", -1, 0], ["↑", 0, -1], ["↓", 0, 1], ["→", 1, 0]].map(([label, dx, dy]) => <button key={label} className="secondary" type="button" disabled={locked || !group} title="移动 1 像素，按住 Shift 移动 10 像素" aria-label={`向${label}移动分组`} onClick={(event) => moveGroup(Number(dx) * (event.shiftKey ? 10 : 1), Number(dy) * (event.shiftKey ? 10 : 1))}>{label}</button>)}
      </div>
      <label>元素<select value={elementIndex} disabled={locked || !elements.length} onChange={(event) => setElementIndex(Number(event.target.value))}>
        {elements.map((item, index) => <option key={index} value={index}>{index + 1}. {item.tagName === "text" || item.tagName === "tspan" ? item.textContent : item.tagName}</option>)}
      </select></label>
      {element ? <>
        {["text", "tspan"].includes(element.tagName) ? <>
          <label>文字<input value={element.textContent ?? ""} disabled={locked} onChange={(event) => updateElement("text", event.target.value)} /></label>
          <label>字号<input type="number" min={1} max={200} placeholder="继承原字号" value={element.getAttribute("font-size") ?? ""} disabled={locked} onChange={(event) => {if (!event.target.value || Number(event.target.value) > 0) updateElement("font-size", event.target.value);}} /></label>
        </> : null}
        <DiagramColorPicker element={element} attribute="fill" disabled={locked} onChange={(value) => updateElement("fill", value)} />
        <DiagramColorPicker element={element} attribute="stroke" disabled={locked} onChange={(value) => updateElement("stroke", value)} />
        {linePoints ? <fieldset className="diagram-manual-route"><legend>连线控制点</legend>{linePoints.map((point, index) => <div key={index}><span>{index === 0 ? "起点" : index === linePoints.length - 1 ? "终点" : `折点 ${index}`}</span>{(["x", "y"] as const).map((axis) => <label key={axis}>{axis.toUpperCase()}<input type="number" aria-label={`控制点 ${index + 1} ${axis.toUpperCase()}`} value={point[axis]} disabled={locked} onChange={(event) => {
          if (!event.target.value || !Number.isFinite(Number(event.target.value))) return;
          const points = linePoints.map((old, i) => i === index ? {...old, [axis]: Number(event.target.value)} : old);
          setDiagramLinePoints(element, points); commit(writeSvg(document));
        }} /></label>)}</div>)}</fieldset> : null}
      </> : null}
      <div className="auto-diagram-actions"><button type="button" className="secondary" disabled={locked || history.length < 2} onClick={() => setHistory((old) => old.slice(0, -1))}>撤销</button><button type="button" className="secondary" disabled={locked || !dirty} onClick={() => setHistory([baseData.svg])}>重置</button></div>
      <p className="auto-diagram-binding-state" role="status" data-invalid={Boolean(preview.error || errors.length)}>{preview.error || (errors.length ? errors.join("；") : dirty ? "有未保存的手工调整" : "已保存，可返回口播同步预览。")}</p>
      <button type="button" className="primary" disabled={locked || Boolean(preview.error) || (!dirty && !errors.length)} onClick={async () => {
        const saved = await onSave({...data, svg}, baseData);
        if (saved) {setBaseData(saved); setHistory([saved.svg]); onDirty(false);}
      }}>{busy ? "保存校验中…" : "保存并校验图表"}</button>
    </aside>
  </div>;
}
