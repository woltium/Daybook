// 读本机「世界时钟」应用（~/.config/worldclock/cities.json）的城市列表和主时钟，界面按这份列表显示各地时间。
// 每次请求都重新读，在世界时钟里增删城市后 Daybook 下一次刷新就跟上。
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type City = [name: string, timeZone: string];

const configPath = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'worldclock', 'cities.json');

const validZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** 城市列表，主时钟排第一；没装世界时钟或配置读不了时为空 */
export function worldClockCities(): City[] {
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8')) as { cities?: unknown; main?: unknown } | unknown[];
    // 旧版配置是纯列表
    const data = Array.isArray(raw) ? { cities: raw, main: null } : raw;
    const cities = (Array.isArray(data.cities) ? data.cities : []).filter(
      (c): c is City => Array.isArray(c) && typeof c[0] === 'string' && typeof c[1] === 'string' && validZone(c[1]),
    );
    const main = data.main as City | null;
    const i = main ? cities.findIndex((c) => c[0] === main[0] && c[1] === main[1]) : -1;
    return i > 0 ? [cities[i], ...cities.slice(0, i), ...cities.slice(i + 1)] : cities;
  } catch {
    return [];
  }
}
