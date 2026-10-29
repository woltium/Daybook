// 提案：agent 发起的写操作不会直接执行，而是记成提案，等用户批准后才调用对应 mutation。
import { randomUUID } from 'node:crypto';
import { db } from './db.ts';
import { contextFor, events, getAction, runAction } from './runtime.ts';

export type ProposalStatus = 'pending' | 'applied' | 'rejected' | 'failed';

export interface Proposal {
  id: string;
  conversation: string | null;
  module: string;
  action: string;
  input: unknown;
  summary: string;
  status: ProposalStatus;
  /** applied 时为执行结果，failed 时为 { error } */
  result: unknown;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  conversation: string | null;
  module: string;
  action: string;
  input: string;
  summary: string;
  status: ProposalStatus;
  result: string | null;
  created_at: string;
  updated_at: string;
}

const sql = {
  insert: db.prepare(
    'INSERT INTO proposals (id, conversation, module, action, input, summary, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ),
  get: db.prepare('SELECT * FROM proposals WHERE id = ?'),
  list: db.prepare('SELECT * FROM proposals ORDER BY created_at DESC LIMIT ?'),
  listByStatus: db.prepare('SELECT * FROM proposals WHERE status = ? ORDER BY created_at DESC LIMIT ?'),
  settle: db.prepare('UPDATE proposals SET status = ?, result = ?, updated_at = ? WHERE id = ? AND status = ?'),
  unnotified: db.prepare(
    "SELECT * FROM proposals WHERE conversation = ? AND status != 'pending' AND notified = 0 ORDER BY updated_at",
  ),
  markNotified: db.prepare('UPDATE proposals SET notified = 1 WHERE id = ?'),
};

const toProposal = (r: Row): Proposal => ({
  id: r.id,
  conversation: r.conversation,
  module: r.module,
  action: r.action,
  input: JSON.parse(r.input),
  summary: r.summary,
  status: r.status,
  result: r.result === null ? null : JSON.parse(r.result),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const getRow = (id: string) => sql.get.get(id) as unknown as Row | undefined;

export class ProposalError extends Error {}

/** 校验输入并创建提案；只接受开放给 agent 的 mutation */
export function createProposal(moduleId: string, actionName: string, rawInput: unknown, conversation: string | null = null) {
  const { action } = getAction(moduleId, actionName);
  if (action.kind !== 'mutation') throw new ProposalError(`${moduleId}.${actionName} 不是写操作，无需提案`);
  if (action.agent === false) throw new ProposalError(`${moduleId}.${actionName} 未开放给 agent`);
  const input = action.input.parse(rawInput ?? {});
  const summary = action.describe?.(input, contextFor(moduleId)) ?? `${moduleId}.${actionName}`;
  const id = randomUUID();
  const now = new Date().toISOString();
  sql.insert.run(id, conversation, moduleId, actionName, JSON.stringify(input), summary, 'pending', now, now);
  const proposal = toProposal(getRow(id)!);
  events.emit('proposal', proposal);
  return proposal;
}

export function listProposals(status?: ProposalStatus, limit = 50) {
  const rows = status ? sql.listByStatus.all(status, limit) : sql.list.all(limit);
  return (rows as unknown as Row[]).map(toProposal);
}

function settle(id: string, status: ProposalStatus, result: unknown) {
  const changed = sql.settle.run(status, JSON.stringify(result ?? null), new Date().toISOString(), id, 'pending');
  if (!changed.changes) throw new ProposalError('提案不存在或已处理');
  const proposal = toProposal(getRow(id)!);
  events.emit('proposal', proposal);
  return proposal;
}

/** 用户批准：执行对应 mutation，记录结果或错误 */
export async function approveProposal(id: string) {
  const row = getRow(id);
  if (!row || row.status !== 'pending') throw new ProposalError('提案不存在或已处理');
  try {
    const result = await runAction(row.module, row.action, JSON.parse(row.input), 'agent');
    return settle(id, 'applied', result);
  } catch (err) {
    return settle(id, 'failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

export const rejectProposal = (id: string) => settle(id, 'rejected', null);

/** 取出某个对话里已处理但还没告诉 agent 的提案（取出即标记为已通知） */
export function takeNotices(conversation: string) {
  const rows = (sql.unnotified.all(conversation) as unknown as Row[]).map(toProposal);
  for (const p of rows) sql.markNotified.run(p.id);
  return rows;
}
