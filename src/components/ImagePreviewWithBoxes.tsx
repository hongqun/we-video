"use client";

import {useEffect, useRef, useState} from "react";

type Point = {x: number; y: number};
type Polygon = {text: string; points: Point[]};
const MAX_POINTS = 64;
const MIN_DRAW_LENGTH = 0.08;
const MIN_DRAW_AREA = 0.0001;

const validPolygons = (value: unknown): Polygon[] => {
  const raw = Array.isArray(value) ? value : [];
  return raw.filter((item): item is Polygon => {
    if (!item || typeof item !== "object" || typeof (item as Polygon).text !== "string" || !Array.isArray((item as Polygon).points)) return false;
    const points = (item as Polygon).points;
    return points.length >= 3 && points.length <= MAX_POINTS && points.every((point) => point && typeof point.x === "number" && typeof point.y === "number" && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
  });
};

type Drag = {polygonIndex: number; pointIndex?: number; startX: number; startY: number; polygon: Polygon};

const distanceToSegment = (point: Point, start: Point, end: Point) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
};

// 自由描边会产生大量采样点，使用固定容差简化，保证相同轨迹得到相同顶点。
const simplifyPath = (points: Point[], tolerance: number): Point[] => {
  if (points.length <= 2) return points;
  const lastIndex = points.length - 1;
  let farthestIndex = -1;
  let farthestDistance = tolerance;
  for (let index = 1; index < lastIndex; index += 1) {
    const distance = distanceToSegment(points[index]!, points[0]!, points[lastIndex]!);
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthestIndex = index;
    }
  }
  if (farthestIndex < 0) return [points[0]!, points[lastIndex]!];
  const left = simplifyPath(points.slice(0, farthestIndex + 1), tolerance);
  const right = simplifyPath(points.slice(farthestIndex), tolerance);
  return [...left.slice(0, -1), ...right];
};

const polygonArea = (points: Point[]) => Math.abs(points.reduce((sum, point, index) => {
  const next = points[(index + 1) % points.length]!;
  return sum + point.x * next.y - next.x * point.y;
}, 0) / 2);

const orientation = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const pointOnSegment = (a: Point, b: Point, point: Point) => Math.abs(orientation(a, b, point)) < 1e-8 && point.x >= Math.min(a.x, b.x) - 1e-8 && point.x <= Math.max(a.x, b.x) + 1e-8 && point.y >= Math.min(a.y, b.y) - 1e-8 && point.y <= Math.max(a.y, b.y) + 1e-8;
const segmentsIntersect = (a: Point, b: Point, c: Point, d: Point) => {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return (abC * abD < 0 && cdA * cdB < 0) || (Math.abs(abC) < 1e-8 && pointOnSegment(a, b, c)) || (Math.abs(abD) < 1e-8 && pointOnSegment(a, b, d)) || (Math.abs(cdA) < 1e-8 && pointOnSegment(c, d, a)) || (Math.abs(cdB) < 1e-8 && pointOnSegment(c, d, b));
};

const hasSelfIntersection = (points: Point[]) => points.some((start, index) => {
  const end = points[(index + 1) % points.length]!;
  return points.some((otherStart, otherIndex) => {
    const otherEnd = points[(otherIndex + 1) % points.length]!;
    if (index === otherIndex || (index + 1) % points.length === otherIndex || (otherIndex + 1) % points.length === index) return false;
    return segmentsIntersect(start, end, otherStart, otherEnd);
  });
});

const simplifyFreehandPath = (points: Point[]) => {
  const deduplicated = points.filter((point, index) => index === 0 || Math.hypot(point.x - points[index - 1]!.x, point.y - points[index - 1]!.y) >= 0.002);
  if (deduplicated.length < 3) return deduplicated;
  let tolerance = 0.004;
  let simplified = simplifyPath(deduplicated, tolerance);
  while (simplified.length > MAX_POINTS && tolerance < 0.2) {
    tolerance *= 1.5;
    simplified = simplifyPath(deduplicated, tolerance);
  }
  if (simplified.length <= MAX_POINTS) return simplified;
  const stride = (simplified.length - 1) / (MAX_POINTS - 1);
  return Array.from({length: MAX_POINTS}, (_, index) => simplified[Math.round(index * stride)]!).filter((point, index, result) => index === 0 || point !== result[index - 1]);
};

