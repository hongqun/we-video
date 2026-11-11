export type DiagramPoint = {x: number; y: number};
const numbers = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

// 只把直线折线路径转换为控制点；曲线和多子路径保持原样，避免手工操作破坏图形。
export function diagramLinePoints(element: Element): DiagramPoint[] | null {
  if (element.tagName === "line") {
    const values = ["x1", "y1", "x2", "y2"].map((key) => Number(element.getAttribute(key) ?? 0));
    return values.every(Number.isFinite) ? [{x: values[0]!, y: values[1]!}, {x: values[2]!, y: values[3]!}] : null;
  }
  if (element.tagName === "polyline") {
    const source = element.getAttribute("points") ?? "";
    if (source.replace(numbers, "").replace(/[\s,]/g, "")) return null;
    const values = (source.match(numbers) ?? []).map(Number);
    if (values.length < 4 || values.length % 2 || !values.every(Number.isFinite)) return null;
    return values.flatMap((x, i) => i % 2 ? [] : [{x, y: values[i + 1]!}]);
  }
  if (element.tagName !== "path") return null;
  const source = element.getAttribute("d") ?? "";
  const tokens = source.match(/[MLHVmlhv]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? [];
  if (source.replace(/[MLHVmlhv]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g, "").replace(/[\s,]/g, "")) return null;
  const points: DiagramPoint[] = [];
  let command = "", x = 0, y = 0, index = 0;
  while (index < tokens.length) {
    if (/^[MLHV]$/i.test(tokens[index]!)) command = tokens[index++]!;
    if (!command || (!points.length && command.toUpperCase() !== "M")) return null;
    const relative = command === command.toLowerCase(), kind = command.toUpperCase();
    const count = kind === "H" || kind === "V" ? 1 : 2;
    const values = tokens.slice(index, index + count).map(Number);
    if (values.length !== count || !values.every(Number.isFinite) || (kind === "M" && points.length)) return null;
    if (kind === "H") x = values[0]! + (relative ? x : 0);
    else if (kind === "V") y = values[0]! + (relative ? y : 0);
    else {x = values[0]! + (relative ? x : 0); y = values[1]! + (relative ? y : 0);}
    points.push({x, y}); index += count;
    if (kind === "M") command = relative ? "l" : "L";
  }
  return points.length >= 2 ? points : null;
}

// 更新坐标时保留箭头、描边及变换，只替换几何属性。
export function setDiagramLinePoints(element: Element, points: DiagramPoint[]) {
  if (element.tagName === "line") {
    for (const [key, value] of Object.entries({x1: points[0]!.x, y1: points[0]!.y, x2: points[1]!.x, y2: points[1]!.y})) element.setAttribute(key, String(value));
  } else if (element.tagName === "polyline") element.setAttribute("points", points.map(({x, y}) => `${x},${y}`).join(" "));
  else element.setAttribute("d", points.map(({x, y}, i) => `${i ? "L" : "M"} ${x} ${y}`).join(" "));
}
