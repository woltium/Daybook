// 工具网关：把各模块开放给 agent 的 action 暴露成工具（JSON Schema）。
// query 直接返回结果；mutation 只生成提案。内置 agent 和外部 agent 都走这里。
import { z } from 'zod';
import type { AnyAction } from '../core/module.ts';
import { modules } from '../modules/index.ts';
import { createProposal, type Proposal } from './proposals.ts';
import { NotFoundError, runAction } from './runtime.ts';

export interface Tool {
  name: string;
  module: string;
  action: string;
  kind: 'query' | 'mutation';
  description: string;
  parameters: Record<string, unknown>;
}

const SEP = '__';

export const tools: Tool[] = modules.flatMap((m) =>
  Object.entries(m.actions as Record<string, AnyAction>)
    .filter(([, a]) => a.agent !== false)
    .map(([name, a]) => {
      const { $schema: _, ...parameters } = z.toJSONSchema(a.input, { io: 'input', unrepresentable: 'any' });
      return {
        name: `${m.id}${SEP}${name}`,
        module: m.id,
        action: name,
        kind: a.kind,
        description:
          `[${m.title}] ${a.description}` +
          (a.kind === 'mutation' ? '。写操作：调用后只会生成提案，用户批准后才会执行。' : ''),
        parameters,
      };
    }),
);

export type ToolOutcome = { kind: 'result'; result: unknown } | { kind: 'proposal'; proposal: Proposal };

export async function callTool(name: string, args: unknown, conversation: string | null = null): Promise<ToolOutcome> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new NotFoundError(`未知工具：${name}`);
  if (tool.kind === 'query') return { kind: 'result', result: await runAction(tool.module, tool.action, args) };
  return { kind: 'proposal', proposal: createProposal(tool.module, tool.action, args, conversation) };
}
