// 今天的时间线：各模块的操作记录 + 外部 agent 的提案（待批准的高亮，可以直接批准或拒绝）。
// 内置对话框里发起的提案在对话框里批准，这里不重复列出。
import { Fragment, useEffect, useState } from 'react';
import { beijingDate } from '../../../core/time.ts';
import { api, onEvent } from '../core/client.ts';
import { today } from '../core/date.tsx';
import { Button, Chip, clock } from '../ui/kit.tsx';

interface Activity {
  id: number;
  module: string;
  summary: string;
  via: 'ui' | 'agent';
  at: string;
}

export interface Proposal {
  id: string;
  /** 内置对话框发起的提案是 chat- 开头的对话 id；外部 agent 为自带的 x-conversation 或 null */
  conversation: string | null;
  module: string;
  summary: string;
  status: 'pending' | 'applied' | 'rejected' | 'failed';
  result: unknown;
  createdAt: string;
  updatedAt: string;
}

type Row =
  | { kind: 'activity'; at: string; a: Activity }
  | { kind: 'pending'; at: string; p: Proposal }
  | { kind: 'settled'; at: string; p: Proposal };

const fromChat = (p: Proposal) => Boolean(p.conversation?.startsWith('chat-'));
/** 「更新了…」这类记录（如自动保存总结）一天会有很多条，只露出最新几条，其余折叠 */
const isUpdate = (r: Row) => r.kind === 'activity' && r.a.summary.startsWith('更新了');
const SHOWN_UPDATES = 2;
const isToday = (iso: string) => beijingDate(iso) === beijingDate();

export function Timeline({ onOpenModule }: { onOpenModule: (id: string) => void }) {
  const [activity, setActivity] = useState<Activity[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [showAllUpdates, setShowAllUpdates] = useState(false);

  useEffect(() => {
    const loadActivity = () => void api.get<Activity[]>(`/api/activity?date=${today()}`).then(setActivity).catch(() => {});
    const loadProposals = () => void api.get<Proposal[]>('/api/proposals').then(setProposals).catch(() => {});
    loadActivity();
    loadProposals();
    const offs = [onEvent('activity', loadActivity), onEvent('proposal', loadProposals)];
    return () => offs.forEach((off) => off());
  }, []);

  const act = async (id: string, verb: 'approve' | 'reject') => {
    setBusy(id);
    setError('');
    try {
      await api.post(`/api/proposals/${id}/${verb}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  // 批准后的提案会以普通操作记录出现，这里只额外列出待批准和执行失败的（拒绝的不显示）
  const rows: Row[] = [
    ...activity.map((a): Row => ({ kind: 'activity', at: a.at, a })),
    ...proposals.filter((p) => p.status === 'pending' && !fromChat(p)).map((p): Row => ({ kind: 'pending', at: p.createdAt, p })),
    ...proposals
      .filter((p) => p.status === 'failed' && !fromChat(p) && isToday(p.updatedAt))
      .map((p): Row => ({ kind: 'settled', at: p.updatedAt, p })),
  ].sort((x, y) => y.at.localeCompare(x.at));

  if (!rows.length) return <div className="tl-empty">今天还没有动静。在左侧打开模块开始记录，或者在下面让 agent 帮忙。</div>;

  const updates = rows.filter(isUpdate);
  const hidden = showAllUpdates ? [] : updates.slice(SHOWN_UPDATES);
  // 折叠时开关放在露出的最后一条后面，展开时放在最早一条更新后面
  const toggleAfter = updates.length > SHOWN_UPDATES ? updates[showAllUpdates ? updates.length - 1 : SHOWN_UPDATES - 1] : null;

  const pending = rows.filter((r): r is Extract<Row, { kind: 'pending' }> => r.kind === 'pending');
  const settleAll = async (verb: 'approve' | 'reject') => {
    for (const r of pending) await act(r.p.id, verb);
  };

  return (
    <div className="timeline">
      {pending.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 4 }}>
          <Button disabled={Boolean(busy)} onClick={() => void settleAll('approve')}>
            全部批准（{pending.length}）
          </Button>
          <Button disabled={Boolean(busy)} onClick={() => void settleAll('reject')}>
            全部拒绝
          </Button>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {rows.map((r) => {
        if (r.kind === 'activity') {
          if (hidden.includes(r)) return null;
          return (
            <Fragment key={`a${r.a.id}`}>
              <div className="tl-row tl-row--link" onClick={() => onOpenModule(r.a.module)}>
                <span className="tl-time">{clock(r.at)}</span>
                <span className="tl-text">{r.a.summary}</span>
                {r.a.via === 'agent' && <Chip>agent</Chip>}
              </div>
              {r === toggleAfter && (
                <button type="button" className="tl-row tl-more" onClick={() => setShowAllUpdates((v) => !v)}>
                  <span className="tl-time" />
                  <span className="tl-text">{showAllUpdates ? '收起更早的更新' : `还有 ${updates.length - SHOWN_UPDATES} 条更早的更新`}</span>
                </button>
              )}
            </Fragment>
          );
        }
        if (r.kind === 'pending') {
          return (
            <div key={r.p.id} className="tl-row tl-row--pending">
              <span className="tl-time">{clock(r.at)}</span>
              <span className="tl-text">提案：{r.p.summary}</span>
              <Button disabled={busy === r.p.id} onClick={() => void act(r.p.id, 'approve')}>
                {busy === r.p.id ? '执行中…' : '批准'}
              </Button>
              <Button disabled={busy === r.p.id} onClick={() => void act(r.p.id, 'reject')}>
                拒绝
              </Button>
            </div>
          );
        }
        const err = r.p.status === 'failed' ? (r.p.result as { error?: string } | null)?.error : '';
        return (
          <div key={r.p.id} className="tl-row tl-row--muted">
            <span className="tl-time">{clock(r.at)}</span>
            <span className="tl-text">
              提案执行失败：{r.p.summary}
              {err && <span className="error">（{err}）</span>}
            </span>
            <Chip tone="danger">失败</Chip>
          </div>
        );
      })}
    </div>
  );
}
