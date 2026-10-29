// 统一按北京时间（UTC+8，无夏令时）算「今天」和显示时刻，不受机器时区影响。服务端和前端共用。
const OFFSET = 8 * 3600 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');

/** 把时间平移到北京时区后用 getUTC* 读取各字段 */
const shift = (d: Date | string | number) => new Date(new Date(d).getTime() + OFFSET);

/** 北京时间的日期 YYYY-MM-DD */
export const beijingDate = (d: Date | string | number = new Date()) => {
  const b = shift(d);
  return `${b.getUTCFullYear()}-${pad(b.getUTCMonth() + 1)}-${pad(b.getUTCDate())}`;
};

/** 北京时间的 HH:MM */
export const beijingClock = (d: Date | string | number) => {
  const b = shift(d);
  return `${pad(b.getUTCHours())}:${pad(b.getUTCMinutes())}`;
};

/** 北京时间的小时（0–23） */
export const beijingHour = (d: Date | string | number = new Date()) => shift(d).getUTCHours();

/** 某个北京日期 0 点对应的时间戳 */
export const beijingMidnight = (iso: string) => new Date(`${iso}T00:00:00+08:00`).getTime();
