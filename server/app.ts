// HTTP 接口。只监听 127.0.0.1，由 Electron 主进程或 server/index.ts 启动。
import express, { type ErrorRequestHandler } from 'express';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { z } from 'zod';
import { listActivity } from './activity.ts';
import { localNotesDir, notesConfig, notesDir, NotesNotConfigured, saveNotesConfig, watchNotes } from './notes.ts';
import { clearJob, getJob, startJob } from './jobs.ts';
import { draftSummary, NothingToSummarize, proposeTodos } from './summary.ts';
import { AgentConfigError, agentConfig, chat, scopes, type Scope, isConfigured, resetConversation, saveAgentConfig } from './agent.ts';
import { filesDir } from './db.ts';
import { approveProposal, listProposals, ProposalError, rejectProposal, type ProposalStatus } from './proposals.ts';
import { events, manifest, NotFoundError, runAction } from './runtime.ts';
import { callTool, tools } from './tools.ts';

export function createApp(staticDir?: string) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // ───────── 模块（UI 直接调用，mutation 立即执行） ─────────
  app.get('/api/manifest', (_req, res) => {
    res.json(manifest());
  });

  app.post('/api/m/:module/:action', async (req, res) => {
    res.json({ result: (await runAction(req.params.module, req.params.action, req.body)) ?? null });
  });

  // ───────── 变更推送 ─────────
  app.get('/api/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    const send = (event: string) => (data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const onChange = send('change');
    const onProposal = send('proposal');
    const onActivity = send('activity');
    const onJob = send('job');
    events.on('job', onJob);
    events.on('change', onChange);
    events.on('proposal', onProposal);
    events.on('activity', onActivity);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(ping);
      events.off('change', onChange);
      events.off('proposal', onProposal);
      events.off('activity', onActivity);
      events.off('job', onJob);
    });
  });

  // ───────── 时间线 ─────────
  app.get('/api/activity', (req, res) => {
    res.json(listActivity(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().parse(req.query.date)));
  });

  // ───────── 提案审批（只给 UI 用） ─────────
  app.get('/api/proposals', (req, res) => {
    res.json(listProposals(req.query.status as ProposalStatus | undefined));
  });
  app.post('/api/proposals/:id/approve', async (req, res) => {
    res.json(await approveProposal(req.params.id));
  });
  app.post('/api/proposals/:id/reject', (req, res) => {
    res.json(rejectProposal(req.params.id));
  });

  // ───────── 工具网关（给外部 agent 用，写操作同样只生成提案） ─────────
  app.get('/api/tools', (_req, res) => {
    res.json(tools.map(({ name, kind, description, parameters }) => ({ name, kind, description, parameters })));
  });
  app.post('/api/tools/:name', async (req, res) => {
    res.json(await callTool(req.params.name, req.body, req.get('x-conversation') ?? null));
  });

  // ───────── 内置 agent ─────────
  app.get('/api/agent/config', (_req, res) => {
    const c = agentConfig();
    res.json({ configured: isConfigured(c), baseUrl: c.baseUrl, model: c.model, hasKey: Boolean(c.apiKey) });
  });
  app.put('/api/agent/config', (req, res) => {
    const patch = z
      .object({ baseUrl: z.string().trim(), model: z.string().trim(), apiKey: z.string().trim().optional() })
      .parse(req.body);
    // apiKey 不传表示保持原值
    saveAgentConfig(patch.apiKey === undefined ? { baseUrl: patch.baseUrl, model: patch.model } : patch);
    res.json({ ok: true });
  });
  app.post('/api/agent/chat', async (req, res) => {
    const { message, conversationId, scope } = z
      .object({
        message: z.string().trim().min(1),
        conversationId: z.string().optional(),
        scope: z.enum(scopes as [Scope, ...Scope[]]).default('today'),
      })
      .parse(req.body);
    res.json(await chat(message, scope, conversationId));
  });
  app.delete('/api/agent/chat/:id', (req, res) => {
    resetConversation(req.params.id);
    res.json({ ok: true });
  });

  // ───────── 根据对话起草工作总结 ─────────
  // 后台跑，进度和结果通过 /api/events 的 job 事件推送；key 形如 draft:2026-10-28
  const runners = { draft: draftSummary, todos: proposeTodos };
  const jobInput = z.object({ kind: z.enum(['draft', 'todos']), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
  app.post('/api/summary/:kind', (req, res) => {
    const { kind, date } = jobInput.parse({ ...req.body, kind: req.params.kind });
    res.json(startJob<unknown>(`${kind}:${date}`, (progress) => runners[kind](date, progress)));
  });
  app.get('/api/summary/:kind', (req, res) => {
    const { kind, date } = jobInput.parse({ kind: req.params.kind, date: req.query.date });
    res.json(getJob(`${kind}:${date}`));
  });
  app.delete('/api/summary/:kind', (req, res) => {
    const { kind, date } = jobInput.parse({ kind: req.params.kind, date: req.query.date });
    clearJob(`${kind}:${date}`);
    res.json({ ok: true });
  });

  // ───────── 每日笔记文件夹 ─────────
  app.get('/api/notes/config', (_req, res) => {
    // dir 是实际在用的文件夹；obsidianDir 是设置里填的 Obsidian 文件夹（切回本地模式也保留）
    const { mode, dir } = notesConfig();
    res.json({ mode, dir: notesDir(), obsidianDir: dir, localDir: localNotesDir(), fromEnv: !!process.env.HUB_NOTES_DIR });
  });
  app.put('/api/notes/config', (req, res) => {
    const body = z
      .discriminatedUnion('mode', [
        z.object({ mode: z.literal('local'), dir: z.string().trim().optional() }),
        z.object({ mode: z.literal('obsidian'), dir: z.string().trim().min(1, '请填写 Obsidian 里的文件夹路径') }),
      ])
      .parse(req.body);
    saveNotesConfig({ mode: body.mode, dir: body.dir ?? notesConfig().dir });
    events.emit('change', { module: 'todo' });
    events.emit('change', { module: 'worklog' });
    res.json({ ok: true });
  });

  // ───────── 文件与前端 ─────────
  app.use('/files', express.static(filesDir));
  if (staticDir) {
    app.use(express.static(staticDir));
    app.get('/{*path}', (_req, res) => res.sendFile(join(staticDir, 'index.html')));
  }

  app.use(((err, _req, res, _next) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: z.prettifyError(err) });
    if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
    if (err instanceof ProposalError || err instanceof AgentConfigError || err instanceof NotesNotConfigured || err instanceof NothingToSummarize) return res.status(409).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }) satisfies ErrorRequestHandler);

  return app;
}

/** 启动服务；port 为 0 时随机端口。返回实际端口 */
export function startServer(port: number, staticDir?: string) {
  // 在 Obsidian 或编辑器里改了每日笔记，也让界面刷新
  watchNotes(() => {
    events.emit('change', { module: 'todo' });
    events.emit('change', { module: 'worklog' });
  });
  return new Promise<{ port: number; close: () => void }>((resolve, reject) => {
    // Express 5 出错时也会调用回调，并把错误作为参数传入
    const server = createApp(staticDir).listen(port, '127.0.0.1', (err?: Error) => {
      if (err) return reject(err);
      resolve({ port: (server.address() as AddressInfo).port, close: () => server.close() });
    });
  });
}
