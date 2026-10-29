// 共享组件：所有模块页和「今天」页都用这一套，不各自写样式。
import { ChevronLeft, ChevronRight, LoaderCircle, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { beijingClock, beijingDate } from '../../../core/time.ts';
import { formatDate, shiftDate, today, useDate } from '../core/date.tsx';

export function Button({
  variant,
  icon: Icon,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost'; icon?: LucideIcon }) {
  return (
    <button type="button" className={`btn ${variant ? `btn--${variant}` : ''} ${className}`} {...rest}>
      {Icon && <Icon size={15} />}
      {children}
    </button>
  );
}

export function IconButton({
  icon: Icon,
  label,
  size = 'md',
  ghost,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; size?: 'sm' | 'md'; ghost?: boolean }) {
  return (
    <button
      type="button"
      className={`icon-btn ${size === 'sm' ? 'icon-btn--sm' : ''} ${ghost ? 'icon-btn--ghost' : ''}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon size={size === 'sm' ? 14 : 16} />
    </button>
  );
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <input type="checkbox" className="check" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />;
}

export type Tone = 'accent' | 'ok' | 'info' | 'warn' | 'danger';

export function Chip({ tone, children, onClick, title }: { tone?: Tone; children: ReactNode; onClick?: () => void; title?: string }) {
  const cls = `chip ${tone ? `chip--${tone}` : ''}`;
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} title={title}>
      {children}
    </button>
  ) : (
    <span className={cls} title={title}>
      {children}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * 单行快速添加。提交时先清空输入框，失败再把文字放回去，
 * 这样等待请求期间继续输入的内容不会被清掉。
 */
export function QuickAdd({
  placeholder,
  onSubmit,
  before,
  after,
}: {
  placeholder: string;
  onSubmit: (text: string) => Promise<unknown>;
  before?: ReactNode;
  after?: ReactNode;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    setText('');
    setError('');
    try {
      await onSubmit(value);
    } catch (err) {
      setText((t) => (t ? t : value));
      setError((err as Error).message);
    }
  };
  return (
    <div>
      <div className="quick-add">
        {before}
        <input
          className="input"
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit();
          }}
        />
        {after}
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

/** 点击即可编辑的文字，回车或失焦保存，Esc 取消 */
export function InlineEdit({ value, onSave, className = '' }: { value: string; onSave: (v: string) => unknown; className?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const v = draft.trim();
    if (v && v !== value) onSave(v);
    else setDraft(value);
  };
  return (
    <input
      className={`inline-edit ${className}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(value);
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

/**
 * 自动保存的文本框。没有未保存的修改时，外部值变化（比如 agent 提案被批准）会同步进来；
 * resetKey 变化（比如切换日期）时直接换成新值。
 */
export function AutoSaveText({
  value,
  resetKey,
  onSave,
  className = 'textarea',
  placeholder,
  delay = 700,
  onStatus,
  autoGrow = false,
  autoFocus = false,
}: {
  value: string;
  resetKey?: string;
  onSave: (v: string) => Promise<unknown>;
  className?: string;
  placeholder?: string;
  delay?: number;
  onStatus?: (s: 'idle' | 'dirty' | 'saving' | 'saved' | 'error') => void;
  /** 高度跟着内容走，不出内部滚动条 */
  autoGrow?: boolean;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!autoGrow || !el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [draft, autoGrow]);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef({ onSave, onStatus });
  latest.current = { onSave, onStatus };

  useEffect(() => {
    clearTimeout(timer.current);
    dirty.current = false;
    setDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [value]);

  const save = async (v: string) => {
    latest.current.onStatus?.('saving');
    try {
      await latest.current.onSave(v);
      dirty.current = false;
      latest.current.onStatus?.('saved');
    } catch {
      latest.current.onStatus?.('error');
    }
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <textarea
      ref={ref}
      className={className}
      value={draft}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        dirty.current = true;
        onStatus?.('dirty');
        clearTimeout(timer.current);
        timer.current = setTimeout(() => void save(v), delay);
      }}
      onBlur={() => {
        if (dirty.current) {
          clearTimeout(timer.current);
          void save(draft);
        }
      }}
    />
  );
}

/** 正在进行的后台任务：转圈 + 当前步骤 + 已用时间 */
export function Working({ text, since }: { text: string; since: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 1000));
  return (
    <div className="working" role="status">
      <LoaderCircle size={15} className="spin" />
      <span>{text}</span>
      <span className="muted">{secs} 秒</span>
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;

export const Progress = ({ value }: { value: number }) => (
  <div className="progress">
    <span style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
  </div>
);

export function DateNav() {
  const { date, setDate, isToday } = useDate();
  return (
    <div className="date-nav">
      <IconButton icon={ChevronLeft} label="前一天" ghost onClick={() => setDate(shiftDate(date, -1))} />
      <span className="date-nav__label">{formatDate(date)}</span>
      <IconButton icon={ChevronRight} label="后一天" ghost onClick={() => setDate(shiftDate(date, 1))} />
      {!isToday && <Button onClick={() => setDate(today())}>回到今天</Button>}
    </div>
  );
}

/** 页面的标准骨架：标题 + 工具栏 + 可滚动内容。模块页和「今天」页共用 */
export function PageFrame({ title, sub, tools, children }: { title: string; sub?: ReactNode; tools?: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">
          {title}
          {sub && <span className="page__sub">{sub}</span>}
        </h1>
        <div className="page__tools">{tools}</div>
      </header>
      <main className="page__body">{children}</main>
    </div>
  );
}

export const clock = (iso: string) => beijingClock(iso);

/** 相对时间：刚刚 / 5 分钟前 / 14:20 / 10.26 */
export function timeAgo(iso: string) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  const hm = beijingClock(d);
  const day = beijingDate(d);
  return day === beijingDate() ? hm : `${Number(day.slice(5, 7))}.${Number(day.slice(8))} ${hm}`;
}
