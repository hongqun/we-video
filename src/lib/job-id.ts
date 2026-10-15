const pad = (value: number, length = 2) => String(value).padStart(length, "0");

const timeZone = () => process.env.TALK_VIDEO_TIME_ZONE?.trim() || "Asia/Shanghai";

/** 生成使用业务时区、可按时间排序且便于人工识别的 job ID。 */
export const newJobId = () => {
  const now = new Date();
  const fields = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).reduce<Record<string, string>>((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return `${fields.year}-${fields.month}-${fields.day} ${fields.hour}:${fields.minute}:${fields.second}.${pad(now.getUTCMilliseconds(), 3)}`;
};
