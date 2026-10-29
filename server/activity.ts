// 时间线：记录每次 mutation 做了什么。连续的同类操作（比如自动保存总结）合并成一条。
import { beijingDate } from '../core/time.ts';
import { db } from './db.ts';

export type Via = 'ui' | 'agent';

export interface Activity {
  id: number;
  module: string;
  action: string;
  summary: string;
  via: Via;
  date: string;
  at: string;
}

const MERGE_MS = 30 * 60 * 1000;

const sql = {
  last: db.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT 1'),
  insert: db.prepare('INSERT INTO activity (module, action, summary, via, date, at) VALUES (?, ?, ?, ?, ?, ?)'),
  touch: db.prepare('UPDATE activity SET at = ? WHERE id = ?'),
  get: db.prepare('SELECT * FROM activity WHERE id = ?'),
  byDate: db.prepare('SELECT * FROM activity WHERE date = ? ORDER BY at DESC, id DESC'),
};

const localDate = (d = new Date()) => beijingDate(d);

export function recordActivity(module: string, action: string, summary: string, via: Via) {
  const now = new Date();
  const date = localDate(now);
  const last = sql.last.get() as unknown as Activity | undefined;
  if (
    last &&
    last.module === module &&
    last.action === action &&
    last.summary === summary &&
    last.via === via &&
    last.date === date &&
    now.getTime() - new Date(last.at).getTime() < MERGE_MS
  ) {
    sql.touch.run(now.toISOString(), last.id);
    return sql.get.get(last.id) as unknown as Activity;
  }
  const { lastInsertRowid } = sql.insert.run(module, action, summary, via, date, now.toISOString());
  return sql.get.get(lastInsertRowid) as unknown as Activity;
}

export const listActivity = (date = localDate()) => sql.byDate.all(date) as unknown as Activity[];
