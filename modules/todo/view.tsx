import { ListTodo, Pause, Play, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, call, useQuery } from '../../web/src/core/client.ts';
import { today, useDate } from '../../web/src/core/date.tsx';
import { Check, Chip, DateNav, Empty, IconButton, InlineEdit, PageFrame, Progress, QuickAdd } from '../../web/src/ui/kit.tsx';
import type { ModuleView } from '../../web/src/views.ts';
import type { Todo } from './module.ts';

function TodoRow({ t }: { t: Todo }) {
  return (
    <li className={`list-row ${t.details.length ? "list-row--top" : ""} ${t.done ? "todo--done" : ""} ${t.doing ? "todo--doing" : ""}`}>
      <Check checked={t.done} label="完成" onChange={(done) => call('todo', 'setDone', { id: t.id, done })} />
      <div className="list-row__main">
        <div className="todo-title">
          <InlineEdit value={t.title} onSave={(title) => call('todo', 'update', { id: t.id, title })} />
          {t.doing && <Chip tone="warn">处理中</Chip>}
        </div>
        {t.details.length > 0 && (
          <ul className="todo-details">
            {t.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="row-actions">
        {!t.done && (
          <IconButton
            icon={t.doing ? Pause : Play}
            label={t.doing ? '暂停处理' : '开始处理'}
            size="sm"
            ghost
            onClick={() => call('todo', 'setDoing', { id: t.id, doing: !t.doing })}
          />
        )}
        <IconButton icon={Trash2} label="删除" size="sm" ghost onClick={() => call('todo', 'remove', { id: t.id })} />
      </div>
    </li>
  );
}

/** 当前日期对应的笔记文件，比如 07每日待办/1028.md */
function useNoteFile(date: string) {
  const [dir, setDir] = useState('');
  useEffect(() => void api.get<{ dir: string }>('/api/notes/config').then((c) => setDir(c.dir)), []);
  if (!dir) return '';
  return `${dir.split('/').filter(Boolean).pop()}/${date.slice(5, 7)}${date.slice(8, 10)}.md`;
}

function Page() {
  const { date } = useDate();
  const { data, error } = useQuery('todo', 'list', { date });
  const file = useNoteFile(date);
  const done = data?.filter((t) => t.done).length ?? 0;
  const doing = data?.filter((t) => t.doing).length ?? 0;

  return (
    <PageFrame title="每日待办" sub={file} tools={<DateNav />}>
      <QuickAdd placeholder="添加待办，回车保存" onSubmit={(title) => call('todo', 'add', { title, date })} />
      {data && data.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <Progress value={done / data.length} />
          </div>
          <span className="muted">
            {doing > 0 && `${doing} 处理中 · `}
            {done} / {data.length}
          </span>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {data &&
        (data.length ? (
          <ul className="list">
            {data.map((t) => (
              <TodoRow key={t.id} t={t} />
            ))}
          </ul>
        ) : (
          <Empty>这一天没有待办</Empty>
        ))}
    </PageFrame>
  );
}

/** 侧栏数字：今天还没完成的待办 */
function Badge() {
  const { data } = useQuery('todo', 'list', { date: today() });
  return data ? <>{data.filter((t) => !t.done).length}</> : null;
}

export const todoView: ModuleView = { icon: ListTodo, Page, Badge };
