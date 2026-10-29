// 模块视图注册表。每个模块在 modules/<id>/view.tsx 导出一个 ModuleView：
// - icon / Badge：左侧栏的图标和数字
// - Page：点侧栏后右侧显示的模块页
// 新增模块：在 modules/index.ts 注册服务端定义，在这里注册视图。
import type { LucideIcon } from 'lucide-react';
import type { FC } from 'react';
import type { ModuleId } from '../../modules/index.ts';
import { todoView } from '../../modules/todo/view.tsx';
import { worklogView } from '../../modules/worklog/view.tsx';
import { readingView } from '../../modules/reading/view.tsx';

export interface ModuleView {
  icon: LucideIcon;
  Page: FC;
  Badge: FC;
}

export const views: Record<ModuleId, ModuleView> = {
  todo: todoView,
  worklog: worklogView,
  reading: readingView,
};

export const moduleOrder: ModuleId[] = ['todo', 'worklog', 'reading'];
