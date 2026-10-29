// 内置 agent：任意 OpenAI 兼容接口（DeepSeek、通义、Kimi、本地 Ollama 等）。
// 未配置时聊天不可用，但工具网关仍可被外部 agent 使用。
import { randomUUID } from 'node:crypto';
import { readSection, saveSection } from './config.ts';
import { db } from './db.ts';
import { takeNotices, type Proposal } from './proposals.ts';
import { modules } from '../modules/index.ts';
import { localToday } from './runtime.ts';
import { callTool, tools } from './tools.ts';

export interface AgentConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** 环境变量优先于 data/config.json */
export function agentConfig(): AgentConfig {
  const file = readSection<AgentConfig>('agent');
  return {
    baseUrl: process.env.HUB_AGENT_BASE_URL ?? file.baseUrl ?? '',
    apiKey: process.env.HUB_AGENT_API_KEY ?? file.apiKey ?? '',
    model: process.env.HUB_AGENT_MODEL ?? file.model ?? '',
  };
}

export const saveAgentConfig = (patch: Partial<AgentConfig>) => saveSection<AgentConfig>('agent', patch);

export class AgentConfigError extends Error {}

export const isConfigured = (c = agentConfig()) => Boolean(c.baseUrl && c.model);

// ───────── OpenAI 兼容的消息格式 ─────────

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

/** 调一次模型。withTools 为 false 时只要文字回复（比如生成总结） */
export async function complete(cfg: AgentConfig, messages: Message[], withTools = true) {
  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      ...(withTools
        ? {
            tools: tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`模型接口返回 ${res.status}：${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { choices?: { message: { content: string | null; tool_calls?: ToolCall[] } }[] };
  const msg = json.choices?.[0]?.message;
  if (!msg) throw new Error('模型接口没有返回内容');
  return msg;
}

// ───────── 对话 ─────────

// 每个页面一个独立的对话：「今天」页用总览的提示词，模块页用模块自己定义的 agentPrompt。
// 所有页面共用下面这些基本规则，工具也都能用（比如在总结页查待办），但职责聚焦在本页。

const TODAY_PROMPT = [
  '你是「今天」页的总览助手，帮用户回顾今天做了什么、还剩什么，安排优先级。',
  '可以跨模块查询（待办、工作总结、待看），给建议时要具体、简短。',
].join('\n');

const BASE_RULES = [
  '你在用户本地的 Daybook 里工作，它有待办、工作总结、待看（论文/推文/知识点）三个模块。',
  '你只能通过提供的工具读写数据。查询类工具会直接返回结果；写操作只会生成「提案」，提案会显示在对话框里，要等用户在对话框里批准后才会执行。',
  '因此调用写操作后，不要说已经完成，而是告诉用户提案已提交、等待批准。',
  '修改或删除条目前，先用查询工具拿到准确的 id。回答简洁，用中文。',
].join('\n');

export type Scope = 'today' | (typeof modules)[number]['id'];
export const scopes: Scope[] = ['today', ...modules.map((m) => m.id)];

const system = (scope: Scope) => {
  const mod = modules.find((m) => m.id === scope);
  return [mod ? mod.agentPrompt : TODAY_PROMPT, '', BASE_RULES, `今天是 ${localToday()}。`].join('\n');
};

const conversations = new Map<string, { scope: Scope; messages: Message[] }>();
const MAX_STEPS = 8;
const MAX_TOOL_RESULT = 8000;

export interface ChatStep {
  tool: string;
  kind: 'query' | 'mutation';
  ok: boolean;
  /** query 的简短说明或提案摘要/错误 */
  detail: string;
}

export interface ChatReply {
  conversationId: string;
  reply: string;
  steps: ChatStep[];
  proposals: Proposal[];
}

const NOTICE: Record<string, string> = { applied: '已批准并执行', rejected: '被用户拒绝', failed: '批准后执行失败' };

/** scope：在哪一页聊的，决定用哪个固定提示词；不同页面的对话互不影响 */
export async function chat(message: string, scope: Scope, conversationId?: string): Promise<ChatReply> {
  const cfg = agentConfig();
  if (!isConfigured(cfg)) throw new AgentConfigError('agent 未配置：在左侧栏「设置」里填写接口地址和模型');

  const existing = conversationId ? conversations.get(conversationId) : undefined;
  // chat- 前缀标记内置对话框发起的对话，界面据此把它的提案留在对话框里批准
  const id = existing?.scope === scope ? conversationId! : `chat-${randomUUID()}`;
  const history = existing?.scope === scope ? existing.messages : [{ role: 'system' as const, content: system(scope) }];

  const notices = takeNotices(id).map(
    (p) => `[系统通知] 提案「${p.summary}」${NOTICE[p.status]}${p.status === 'failed' ? `：${(p.result as { error?: string })?.error}` : ''}`,
  );
  const messages: Message[] = [...history, { role: 'user', content: [...notices, message].join('\n') }];

  const steps: ChatStep[] = [];
  const proposals: Proposal[] = [];
  let reply = '';

  for (let i = 0; i < MAX_STEPS; i++) {
    const msg = await complete(cfg, messages);
    messages.push({ role: 'assistant', content: msg.content ?? null, ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) });
    if (!msg.tool_calls?.length) {
      reply = msg.content ?? '';
      break;
    }
    for (const call of msg.tool_calls) {
      const tool = tools.find((t) => t.name === call.function.name);
      let content: string;
      try {
        const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        const out = await callTool(call.function.name, args, id);
        if (out.kind === 'proposal') {
          proposals.push(out.proposal);
          steps.push({ tool: call.function.name, kind: 'mutation', ok: true, detail: out.proposal.summary });
          content = JSON.stringify({ proposal: out.proposal.id, summary: out.proposal.summary, status: 'pending' });
        } else {
          steps.push({ tool: call.function.name, kind: 'query', ok: true, detail: call.function.arguments.slice(0, 120) });
          content = JSON.stringify(out.result) ?? 'null';
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        steps.push({ tool: call.function.name, kind: tool?.kind ?? 'query', ok: false, detail: error });
        content = JSON.stringify({ error });
      }
      if (content.length > MAX_TOOL_RESULT) content = `${content.slice(0, MAX_TOOL_RESULT)}…（已截断）`;
      messages.push({ role: 'tool', tool_call_id: call.id, content });
    }
  }
  if (!reply) reply = proposals.length ? '已提交提案，等待你批准。' : '（没有得到回复）';

  conversations.set(id, { scope, messages });
  sql.insert.run(id, scope, localToday(), message, reply, JSON.stringify(steps), new Date().toISOString());
  return { conversationId: id, reply, steps, proposals };
}

// ───────── 对话记录（按天保存，用来生成工作总结） ─────────

const sql = {
  insert: db.prepare('INSERT INTO chat_log (conversation, scope, date, user, reply, steps, at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  byDate: db.prepare('SELECT * FROM chat_log WHERE date = ? ORDER BY id'),
};

export interface ChatTurn {
  conversation: string;
  scope: string;
  user: string;
  reply: string;
  steps: ChatStep[];
  at: string;
}

export const chatLog = (date: string): ChatTurn[] =>
  (sql.byDate.all(date) as unknown as (Omit<ChatTurn, 'steps'> & { steps: string })[]).map((r) => ({
    ...r,
    steps: JSON.parse(r.steps),
  }));

export const resetConversation = (id: string) => conversations.delete(id);
