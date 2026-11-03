// 本机「世界时钟」应用里的城市（见 server/worldclock.ts）。没装时退回北京 + 本机时区。
import { useSyncExternalStore } from 'react';
import { api } from './client.ts';

export type City = [name: string, timeZone: string];

const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const fallback = (): City[] => {
  const local = localZone();
  const cities: City[] = [['北京', 'Asia/Shanghai']];
  return local === 'Asia/Shanghai' ? cities : [...cities, [local.split('/').pop()!.replace(/_/g, ' '), local]];
};

// 全页面共用一份：第一个用到的组件挂上时开始每分钟读一次，最后一个卸载时停下
let cities: City[] = fallback();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

const load = () =>
  api
    .get<{ cities: City[] }>('/api/worldclock')
    .then(({ cities: c }) => {
      const next = c.length ? c : fallback();
      if (JSON.stringify(next) === JSON.stringify(cities)) return;
      cities = next;
      listeners.forEach((l) => l());
    })
    .catch(() => undefined);

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    void load();
    timer = setInterval(load, 60_000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** 城市列表，主时钟排第一；每分钟重新读一次，在世界时钟里改了城市也能跟上 */
export const useWorldClock = () => useSyncExternalStore(subscribe, () => cities);

/** 某个时区的 HH:MM */
export const zoneClock = (timeZone: string, d: Date | string | number) =>
  new Intl.DateTimeFormat('zh-CN', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));

/** 「北京 14:30 · 东京 15:30 · …」 */
export const cityTimes = (cities: City[], d: Date | string | number) => cities.map(([name, tz]) => `${name} ${zoneClock(tz, d)}`).join(' · ');
