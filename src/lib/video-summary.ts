export const normalizeVideoSummary = (value: string) => value.replace(/\s+/g, " ").trim();

export const videoSummaryLength = (value: string) => [...normalizeVideoSummary(value)].length;