const validateFreehandPolygon = (points: Point[]) => {
  if (points.length < 3) return "描边太短，请至少围出三个顶点";
  if (points.some((point) => point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) return "多边形顶点必须在图片范围内";
  if (polygonArea(points) < MIN_DRAW_AREA) return "描边区域太小，请扩大标注范围";
  if (hasSelfIntersection(points)) return "描边发生交叉，请重新沿边缘绘制";
  return null;
};

export const ImagePreviewWithBoxes = ({src, alt, imageWidth, imageHeight, polygons: rawPolygons, showBoxes, onBoxesChange, onBoxesCommit, onBoxesReorder, onBoxEdit, onBoxDelete, onBoxCreate}: {src: string; alt: string; imageWidth?: number; imageHeight?: number; polygons?: unknown; showBoxes: boolean; onBoxesChange?: (polygons: Polygon[]) => void; onBoxesCommit?: (polygons: Polygon[]) => void; onBoxesReorder?: (from: number, direction: "up" | "down") => void; onBoxEdit?: (index: number) => void; onBoxDelete?: (index: number) => void; onBoxCreate?: (points: Point[]) => void}) => {
  const polygons = validPolygons(rawPolygons);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const latestRef = useRef(polygons);
  const [imageRatio, setImageRatio] = useState<number | null>(imageWidth && imageHeight ? imageWidth / imageHeight : null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [drawing, setDrawing] = useState<Point[]>([]);
  const drawingRef = useRef<Point[]>([]);
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [drawError, setDrawError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{index: number; x: number; y: number} | null>(null);

  useEffect(() => {
    // 父级删除或保存后同步最新标注，避免下一次拖动提交旧数组。
    latestRef.current = polygons;
  }, [polygons]);

  const pointAt = (event: React.PointerEvent | React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))};
  };
  const updatePolygon = (event: React.PointerEvent, polygonIndex: number, pointIndex?: number) => {
    const point = pointAt(event);
    const polygon = polygons[polygonIndex];
    if (!point || !polygon) return;
    dragRef.current = {polygonIndex, pointIndex, startX: event.clientX, startY: event.clientY, polygon: {text: polygon.text, points: polygon.points.map((item) => ({...item}))}};
    setActiveIndex(polygonIndex); event.currentTarget.setPointerCapture(event.pointerId);
  };
  const movePolygon = (event: React.PointerEvent) => {
    const drag = dragRef.current; const rect = containerRef.current?.getBoundingClientRect();
    if (!drag || !rect) return;
    const dx = (event.clientX - drag.startX) / rect.width; const dy = (event.clientY - drag.startY) / rect.height;
    let points = drag.polygon.points;
    if (drag.pointIndex === undefined) points = points.map((point) => ({x: Math.max(0, Math.min(1, point.x + dx)), y: Math.max(0, Math.min(1, point.y + dy))}));
    else points = points.map((point, index) => index === drag.pointIndex ? {x: Math.max(0, Math.min(1, drag.polygon.points[index]!.x + dx)), y: Math.max(0, Math.min(1, drag.polygon.points[index]!.y + dy))} : point);
    const next = polygons.map((item, index) => index === drag.polygonIndex ? {...item, points} : item);
    latestRef.current = next; onBoxesChange?.(next);
  };
  const finishPolygon = () => { if (dragRef.current) onBoxesCommit?.(latestRef.current); dragRef.current = null; setActiveIndex(null); };
  const beginDrawing = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (!drawingEnabled || target.closest("g") || !target.closest("svg")) return;
    const point = pointAt(event);
    if (!point) return;
    drawingRef.current = [point];
    setDrawing([point]);
    setDrawError(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const appendDrawingPoint = (event: React.PointerEvent) => {
    if (dragRef.current) { movePolygon(event); return; }
    if (!drawingRef.current.length) return;
    const point = pointAt(event);
    const previous = drawingRef.current[drawingRef.current.length - 1];
    if (!point || !previous || Math.hypot(point.x - previous.x, point.y - previous.y) < 0.003) return;
    const next = [...drawingRef.current, point];
    drawingRef.current = next;
    setDrawing(next);
  };
  const finishDrawing = () => {
    if (!drawingRef.current.length) { finishPolygon(); return; }
    const rawPath = drawingRef.current;
    const pathLength = rawPath.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - rawPath[index]!.x, point.y - rawPath[index]!.y), 0);
    if (pathLength < MIN_DRAW_LENGTH) { setDrawError("描边太短，请按住鼠标沿目标边缘完整描绘"); return; }
    const simplified = simplifyFreehandPath(rawPath);
    const error = validateFreehandPolygon(simplified);
    if (error) { setDrawError(error); return; }
    drawingRef.current = [];
    setDrawing([]);
    setDrawingEnabled(false);
    onBoxCreate?.(simplified);
    setDrawError(null);
  };
  const cancelDrawing = () => { drawingRef.current = []; setDrawing([]); setDrawingEnabled(false); setDrawError(null); };
  const cancelPointer = () => { if (dragRef.current) finishPolygon(); else cancelDrawing(); };
  const openContextMenu = (event: React.MouseEvent<HTMLDivElement>) => { event.preventDefault(); const target = event.target as Element; if (target.closest("g") || !target.closest("svg")) return; setMenu({index: -1, x: event.clientX, y: event.clientY}); };
  return <div className="script-segment-image-preview" style={imageRatio ? {aspectRatio: String(imageRatio)} : undefined}>
    {/* 第四步是浏览器交互预览，保留原生图片以获得上传资源的即时尺寸。 */}
    {/* eslint-disable-next-line @remotion/warn-native-media-tag */}
    <img className="script-segment-uploaded-image" src={src} alt={alt} onLoad={(event) => { const image = event.currentTarget; if (image.naturalWidth && image.naturalHeight) setImageRatio(image.naturalWidth / image.naturalHeight); }} />
    {showBoxes ? <div ref={containerRef} className="script-segment-image-box-layer" aria-label="图片多边形标注" onPointerDown={beginDrawing} onContextMenu={openContextMenu} onPointerMove={appendDrawingPoint} onPointerUp={finishDrawing} onPointerCancel={cancelPointer}>
      <svg className="script-segment-polygon-svg" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
        {polygons.map((polygon, index) => <g key={`${polygon.text}-${index}`} className={`script-segment-polygon${activeIndex === index ? " is-active" : ""}`} onPointerDown={(event) => {event.stopPropagation(); updatePolygon(event, index);}} onContextMenu={(event) => {event.preventDefault(); setMenu({index, x: event.clientX, y: event.clientY});}} onPointerEnter={() => setHoveredIndex(index)} onPointerLeave={() => setHoveredIndex(null)}>
          <polygon points={polygon.points.map((point) => `${point.x},${point.y}`).join(" ")} />
          {polygon.points.map((point, pointIndex) => <circle key={pointIndex} cx={point.x} cy={point.y} r="0.007" className="script-segment-polygon-vertex" onPointerDown={(event) => {event.stopPropagation(); updatePolygon(event, index, pointIndex);}} />)}
          <foreignObject x={polygon.points[0]!.x} y={polygon.points[0]!.y} width="0.3" height="0.08" className="script-segment-polygon-label"><span><b>{index + 1}</b><em className={hoveredIndex === index || activeIndex === index ? "is-visible" : ""}>{polygon.text}</em></span></foreignObject>
        </g>)}
        {drawing.length ? <><polyline className="script-segment-polygon-drawing" points={drawing.map((point) => `${point.x},${point.y}`).join(" ")} /><line className="script-segment-polygon-drawing-close" x1={drawing[drawing.length - 1]!.x} y1={drawing[drawing.length - 1]!.y} x2={drawing[0]!.x} y2={drawing[0]!.y} /><circle className="script-segment-polygon-drawing-point" cx={drawing[0]!.x} cy={drawing[0]!.y} r="0.009" /></> : null}
      </svg>
      {/* 未进入绘制状态时不显示操作提示，避免在图片下方占据无效空间。 */}
      {drawError || drawing.length || drawingEnabled ? <div className="script-segment-polygon-helper">{drawError ?? (drawing.length ? "松开鼠标完成描边，右键可取消" : "按住鼠标沿目标边缘描绘，松开后自动生成多边形")}</div> : null}
      {menu ? <div className="script-segment-box-context-menu" style={{left: menu.x, top: menu.y}} role="menu" onPointerDown={(event) => event.stopPropagation()} onPointerLeave={() => setMenu(null)}>{menu.index === -1 ? drawing.length ? <button type="button" role="menuitem" onClick={() => {cancelDrawing(); setMenu(null);}}>取消本次描边</button> : <button type="button" role="menuitem" onClick={() => {setDrawingEnabled(true); setDrawError(null); setMenu(null);}}>开始绘制多边形</button> : <><button type="button" role="menuitem" disabled={menu.index === 0} onClick={() => {onBoxesReorder?.(menu.index, "up"); setMenu(null);}}>上移</button><button type="button" role="menuitem" disabled={menu.index === polygons.length - 1} onClick={() => {onBoxesReorder?.(menu.index, "down"); setMenu(null);}}>下移</button><button type="button" role="menuitem" onClick={() => {onBoxEdit?.(menu.index); setMenu(null);}}>修改多边形文本</button><button type="button" className="is-danger" role="menuitem" onClick={() => {onBoxDelete?.(menu.index); setMenu(null);}}>删除多边形</button></>}</div> : null}
    </div> : null}
  </div>;
};
