// 每一页底部的 agent 对话框。每个页面一个独立的对话（scope），用各自的固定提示词；
// 切到别的页面再回来，这一页的对话还在。
// agent 只能调用模块开放的工具，写操作会变成提案，直接在对话里批准或拒绝。
import { ChevronDown, ChevronUp, Eraser, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, onEvent } from '../core/client.ts';
import type { Proposal } from '../today/Timeline.tsx';
import { Button, IconButton } from '../ui/kit.tsx';

interface Step {
  tool: string;
  kind: 'query' | 'mutation';
  ok: boolean;
  detail: string;
}
interface Reply {
  conversationId: string;
  reply: string;
  steps: Step[];
  proposals: Proposal[];
}
/** 对话里保存的提案，状态随服务端推送更新 */
type Card = Pick<Proposal, 'id' | 'summary' | 'status'> & { error?: string };
export interface AgentConfig {
  configured: boolean;
  baseUrl: string;
  model: string;
  hasKey: boolean;
}
type Msg =
  | { role: 'user'; text: string }
  | { role: 'agent'; text: string; steps: Step[]; proposals?: Card[] }
  | { role: 'error'; text: string };

const toCard = (p: Proposal): Card => ({
  id: p.id,
  summary: p.summary,
  status: p.status,
  error: p.status === 'failed' ? (p.result as { error?: string } | null)?.error : undefined,
});

const STATUS: Record<Proposal['status'], string> = { pending: '待批准', applied: '已执行', rejected: '已拒绝', failed: '执行失败' };

const STORAGE = 'hub.agent.v2';
type Convo = { id?: string; log: Msg[] };

/** 模型回复里最常见的 **加粗**，其它 Markdown 保持原样显示 */
const withBold = (text: string) =>
  text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));

function loadSaved(): Record<string, Convo> {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE) ?? '') ?? {};
  } catch {
    return {};
  }
}

