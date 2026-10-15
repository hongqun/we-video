"use client";

type Polygon = {text: string; points: Array<{x: number; y: number}>};

export function BoxTextReferenceDocument({spokenText, polygons, editingIndex, text}: {spokenText: string; polygons?: unknown; editingIndex: number; text: string}) {
  const boxes = readBoxes(polygons);
  const ranges: Array<{start: number; end: number; index: number}> = [];
  boxes.forEach((box, index) => {
    if (index === editingIndex || !box.text) return;
    let start = spokenText.indexOf(box.text);
    while (start >= 0) {
      ranges.push({start, end: start + box.text.length, index});
      start = spokenText.indexOf(box.text, start + 1);
    }
  });
  if (text) {
    let start = spokenText.indexOf(text);
    while (start >= 0) {
      ranges.push({start, end: start + text.length, index: editingIndex});
      start = spokenText.indexOf(text, start + 1);
    }
  }
  const owners = new Map<number, number[]>();
  ranges.forEach((range) => { for (let position = range.start; position < range.end; position += 1) owners.set(position, [...(owners.get(position) ?? []), range.index]); });
  // 上角标只放在每个连续引用片段的末字，避免长文本每个字都出现编号。
  const labels = new Map<number, number[]>();
  ranges.forEach((range) => labels.set(range.end - 1, [...(labels.get(range.end - 1) ?? []), range.index]));
  return <div className="box-text-dialog-document"><strong>口播文档</strong><p>{[...spokenText].map((character, position) => { const indexes = owners.get(position) ?? []; const labelsAtEnd = labels.get(position) ?? []; return <span className={indexes.length ? indexes.includes(editingIndex) ? "is-current-reference" : "is-reference" : ""} key={`${position}-${character}`}>{character}{labelsAtEnd.length ? <sup aria-label={`多边形 ${labelsAtEnd.map((index) => index + 1).join("、")} 引用`}>{labelsAtEnd.map((index) => index + 1).join("、")}</sup> : null}</span>; })}</p></div>;
}

const readBoxes = (value: unknown): Polygon[] => {
  const rawBoxes = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as {polygons?: unknown}).polygons)
      ? (value as {polygons: unknown[]}).polygons
      : [];
  return rawBoxes.filter((item): item is Polygon => {
    if (!item || typeof item !== "object") return false;
    const polygon = item as Polygon;
    return typeof polygon.text === "string" && Array.isArray(polygon.points) && polygon.points.length >= 3;
  });
};

export function BoundingBoxTextEditor({polygons, disabled, onChange, onCommit}: {spokenText?: string; polygons?: unknown; disabled?: boolean; onChange: (boxes: Polygon[]) => void; onCommit: (boxes: Polygon[]) => void}) {
  const boxes = readBoxes(polygons);
  return <section className="script-segment-box-text-editor">
    {boxes.map((box, index) => {
      return <label className="script-segment-box-text-row" key={`box-text-${index}`}><span>多边形 {index + 1}</span><textarea value={box.text} rows={2} disabled={disabled} onChange={(event) => { const next = boxes.map((item, itemIndex) => itemIndex === index ? {...item, text: event.target.value} : item); onChange(next); }} onBlur={() => onCommit(boxes)} /></label>;
    })}
  </section>;
}
