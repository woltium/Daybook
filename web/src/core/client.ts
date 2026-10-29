// 前端访问模块的唯一入口：按模块 id + action 名调用，类型从服务端模块定义推导（只 import 类型）。
import { useCallback, useEffect, useState } from 'react';
import type { z } from 'zod';
import type { ModuleId, Modules } from '../../../modules/index.ts';

type ActionsOf<Id extends ModuleId> = Extract<Modules, { id: Id }>['actions'];
export type ActionName<Id extends ModuleId> = keyof ActionsOf<Id> & string;
type ActionOf<Id extends ModuleId, A extends ActionName<Id>> = ActionsOf<Id>[A];
export type InputOf<Id extends ModuleId, A extends ActionName<Id>> =
  ActionOf<Id, A> extends { input: infer I extends z.ZodType } ? z.input<I> : never;
export type OutputOf<Id extends ModuleId, A extends ActionName<Id>> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ActionOf<Id, A> extends { run(...args: any[]): infer R } ? Awaited<R> : never;

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `请求失败：${res.status}`);
  return json as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

/** 调用模块 action。UI 调用 mutation 会立即执行 */
export async function call<Id extends ModuleId, A extends ActionName<Id>>(
  module: Id,
  action: A,
  input?: InputOf<Id, A>,
): Promise<OutputOf<Id, A>> {
  const { result } = await api.post<{ result: OutputOf<Id, A> }>(`/api/m/${module}/${action}`, input ?? {});
  return result;
}

// ───────── 服务端推送 ─────────

type Listener = (data: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
let source: EventSource | null = null;

function ensureSource() {
  if (source) return;
  source = new EventSource('/api/events');
  for (const type of ['change', 'proposal', 'activity', 'job']) {
    source.addEventListener(type, (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      listeners.get(type)?.forEach((fn) => fn(data));
    });
  }
}

/** 订阅 change（{ module }）或 proposal 事件，返回取消函数 */
export function onEvent(type: 'change' | 'proposal' | 'activity' | 'job', fn: Listener) {
  ensureSource();
  const set = listeners.get(type) ?? new Set();
  listeners.set(type, set);
  set.add(fn);
  return () => void set.delete(fn);
}

// ───────── 查询 hook ─────────

interface QueryOptions {
  /** 这些模块的数据变化时重新查询，默认只看自己；'all' 表示任何模块 */
  watch?: ModuleId[] | 'all';
}

/**
 * 查询模块数据，模块数据变化时自动刷新。
 * 参数变化（比如切换日期）时，在新数据到达前返回 undefined，不会短暂显示旧参数的数据。
 */
export function useQuery<Id extends ModuleId, A extends ActionName<Id>>(
  module: Id,
  action: A,
  input?: InputOf<Id, A>,
  options: QueryOptions = {},
) {
  const key = JSON.stringify([module, action, input ?? {}]);
  const [state, setState] = useState<{ key: string; data?: OutputOf<Id, A>; error?: string }>({ key: '' });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const watch = options.watch ?? [module];
  const watchKey = watch === 'all' ? 'all' : watch.join(',');

  useEffect(() => {
    let alive = true;
    call(module, action, input)
      .then((data) => alive && setState({ key, data }))
      .catch((err: Error) => alive && setState((s) => ({ key, data: s.key === key ? s.data : undefined, error: err.message })));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);

  useEffect(
    () =>
      onEvent('change', (data) => {
        const changed = (data as { module: string }).module;
        if (watchKey === 'all' || watchKey.split(',').includes(changed)) reload();
      }),
    [watchKey, reload],
  );

  const current = state.key === key;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    loading: !current,
    reload,
  };
}
