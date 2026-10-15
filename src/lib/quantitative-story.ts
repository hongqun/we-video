export type QuantitativeMarker = {label: string; value: number};
export type QuantitativeMetric = {display: string; value: number; unit?: string};
export type QuantitativeStoryData = {
  mode: "change" | "range" | "stat";
  label?: string;
  markers: QuantitativeMarker[];
  metric?: QuantitativeMetric;
  facts?: string[];
};

const NUMBER = String.raw`\d+(?:\.\d+)?`;
const RANGE_CONNECTOR = String.raw`(?:到|至|—|–|-|~|～)`;

/** 数字之间的横线表示区间，不应被后续证据扫描误读为负号。 */
export const normalizeNumericRangeConnectors = (value: string) => value
  .normalize("NFKC")
  // 量级或币种常跟在左端点后（如 3.5万-8万、40万美元-50万美元），连接线仍表示区间而非负号。
  .replace(/(\d+(?:\.\d+)?(?:千|万|亿)?(?:美元|人民币|元|人|个|条|倍|%|％)?)\s*[-—–~～]\s*(?=\d)/gu, "$1至");

const shortLabel = (value: string) => [...value.trim()].slice(0, 16).join("");
const numberValue = (value: string) => Number(value.replaceAll(",", ""));

/** 从真实文案中提取可复用的时间变化、数值区间或单一指标，不推测缺失数值。 */
export const quantitativeStoryFromText = (text: string, label?: string): QuantitativeStoryData | null => {
  const normalized = text.normalize("NFKC");
  const yearRange = normalized.match(new RegExp(`(${NUMBER})\\s*年?\\s*${RANGE_CONNECTOR}\\s*(${NUMBER})\\s*年`, "u"));
  const change = normalized.match(new RegExp(`(${NUMBER})\\s*(多|余|以上|左右|约|近|超)?\\s*(倍|%|％)`, "u"));
  if (yearRange && change) {
    const start = numberValue(yearRange[1]!);
    const end = numberValue(yearRange[2]!);
    const value = numberValue(change[1]!);
    return {
      mode: "change",
      ...(label ? {label: shortLabel(label)} : {}),
      markers: [{label: `${yearRange[1]}年`, value: start}, {label: `${yearRange[2]}年`, value: end}],
      metric: {display: change[0].replaceAll(" ", ""), value, unit: change[3]!.replace("％", "%")},
    };
  }

  const range = normalized.match(new RegExp(`(${NUMBER})\\s*(千|万|亿)?\\s*(美元|人民币|元|人|个|条|倍|%|％)?\\s*${RANGE_CONNECTOR}\\s*(${NUMBER})\\s*(千|万|亿)?\\s*(美元|人民币|元|人|个|条|倍|%|％)?`, "u"));
  if (range) {
    const leftUnit = `${range[2] ?? ""}${range[3] ?? ""}`.replace("％", "%");
    const rightUnit = `${range[5] ?? ""}${range[6] ?? ""}`.replace("％", "%");
    const sharedUnit = rightUnit || leftUnit;
    const leftDisplay = `${range[1]}${leftUnit || sharedUnit}`;
    const rightDisplay = `${range[4]}${rightUnit || sharedUnit}`;
    return {
      mode: "range",
      ...(label ? {label: shortLabel(label)} : {}),
      markers: [
        {label: leftDisplay, value: numberValue(range[1]!)},
        {label: rightDisplay, value: numberValue(range[4]!)},
      ],
    };
  }

  if (change) {
    const value = numberValue(change[1]!);
    return {
      mode: "stat",
      ...(label ? {label: shortLabel(label)} : {}),
      markers: [],
      metric: {display: change[0].replaceAll(" ", ""), value, unit: change[3]!.replace("％", "%")},
    };
  }
  return null;
};

/** 审核保存和渲染入口共用的最小结构检查。 */
export const isQuantitativeStoryData = (value: unknown): value is QuantitativeStoryData => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  const markers = Array.isArray(data.markers) ? data.markers : [];
  const validMarkers = markers.every((item) => item && typeof item === "object" && !Array.isArray(item)
    && typeof (item as Record<string, unknown>).label === "string"
    && typeof (item as Record<string, unknown>).value === "number");
  const metric = data.metric && typeof data.metric === "object" && !Array.isArray(data.metric) ? data.metric as Record<string, unknown> : null;
  const validMetric = Boolean(metric && typeof metric.display === "string" && typeof metric.value === "number");
  const validFacts = data.facts === undefined || (Array.isArray(data.facts) && data.facts.length <= 2 && data.facts.every((item) => typeof item === "string"));
  if (!validFacts) return false;
  if (!validMarkers || markers.length > 2) return false;
  if (data.mode === "range") return markers.length === 2;
  if (data.mode === "change") return markers.length === 2 && validMetric;
  return data.mode === "stat" && validMetric;
};
