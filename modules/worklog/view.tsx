import { ClipboardList, ListPlus, NotebookPen, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { call, useQuery } from '../../web/src/core/client.ts';
import { useJob } from '../../web/src/core/jobs.ts';
import { today, useDate } from '../../web/src/core/date.tsx';
import { AutoSaveText, Button, DateNav, PageFrame, timeAgo, Working } from '../../web/src/ui/kit.tsx';
import type { ModuleView } from '../../web/src/views.ts';

const STATUS = { idle: '', dirty: '未保存', saving: '保存中…', saved: '已保存', error: '保存失败' } as const;

interface Draft {
  draft: string;
  sessions: number;
  turns: number;
}

interface Draft {
  draft: string;
  sessions: number;
  turns: number;
}

interface TodoResult {
  suggested: number;
  created: number;
}

/** 生成出来的草稿：可以先改，再替换或追加到总结 */
function DraftEditor({ draft, current, date, onDone }: { draft: Draft; current: string; date: string; onDone: () => void }) {
  const [text, setText] = useState(draft.draft);
  const write = async (content: string) => {
    await call('worklog', 'save', { date, content });
    onDone();
  };
  return (
    <section className="panel">
      <div className="muted">
        根据 {draft.sessions} 个 Claude 会话、共 {draft.turns} 轮对话生成，可以先改再写入
      </div>
      <textarea className="textarea" rows={10} value={text} onChange={(e) => setText(e.target.value)} />
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" onClick={() => void write(text)}>
          {current.trim() ? '替换现有总结' : '写入总结'}
        </Button>
        {current.trim() && <Button onClick={() => void write(`${current.trim()}\n\n${text}`)}>追加到末尾</Button>}
        <Button variant="ghost" onClick={onDone}>
          放弃
        </Button>
      </div>
    </section>
  );
}

/**
 * 从这一天的 Claude 对话生成：总结草稿、待办提案。
 * 都是后台任务，切换页面再回来进度和结果还在。
 */
function FromChats({ date, current }: { date: string; current: string }) {
  const draft = useJob<Draft>('draft', date);
  const todos = useJob<TodoResult>('todos', date);
  const t = todos.job?.status === 'done' ? todos.job.result : undefined;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Button icon={Sparkles} onClick={draft.start} disabled={draft.running}>
          根据当天的 Claude 对话写总结
        </Button>
        <Button icon={ListPlus} onClick={todos.start} disabled={todos.running}>
          从对话整理待办提案
        </Button>
      </div>
      {draft.running && <Working text={`写总结：${draft.job!.progress}`} since={draft.job!.startedAt} />}
      {todos.running && <Working text={`整理待办：${todos.job!.progress}`} since={todos.job!.startedAt} />}
      {draft.job?.status === 'error' && <div className="error">写总结失败：{draft.job.error}</div>}
      {todos.job?.status === 'error' && <div className="error">整理待办失败：{todos.job.error}</div>}
      {t && (
        <div className="muted">
          {t.created ? (
            <>
              已生成 {t.created} 条待办提案，<a onClick={() => (location.hash = '#/today')}>去「今天」页批准</a>
            </>
          ) : t.suggested ? (
            '找到的事都已经在待办或待批准里了'
          ) : (
            '没找到需要跟进的事'
          )}
        </div>
      )}
      {draft.job?.status === 'done' && draft.job.result && (
        <DraftEditor key={draft.job.startedAt} draft={draft.job.result} current={current} date={date} onDone={draft.clear} />
      )}
    </>
  );
}

function Page() {
  const { date } = useDate();
  const { data } = useQuery('worklog', 'get', { date });
  const [status, setStatus] = useState<keyof typeof STATUS>('idle');
  const [note, setNote] = useState('');

  // 「插入今日完成」走 append，和 agent 用的是同一个 action
  const insertDone = async () => {
    const { count, markdown } = await call('worklog', 'collectDone', { date });
    if (!count) return setNote('这一天还没有完成的待办或读完的条目');
    setNote('');
    await call('worklog', 'append', { date, text: markdown });
  };

  return (
    <PageFrame
      title="工作总结"
      tools={
        <>
          <DateNav />
          <Button icon={ClipboardList} onClick={() => void insertDone()} title="把这一天完成的待办和读完的条目追加到末尾">
            插入今日完成
          </Button>
        </>
      }
    >
      <FromChats date={date} current={data?.content ?? ''} />
      <div className="muted" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>存在每日笔记的「工作总结」一节，输入后自动保存</span>
        <span>{status === 'idle' && data?.updatedAt ? `更新于 ${timeAgo(data.updatedAt)}` : STATUS[status]}</span>
      </div>
      {note && <div className="muted">{note}</div>}
      {data && (
        <AutoSaveText
          className="worklog-text"
          value={data.content}
          resetKey={date}
          placeholder="今天做了什么、遇到了什么问题、明天打算做什么……"
          onStatus={setStatus}
          onSave={(content) => call('worklog', 'save', { date, content })}
        />
      )}
    </PageFrame>
  );
}

/** 侧栏数字：今天总结的字数 */
function Badge() {
  const { data } = useQuery('worklog', 'get', { date: today() });
  return data ? <>{data.content.replace(/\s/g, '').length}</> : null;
}

export const worklogView: ModuleView = { icon: NotebookPen, Page, Badge };
