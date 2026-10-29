// 模块运行时：按 id 分发 action、构造模块上下文、广播数据变更。
import { EventEmitter } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import type { AnyAction, Ctx, ModuleDef } from '../core/module.ts';
import { beijingDate } from '../core/time.ts';
import { modules } from '../modules/index.ts';
import { recordActivity, type Via } from './activity.ts';
import { filesDir } from './db.ts';
import { notes } from './notes.ts';
import { createStore, NotFoundError } from './store.ts';

export { NotFoundError };

/** change: { module }  ·  proposal: Proposal  ·  activity: Activity */
export const events = new EventEmitter();
events.setMaxListeners(100);

const registry = new Map<string, ModuleDef>(modules.map((m) => [m.id, m as unknown as ModuleDef]));
const stores = new Map<string, ReturnType<typeof createStore>>(modules.map((m) => [m.id, createStore(m.id, m.schema)]));

/** 「今天」一律按北京时间 */
export const localToday = () => beijingDate();

export function getAction(moduleId: string, actionName: string) {
  const mod = registry.get(moduleId);
  if (!mod) throw new NotFoundError(`未知模块：${moduleId}`);
  const action = (mod.actions as Record<string, AnyAction>)[actionName];
  if (!action) throw new NotFoundError(`模块 ${moduleId} 没有 action：${actionName}`);
  return { mod, action };
}

const MAX_DOWNLOAD = 80 * 1024 * 1024;

async function download(url: string, relPath: string) {
  const target = resolve(filesDir, relPath);
  const rel = relative(filesDir, target);
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) throw new Error('非法的文件路径');
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) }).catch((err) => {
    throw new Error(err?.name === 'TimeoutError' ? `下载超时：${url}` : `下载失败：${err?.message} ${url}`);
  });
  if (!res.ok) throw new Error(`下载失败：${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_DOWNLOAD) throw new Error('文件过大');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buf);
  return rel.split(sep).join('/');
}

export function contextFor(moduleId: string): Ctx<unknown> {
  return {
    store: stores.get(moduleId)! as Ctx<unknown>['store'],
    notes,
    today: localToday(),
    query: async (other, name, input) => {
      const { action } = getAction(other, name);
      if (action.kind !== 'query') throw new Error(`跨模块只能调用 query：${other}.${name}`);
      return (await runAction(other, name, input)) as never;
    },
    download,
  };
}

/** 校验输入并执行 action；mutation 执行后记时间线并广播变更 */
export async function runAction(moduleId: string, actionName: string, rawInput: unknown, via: Via = 'ui') {
  const { action } = getAction(moduleId, actionName);
  const input = action.input.parse(rawInput ?? {});
  const ctx = contextFor(moduleId);
  if (action.kind === 'query') return action.run(input, ctx);

  // 摘要要在执行前算（比如删除后就拿不到标题了）
  const summary = action.activity ? action.activity(input, ctx) : (action.describe?.(input, ctx) ?? null);
  const result = await action.run(input, ctx);
  if (summary) events.emit('activity', recordActivity(moduleId, actionName, summary, via));
  events.emit('change', { module: moduleId });
  return result;
}

/** 前端用的模块清单（不含实现） */
export function manifest() {
  return modules.map((m) => ({
    id: m.id,
    title: m.title,
    description: m.description,
    actions: Object.entries(m.actions as Record<string, AnyAction>).map(([name, a]) => ({
      name,
      kind: a.kind,
      description: a.description,
      agent: a.agent !== false,
    })),
  }));
}
