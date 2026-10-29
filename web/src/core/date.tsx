import { createContext, useContext, useState, type ReactNode } from 'react';
import { beijingDate } from '../../../core/time.ts';

export const toISODate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 「今天」按北京时间算，不跟随系统时区 */
export const today = () => beijingDate();

export const shiftDate = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
};

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export const formatDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期${WEEKDAYS[d.getDay()]}`;
};

export const shortDate = (iso: string) => iso.slice(5).replace('-', '.');

interface DateCtx {
  date: string;
  setDate: (d: string) => void;
  isToday: boolean;
}

const Ctx = createContext<DateCtx | null>(null);

/** 全局「当前查看日期」，模块据此决定展示哪天的数据 */
export function DateProvider({ children }: { children: ReactNode }) {
  const [date, setDate] = useState(today);
  return <Ctx.Provider value={{ date, setDate, isToday: date === today() }}>{children}</Ctx.Provider>;
}

export function useDate() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDate must be used inside <DateProvider>');
  return ctx;
}
