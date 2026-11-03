import { AlarmClock, Archive, ArchiveRestore, ChevronDown, ChevronRight, FolderInput, ListTodo, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { call, useQuery } from '../../web/src/core/client.ts';
import { today, useDate } from '../../web/src/core/date.tsx';
import { beijingAt } from '../../core/time.ts';
import { cityTimes, useWorldClock } from '../../web/src/core/worldclock.ts';
import { Check, Chip, DateNav, Empty, IconButton, InlineEdit, PageFrame, Progress, QuickAdd } from '../../web/src/ui/kit.tsx';
import type { ModuleView } from '../../web/src/views.ts';
import type { Todo } from './module.ts';

/** 1430、14:30、9:05 → HH:MM，格式不对返回 null。不用 type="time"：它跟着系统语言变成 12 小时制 */
function parseTime(text: string) {
  const m = /^([01]?\d|2[0-3])[:：]?([0-5]\d)$/.exec(text.trim());
  return m && `${m[1].padStart(2, '0')}:${m[2]}`;
}

/** 提醒时间输入框：回车或失焦保存，Esc 取消，清空就是不提醒，格式不对时保持原样 */
function TimeInput({ t, onClose }: { t: Todo; onClose: () => void }) {
  const [value, setValue] = useState(t.time ?? '');
  const commit = () => {
    const time = value.trim() ? parseTime(value) : null;
    if ((time || !value.trim()) && time !== t.time) void call('todo', 'setTime', { id: t.id, time });
    onClose();
  };
  return (
    <input
      className="time-input"
      aria-label="提醒时间（北京时间）"
      title="北京时间，比如 14:30"
      placeholder="HH:MM"
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur();
        if (e.key === 'Escape') onClose();
      }}
    />
  );
}

/** 换分类的输入框：可以选已有的分类，也可以新写一个，清空就是移出分类 */
function CategoryInput({ t, onClose }: { t: Todo; onClose: () => void }) {
  const [value, setValue] = useState(t.category ?? '');
  const commit = () => {
    const category = value.trim() || null;
    if (category !== t.category) void call('todo', 'setCategory', { id: t.id, category });
    onClose();
  };
  return (
    <input
      className="category-input"
      aria-label="分类"
      list="todo-categories"
      placeholder="分类，清空即不分类"
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur();
        if (e.key === 'Escape') onClose();
      }}
    />
  );
}

function TodoRow({ t }: { t: Todo }) {
  const [editingTime, setEditingTime] = useState(false);
  const [editingCategory, setEditingCategory] = useState(false);
  const cities = useWorldClock();
  return (
    <li className={`list-row ${t.done ? 'todo--done' : ''} ${t.doing ? 'todo--doing' : ''}`}>
      <Check checked={t.done} label="完成" onChange={(done) => call('todo', 'setDone', { id: t.id, done })} />
      <div className="list-row__main">
        <div className="todo-title">
          <InlineEdit value={t.title} onSave={(title) => call('todo', 'update', { id: t.id, title })} />
          {t.doing && <Chip tone="warn">处理中</Chip>}
          {t.archived && t.category && <Chip>{t.category}</Chip>}
          {editingTime ? (
            <TimeInput t={t} onClose={() => setEditingTime(false)} />
          ) : (
            t.time && (
              <Chip tone={t.done ? undefined : 'accent'} title={`北京时间。${cityTimes(cities, beijingAt(t.date, t.time))}`} onClick={() => setEditingTime(true)}>
                <AlarmClock size={12} />
                {t.time}
              </Chip>
            )
          )}
          {editingCategory && <CategoryInput t={t} onClose={() => setEditingCategory(false)} />}
        </div>
      </div>
      <div className="row-actions">
        {!t.time && !t.done && !t.archived && !editingTime && <IconButton icon={AlarmClock} label="设置提醒时间" size="sm" ghost onClick={() => setEditingTime(true)} />}
        {!t.done && !t.archived && (
          <IconButton
            icon={t.doing ? Pause : Play}
            label={t.doing ? '暂停处理' : '开始处理'}
            size="sm"
            ghost
            onClick={() => call('todo', 'setDoing', { id: t.id, doing: !t.doing })}
          />
        )}
        {!t.done && (
          <IconButton
            icon={t.archived ? ArchiveRestore : Archive}
            label={t.archived ? '恢复' : '暂时归档'}
            size="sm"
            ghost
            onClick={() => call('todo', 'setArchived', { id: t.id, archived: !t.archived })}
          />
        )}
        {!t.archived && !editingCategory && <IconButton icon={FolderInput} label="换分类" size="sm" ghost onClick={() => setEditingCategory(true)} />}
        <IconButton icon={Trash2} label="删除" size="sm" ghost onClick={() => call('todo', 'remove', { id: t.id })} />
      </div>
    </li>
  );
}

