// 本机配置：data/config.json，按小节存（agent、notes……）。环境变量优先。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './db.ts';

const configPath = join(dataDir, 'config.json');

function readAll(): Record<string, Record<string, unknown>> {
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

export function readSection<T>(name: string): Partial<T> {
  return (readAll()[name] ?? {}) as Partial<T>;
}

/** 合并写入某一小节，其它小节保持不变 */
export function saveSection<T>(name: string, patch: Partial<T>) {
  const all = readAll();
  all[name] = { ...all[name], ...patch };
  writeFileSync(configPath, JSON.stringify(all, null, 2));
}