/** scope：today 或模块 id，决定用哪个对话和提示词；name：显示在输入框里的助手名 */
export function AgentDock({ scope, name, onOpenSettings }: { scope: string; name: string; onOpenSettings: () => void }) {
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [all, setAll] = useState(loadSaved);
  const { id, log } = all[scope] ?? { log: [] };
  // 回调里拿到的 scope 是发消息时的那一页，回复到达时即使已经换页也写回原来的对话
  const setConvo = (fn: (c: Convo) => Convo, target = scope) =>
    setAll((a) => ({ ...a, [target]: fn(a[target] ?? { log: [] }) }));
  const [text, setText] = useState('');
  // 正在等回复的页面；每页各算各的，别的页面照常能聊
  const [waiting, setWaiting] = useState<string[]>([]);
  const busy = waiting.includes(scope);
  const [open, setOpen] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  const [acting, setActing] = useState<string[]>([]);

  // 换页时重新读一次配置（可能刚在设置页改过）
  useEffect(() => void api.get<AgentConfig>('/api/agent/config').then(setConfig), [scope]);

  // 提案状态变化（这里批准的，或者从别处处理的）同步到所有对话里的卡片
  useEffect(() => {
    const patch = (p: Proposal) =>
      setAll((a) => {
        let hit = false;
        const next = Object.fromEntries(
          Object.entries(a).map(([k, c]) => [
            k,
            {
              ...c,
              log: c.log.map((m) =>
                m.role === 'agent' && m.proposals?.some((x) => x.id === p.id)
                  ? ((hit = true), { ...m, proposals: m.proposals.map((x) => (x.id === p.id ? toCard(p) : x)) })
                  : m,
              ),
            },
          ]),
        );
        return hit ? next : a;
      });
    // 刷新页面后对话从 sessionStorage 恢复，补一次最新状态
    void api.get<Proposal[]>('/api/proposals').then((ps) => ps.forEach(patch)).catch(() => {});
    return onEvent('proposal', (data) => patch(data as Proposal));
  }, []);

  const settle = async (ids: string[], verb: 'approve' | 'reject') => {
    setActing((x) => [...x, ...ids]);
    try {
      // 逐个执行，后一个可能依赖前一个的结果；失败会以 failed 状态推送回来
      for (const pid of ids) await api.post(`/api/proposals/${pid}/${verb}`).catch(() => {});
    } finally {
      setActing((x) => x.filter((pid) => !ids.includes(pid)));
    }
  };
  useEffect(() => {
    sessionStorage.setItem(STORAGE, JSON.stringify(all));
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [all, scope, busy, open]);

  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    const target = scope;
    setText('');
    setWaiting((w) => [...w, target]);
    setOpen(true);
    setConvo((c) => ({ ...c, log: [...c.log, { role: 'user', text: message }] }), target);
    try {
      const r = await api.post<Reply>('/api/agent/chat', { message, conversationId: id, scope: target });
      setConvo(
        (c) => ({
          id: r.conversationId,
          log: [...c.log, { role: 'agent', text: r.reply, steps: r.steps, proposals: r.proposals.map(toCard) }],
        }),
        target,
      );
    } catch (err) {
      setConvo((c) => ({ ...c, log: [...c.log, { role: 'error', text: (err as Error).message }] }), target);
    } finally {
      setWaiting((w) => w.filter((x) => x !== target));
    }
  };

  // 开新对话等于放弃这段对话里还没批准的提案，直接拒绝，免得留下没人处理的提案
  const reset = () => {
    const pending = log.flatMap((m) => (m.role === 'agent' ? (m.proposals ?? []) : [])).filter((p) => p.status === 'pending');
    if (pending.length) void settle(pending.map((p) => p.id), 'reject');
    if (id) void api.del(`/api/agent/chat/${id}`);
    setConvo(() => ({ log: [] }));
  };

  const configured = config?.configured;

  return (
    <div className="agent-dock">
      {open && log.length > 0 && (
        <div className="agent-log" ref={logRef}>
          {log.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="msg-user">
                {m.text}
              </div>
            ) : m.role === 'error' ? (
              <div key={i} className="error">
                {m.text}
              </div>
            ) : (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {/* 成功生成的提案在下面以卡片显示，这里不重复列出 */}
                {m.steps.filter((s) => !(s.kind === 'mutation' && s.ok && m.proposals)).map((s, j) => (
                  <div key={j} className="msg-step" style={s.ok ? undefined : { color: 'var(--danger)' }}>
                    <span>{s.kind === 'mutation' ? '提案' : '查询'}</span>
                    <span>{s.tool.replace('__', '.')}</span>
                    <span>{s.detail}</span>
                  </div>
                ))}
                <div className="msg-agent">{withBold(m.text)}</div>
                {m.proposals?.map((p) => {
                  const working = acting.includes(p.id);
                  return (
                    <div key={p.id} className={`proposal-card proposal-card--${p.status}`}>
                      <span className="proposal-card__text">
                        {p.summary}
                        {p.error && <span className="error">（{p.error}）</span>}
                      </span>
                      {p.status === 'pending' ? (
                        <>
                          <Button disabled={working} onClick={() => void settle([p.id], 'approve')}>
                            {working ? '执行中…' : '批准'}
                          </Button>
                          <Button disabled={working} onClick={() => void settle([p.id], 'reject')}>
                            拒绝
                          </Button>
                        </>
                      ) : (
                        <span className="proposal-card__status">{STATUS[p.status]}</span>
                      )}
                    </div>
                  );
                })}
                {(m.proposals?.filter((p) => p.status === 'pending').length ?? 0) > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <Button
                      disabled={m.proposals!.some((p) => acting.includes(p.id))}
                      onClick={() => void settle(m.proposals!.filter((p) => p.status === 'pending').map((p) => p.id), 'approve')}
                    >
                      全部批准
                    </Button>
                    <Button
                      disabled={m.proposals!.some((p) => acting.includes(p.id))}
                      onClick={() => void settle(m.proposals!.filter((p) => p.status === 'pending').map((p) => p.id), 'reject')}
                    >
                      全部拒绝
                    </Button>
                  </div>
                )}
              </div>
            ),
          )}
          {busy && <div className="muted">思考中…</div>}
        </div>
      )}
      <div className="agent-input">
        <div className="quick-add">
          <input
            className="input"
            value={text}
            placeholder={configured === false ? 'agent 还没配置' : `问问${name}…`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void send()}
            disabled={!configured}
          />
          {log.length > 0 && (
            <IconButton icon={open ? ChevronDown : ChevronUp} label={open ? '收起对话' : `展开对话（${log.length}）`} ghost onClick={() => setOpen(!open)} />
          )}
          {log.length > 0 && <IconButton icon={Eraser} label="新对话" ghost onClick={reset} />}
          <IconButton icon={Send} label="发送" ghost onClick={() => void send()} disabled={busy || !configured} />
        </div>
        {configured === false && (
          <div className="muted" style={{ marginTop: 6 }}>
            在<a onClick={onOpenSettings}>设置</a>里填一个 OpenAI 兼容接口就能用；外部 agent 也可以直接调用本机的 /api/tools。
          </div>
        )}
      </div>
    </div>
  );
}
