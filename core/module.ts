// 模块契约（服务端）。一个模块 = 数据 schema + 一组 action，不含任何 UI。
// - query：只读，UI 和 agent 都可直接调用
// - mutation：写操作。UI 直接执行；agent 调用只会生成「提案」，用户批准后才执行
// 每次 mutation 执行后会记一条时间线（activity），总览「今天」页按时间展示。
// UI 视图在 modules/<id>/view.tsx，只通过 action 和模块交互。
import type { z } from 'zod';

export interface Item<T> {
  id: string;
  module: string;
  /** 归属日期（YYYY-MM-DD），不按天组织的数据为 null */
  date: string | null;
  data: T;
  createdAt: string;
  updatedAt: string;
}

/** 模块私有存储：每个模块只能读写自己的数据 */
export interface Store<T, In = T> {
  list(filter?: { date?: string }): Item<T>[];
  get(id: string): Item<T> | undefined;
  /** 写入前按模块 schema 校验并补默认值 */
  insert(data: In, date?: string | null): Item<T>;
  update(id: string, patch: Partial<T>, date?: string | null): Item<T>;
  remove(id: string): void;
}

/**
 * 每日笔记（本地或 Obsidian 文件夹里每天一个 Markdown 文件，按「## 标题」分节）。
 * 多个模块共用同一个文件，各自只读写自己的那一节。
 */
export interface Notes {
  exists(date: string): boolean;
  /** 某天某一节的内容（去掉首尾空行）；文件或这一节不存在时为 null */
  read(date: string, section: string): string | null;
  /** 整节替换；这一节不存在时新建在文件开头或末尾 */
  write(date: string, section: string, content: string, position?: 'start' | 'end'): void;
  /** 文件最后修改时间 */
  mtime(date: string): string | null;
  /** date 之前最近一个有笔记文件的日期 */
  previous(date: string, maxDays?: number): string | null;
}

export interface Ctx<T, In = T> {
  store: Store<T, In>;
  notes: Notes;
  /** 服务器本地日期 YYYY-MM-DD */
  today: string;
  /** 调用其它模块公开的 query（跨模块只读，不能直接改别人的数据） */
  query: <R = unknown>(module: string, action: string, input?: unknown) => Promise<R>;
  /** 下载文件到本地数据目录，返回可通过 /files/<path> 访问的相对路径 */
  download: (url: string, relPath: string) => Promise<string>;
}

export type ActionKind = 'query' | 'mutation';

export interface ActionDef<I extends z.ZodType, O, T, In = T> {
  kind: ActionKind;
  /** 给人和 agent 看的说明，会成为工具描述 */
  description: string;
  input: I;
  /** 是否开放给 agent，默认 true */
  agent?: boolean;
  /** mutation 生成提案时展示给用户的一句话说明 */
  // 用方法签名（参数双变），具体 action 才能赋给通用契约
  describe?(input: z.output<I>, ctx: Ctx<T, In>): string;
  /** mutation 执行后记进时间线的一句话，默认用 describe；返回 null 表示不记录 */
  activity?(input: z.output<I>, ctx: Ctx<T, In>): string | null;
  run(input: z.output<I>, ctx: Ctx<T, In>): O | Promise<O>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAction = ActionDef<z.ZodType, any, any, any>;

export interface ModuleDef<Id extends string = string, S extends z.ZodType = z.ZodType, A = Record<string, AnyAction>> {
  id: Id;
  title: string;
  description: string;
  /** 这个模块页面上 agent 的固定提示词：它在这一页扮演什么角色、该怎么做事 */
  agentPrompt: string;
  schema: S;
  actions: A;
}

/**
 * 定义模块：
 *   export const todo = defineModule({ id: 'todo', title, description, schema })
 *     .actions((a) => ({ list: a.query({...}), add: a.mutation({...}) }));
 */
export function defineModule<const Id extends string, S extends z.ZodType>(meta: {
  id: Id;
  title: string;
  description: string;
  agentPrompt: string;
  schema: S;
}) {
  type T = z.output<S>;
  type In = z.input<S>;
  const builders = {
    query: <I extends z.ZodType, O>(d: Omit<ActionDef<I, O, T, In>, 'kind'>) => ({ ...d, kind: 'query' as const }),
    mutation: <I extends z.ZodType, O>(d: Omit<ActionDef<I, O, T, In>, 'kind'>) => ({ ...d, kind: 'mutation' as const }),
  };
  return {
    actions<A extends Record<string, AnyAction>>(build: (a: typeof builders) => A): ModuleDef<Id, S, A> {
      return { ...meta, actions: build(builders) };
    },
  };
}

export const isoDate = /^\d{4}-\d{2}-\d{2}$/;
