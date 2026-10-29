import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Item, Store } from '../core/module.ts';
import { db } from './db.ts';

interface Row {
  id: string;
  module: string;
  date: string | null;
  data: string;
  created_at: string;
  updated_at: string;
}

const sql = {
  list: db.prepare('SELECT * FROM items WHERE module = ? ORDER BY created_at'),
  listByDate: db.prepare('SELECT * FROM items WHERE module = ? AND date = ? ORDER BY created_at'),
  get: db.prepare('SELECT * FROM items WHERE module = ? AND id = ?'),
  insert: db.prepare('INSERT INTO items (id, module, date, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'),
  update: db.prepare('UPDATE items SET date = ?, data = ?, updated_at = ? WHERE module = ? AND id = ?'),
  remove: db.prepare('DELETE FROM items WHERE module = ? AND id = ?'),
};

export class NotFoundError extends Error {}

/** 某个模块的私有存储，所有写入都按模块 schema 校验 */
export function createStore<S extends z.ZodType>(module: string, schema: S): Store<z.output<S>, z.input<S>> {
  type T = z.output<S>;
  const toItem = (r: Row): Item<T> => ({
    id: r.id,
    module: r.module,
    date: r.date,
    data: JSON.parse(r.data),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
  const getRow = (id: string) => sql.get.get(module, id) as unknown as Row | undefined;

  return {
    list(filter) {
      const rows = filter?.date ? sql.listByDate.all(module, filter.date) : sql.list.all(module);
      return (rows as unknown as Row[]).map(toItem);
    },
    get(id) {
      const row = getRow(id);
      return row && toItem(row);
    },
    insert(data, date = null) {
      const parsed = schema.parse(data);
      const now = new Date().toISOString();
      const id = randomUUID();
      sql.insert.run(id, module, date, JSON.stringify(parsed), now, now);
      return toItem(getRow(id)!);
    },
    update(id, patch, date) {
      const row = getRow(id);
      if (!row) throw new NotFoundError(`${module}/${id} 不存在`);
      const parsed = schema.parse({ ...JSON.parse(row.data), ...patch });
      sql.update.run(date === undefined ? row.date : date, JSON.stringify(parsed), new Date().toISOString(), module, id);
      return toItem(getRow(id)!);
    },
    remove(id) {
      sql.remove.run(module, id);
    },
  };
}
