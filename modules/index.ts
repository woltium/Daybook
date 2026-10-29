// 模块注册表（服务端）。顺序即页面上的排列顺序。新增模块在这里加一行，
// 并在 web/src/views.ts 注册对应视图。
import { todo } from './todo/module.ts';
import { worklog } from './worklog/module.ts';
import { reading } from './reading/module.ts';

export const modules = [todo, worklog, reading] as const;

export type Modules = (typeof modules)[number];
export type ModuleId = Modules['id'];