/** 分类名 → 色相，同一个分类每天都是同一个颜色 */
function hue(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return (h % 12) * 30;
}

/** 分类里的快速添加：回车加到这个分类最后 */
function GroupAdd({ category, date }: { category: string; date: string }) {
  const [text, setText] = useState('');
  const submit = async () => {
    const title = text.trim();
    if (!title) return;
    setText('');
    await call('todo', 'add', { title, category, date }).catch(() => setText((t) => t || title));
  };
  return (
    <div className="todo-group__add">
      <Plus size={14} />
      <input
        value={text}
        placeholder="在这个分类里添加"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit();
        }}
      />
    </div>
  );
}

function Group({ name, todos, date }: { name: string; todos: Todo[]; date: string }) {
  const done = todos.filter((t) => t.done).length;
  const [open, setOpen] = useState(true);
  return (
    <section className={`todo-group ${done === todos.length ? 'todo-group--done' : ''}`} style={{ '--h': hue(name) } as CSSProperties}>
      <header className="todo-group__head">
        <IconButton icon={open ? ChevronDown : ChevronRight} label={open ? '收起' : '展开'} size="sm" ghost onClick={() => setOpen(!open)} />
        <i className="todo-group__dot" />
        <InlineEdit className="todo-group__name" value={name} onSave={(to) => call('todo', 'renameCategory', { date, from: name, to })} />
        <span className="muted">
          {done} / {todos.length}
        </span>
      </header>
      {open && (
        <>
          <ul className="list">
            {todos.map((t) => (
              <TodoRow key={t.id} t={t} />
            ))}
          </ul>
          <GroupAdd category={name} date={date} />
        </>
      )}
    </section>
  );
}

/** 归档的待办收在最下面，默认收起 */
function Archived({ todos }: { todos: Todo[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="todo-archived">
      <button className="todo-archived__head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Archive size={14} />
        已归档 {todos.length}
      </button>
      {open && (
        <ul className="list">
          {todos.map((t) => (
            <TodoRow key={t.id} t={t} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Page() {
  const { date } = useDate();
  const { data: all, error } = useQuery('todo', 'list', { date });
  const data = all?.filter((t) => !t.archived);
  const archived = all?.filter((t) => t.archived) ?? [];
  const done = data?.filter((t) => t.done).length ?? 0;
  const doing = data?.filter((t) => t.doing).length ?? 0;
  const [time, setTime] = useState('');
  const [category, setCategory] = useState('');
  const loose = data?.filter((t) => !t.category) ?? [];
  const groups = [...new Set(data?.flatMap((t) => (t.category ? [t.category] : [])))];
  const categories = [...new Set(all?.flatMap((t) => (t.category ? [t.category] : [])))];

  return (
    <PageFrame title="每日待办" tools={<DateNav />}>
      <QuickAdd
        placeholder="添加待办，回车保存"
        before={<input className="category-input category-input--add" aria-label="分类" title="分类（一件大事的名字），可不填" list="todo-categories" placeholder="分类" value={category} onChange={(e) => setCategory(e.target.value)} />}
        after={<input className="time-input" aria-label="提醒时间（北京时间）" title="提醒时间（北京时间），可不填，比如 14:30" placeholder="HH:MM" value={time} onChange={(e) => setTime(e.target.value)} />}
        onSubmit={async (title) => {
          const parsed = time.trim() ? parseTime(time) : null;
          if (time.trim() && !parsed) throw new Error('时间格式不对，写成 14:30 这样');
          await call('todo', 'add', { title, date, time: parsed ?? undefined, category: category.trim() || undefined });
          setTime('');
        }}
      />
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
      <datalist id="todo-categories">
        {categories.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
      {error && <div className="error">{error}</div>}
      {data &&
        (data.length ? (
          <div className="todo-groups">
            {loose.length > 0 && (
              <ul className="list">
                {loose.map((t) => (
                  <TodoRow key={t.id} t={t} />
                ))}
              </ul>
            )}
            {groups.map((g) => (
              <Group key={g} name={g} todos={data.filter((t) => t.category === g)} date={date} />
            ))}
          </div>
        ) : (
          <Empty>{archived.length ? '这一天的待办都归档了' : '这一天没有待办'}</Empty>
        ))}
      {archived.length > 0 && <Archived todos={archived} />}
    </PageFrame>
  );
}

/** 侧栏数字：今天还没完成、也没归档的待办 */
function Badge() {
  const { data } = useQuery('todo', 'list', { date: today() });
  return data ? <>{data.filter((t) => !t.done && !t.archived).length}</> : null;
}

export const todoView: ModuleView = { icon: ListTodo, Page, Badge };
