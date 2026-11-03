import { BookOpen, Check, FileText, Pencil, Lightbulb, MessageSquareText, Search, Trash2, X, type LucideIcon } from 'lucide-react';
import { Fragment, useState } from 'react';
import type { Item } from '../../core/module.ts';
import { call, useQuery } from '../../web/src/core/client.ts';
import { desktop } from '../../web/src/core/desktop.ts';
import { AutoSaveText, Button, Chip, Empty, IconButton, QuickAdd, Segmented, PageFrame, type Tone } from '../../web/src/ui/kit.tsx';
import type { ModuleView } from '../../web/src/views.ts';
import { MathText, withMath } from '../../web/src/ui/MathText.tsx';
import { parseArxivId } from './arxiv.ts';
import type { Kind, Reading, Status } from './module.ts';

const KINDS: Record<Kind, { label: string; icon: LucideIcon; tone: Tone }> = {
  paper: { label: '论文', icon: FileText, tone: 'accent' },
  tweet: { label: '推文', icon: MessageSquareText, tone: 'info' },
  note: { label: '知识点', icon: Lightbulb, tone: 'warn' },
};
const STATUS: Record<Status, { label: string; tone?: Tone; next: Status }> = {
  queue: { label: '待看', next: 'reading' },
  reading: { label: '在读', tone: 'info', next: 'done' },
  done: { label: '已读', tone: 'ok', next: 'queue' },
};

/** 拆出 #标签 */
const splitTags = (s: string) => ({
  text: s.replace(/(^|\s)#[^\s#]+/g, ' ').trim(),
  tags: [...s.matchAll(/(?:^|\s)#([^\s#]+)/g)].map((m) => m[1]),
});

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** 根据输入判断类型：arXiv 走收录论文；x.com / twitter 链接是推文；其它是知识点 */
async function addFromText(raw: string, kind: Kind | 'auto') {
  const { text, tags } = splitTags(raw);
  const url = /^https?:\/\//.test(text) ? text : '';
  const host = url ? hostOf(url) : '';
  const arxivId = parseArxivId(text);
  if ((kind === 'auto' || kind === 'paper') && arxivId && (!url || host.endsWith('arxiv.org'))) {
    return call('reading', 'savePaper', { arxivId, tags });
  }
  const isTweet = ['x.com', 'twitter.com', 'mobile.twitter.com'].includes(host);
  const resolved: Kind = kind !== 'auto' ? kind : isTweet ? 'tweet' : url && /\.pdf($|\?)/.test(url) ? 'paper' : 'note';
  const user = isTweet ? new URL(url).pathname.split('/')[1] : '';
  const title = url ? (user ? `@${user} 的推文` : host + new URL(url).pathname.replace(/\/$/, '')) : text;
  return call('reading', 'add', { kind: resolved, title, url, tags });
}

function KindLabel({ kind }: { kind: Kind }) {
  return (
    <span className="reading-kind">
      <i />
      {KINDS[kind].label}
    </span>
  );
}

/** 类型已由标签展示，去掉标题里重复的「知识点：」前缀 */
const displayTitle = (t: string) => t.replace(/^(知识点|论文|推文)[：:]\s*/, '');

function Title({ r }: { r: Item<Reading> }) {
  const title = <MathText text={displayTitle(r.data.title)} />;
  return (
    <h3 className="reading-title">
      {r.data.url ? (
        <a onClick={() => void desktop.openExternal(r.data.url)} title={r.data.url}>
          {title}
        </a>
      ) : (
        title
      )}
    </h3>
  );
}

/** 【重点】→ 高亮；$…$ 等 LaTeX 公式交给 KaTeX */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(【[^】]+】)/).map((part, i) =>
        /^【.+】$/.test(part) ? <mark key={i}>{withMath(part.slice(1, -1))}</mark> : <Fragment key={i}>{withMath(part)}</Fragment>,
      )}
    </>
  );
}

/** 笔记阅读视图：• / - / 1) 开头的行成列表；行首「要点：」这类短标签加粗；长段按句号拆开 */
function NoteBody({ text }: { text: string }) {
  const blocks: ({ list: string[] } | { para: string })[] = [];
  // 跨行的块级公式先并成一行，免得被按行拆开
  const joined = text.replace(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]/g, (m) => m.replace(/\s*\n\s*/g, ' '));
  for (const raw of joined.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^(?:[•\-*·]|\d+[)）.、])\s*(.*)$/);
    const last = blocks[blocks.length - 1];
    if (bullet) {
      if (last && 'list' in last) last.list.push(bullet[1]);
      else blocks.push({ list: [bullet[1]] });
    } else if (line.length > 80) {
      for (const sentence of line.match(/[^。！？]+[。！？]?/g) ?? [line]) blocks.push({ para: sentence.trim() });
    } else blocks.push({ para: line });
  }
  const para = (p: string) => {
    const m = p.match(/^([^：，。]{1,6})：(.*)$/);
    return m ? (
      <>
        <strong>{m[1]}：</strong>
        <Inline text={m[2]} />
      </>
    ) : (
      <Inline text={p} />
    );
  };
  return (
    <div className="reading-note">
      {blocks.map((b, i) =>
        'list' in b ? (
          <ul key={i}>
            {b.list.map((item, j) => (
              <li key={j}>{para(item)}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{para(b.para)}</p>
        ),
      )}
    </div>
  );
}

function ReadingCard({ r }: { r: Item<Reading> }) {
  const [editing, setEditing] = useState(false);
  const [absOpen, setAbsOpen] = useState(false);
  const s = STATUS[r.data.status];
  const authors = r.data.authors.length ? `${r.data.authors.slice(0, 3).join(', ')}${r.data.authors.length > 3 ? ' 等' : ''}` : '';
  const host = r.data.url && r.data.kind !== 'note' ? hostOf(r.data.url) : '';
  return (
    <li className={`reading-card reading-card--${r.data.kind} ${r.data.status === 'done' ? 'reading-card--done' : ''}`}>
      <div className="reading-card__head">
        <Title r={r} />
        <Chip tone={s.tone} title="点击切换状态" onClick={() => call('reading', 'setStatus', { id: r.id, status: s.next })}>
          {s.label}
        </Chip>
      </div>
      <div className="reading-meta">
        <KindLabel kind={r.data.kind} />
        {authors && <span className="muted">· {authors}</span>}
        {!authors && host && <span className="muted">· {host}</span>}
        {r.data.tags.map((t) => (
          <span key={t} className="reading-tag">
            #{t}
          </span>
        ))}
      </div>
      {r.data.abstract && (
        <p className={`reading-abstract ${absOpen ? '' : 'reading-abstract--clamp'}`} onClick={() => setAbsOpen(!absOpen)} title={absOpen ? '收起摘要' : '展开摘要'}>
          <MathText text={r.data.abstract} />
        </p>
      )}
      {editing ? (
        <AutoSaveText
          value={r.data.note}
          resetKey={r.id}
          placeholder="笔记（自动保存）"
          autoGrow
          autoFocus
          onSave={(note) => call('reading', 'update', { id: r.id, note })}
        />
      ) : (
        r.data.note && <NoteBody text={r.data.note} />
      )}
      <div className="reading-card__actions">
        {r.data.pdf && (
          <Button variant="ghost" icon={FileText} onClick={() => void desktop.openFile(r.data.pdf!)}>
            PDF
          </Button>
        )}
        <Button variant="ghost" icon={editing ? Check : Pencil} onClick={() => setEditing(!editing)}>
          {editing ? '完成' : r.data.note ? '编辑' : '写笔记'}
        </Button>
        <Button variant="ghost" icon={Trash2} onClick={() => call('reading', 'remove', { id: r.id })}>
          删除
        </Button>
      </div>
    </li>
  );
}

function ArxivSearch({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchArxiv>> | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const searchArxiv = (query: string) => call('reading', 'searchArxiv', { query, max: 8 });
  const { data: saved } = useQuery('reading', 'list', { kind: 'paper' });
  const savedIds = new Set(saved?.map((r) => r.data.arxivId));

  const run = async () => {
    if (!q.trim()) return;
    setBusy('search');
    setError('');
    try {
      setResults(await searchArxiv(q.trim()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  };
  const save = async (arxivId: string) => {
    setBusy(arxivId);
    try {
      await call('reading', 'savePaper', { arxivId });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="card">
      <div className="card__body">
        <div className="quick-add">
          <input
            className="input"
            value={q}
            placeholder="在 arXiv 检索论文（英文关键词效果更好）"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void run()}
            autoFocus
          />
          <Button icon={Search} onClick={() => void run()} disabled={busy === 'search'}>
            {busy === 'search' ? '检索中…' : '检索'}
          </Button>
          <IconButton icon={X} label="关闭检索" ghost onClick={onClose} />
        </div>
        {error && <div className="error">{error}</div>}
        {results && !results.length && <Empty>没有找到</Empty>}
        {results && results.length > 0 && (
          <ul className="list">
            {results.map((p) => (
              <li key={p.arxivId} className="list-row list-row--top">
                <div className="list-row__main">
                  <a className="reading-title" onClick={() => void desktop.openExternal(p.url)}>
                    <MathText text={p.title} />
                  </a>
                  <div className="muted">
                    {p.arxivId} · {p.published} · {p.authors.slice(0, 3).join(', ')}
                  </div>
                </div>
                {savedIds.has(p.arxivId) ? (
                  <Chip tone="ok">已收录</Chip>
                ) : (
                  <Button onClick={() => void save(p.arxivId)} disabled={busy === p.arxivId}>
                    {busy === p.arxivId ? '收录中…' : '收录'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

type KindFilter = Kind | 'all';
type StatusFilter = 'active' | 'done' | 'all';

function Page() {
  const [kind, setKind] = useState<KindFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [q, setQ] = useState('');
  const [addKind, setAddKind] = useState<Kind | 'auto'>('auto');
  const [searching, setSearching] = useState(false);
  const { data, error } = useQuery('reading', 'list', { kind: kind === 'all' ? undefined : kind, status, q: q.trim() || undefined });

  return (
    <PageFrame title="待看"
      tools={
        <>
          <input className="input" style={{ width: 200 }} value={q} placeholder="搜索标题、笔记、标签" onChange={(e) => setQ(e.target.value)} />
          <Button icon={Search} onClick={() => setSearching(!searching)}>
            arXiv 检索
          </Button>
        </>
      }
    >
      {searching && <ArxivSearch onClose={() => setSearching(false)} />}
      <QuickAdd
        placeholder="粘贴链接或 arXiv 编号，或直接写知识点；#标签"
        before={
          <select className="select" value={addKind} onChange={(e) => setAddKind(e.target.value as Kind | 'auto')} aria-label="类型">
            <option value="auto">自动</option>
            <option value="paper">论文</option>
            <option value="tweet">推文</option>
            <option value="note">知识点</option>
          </select>
        }
        onSubmit={(text) => addFromText(text, addKind)}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Segmented<KindFilter>
          value={kind}
          onChange={setKind}
          options={[{ value: 'all', label: '全部' }, ...Object.entries(KINDS).map(([value, k]) => ({ value: value as Kind, label: k.label }))]}
        />
        <Segmented<StatusFilter>
          value={status}
          onChange={setStatus}
          options={[
            { value: 'active', label: '未读完' },
            { value: 'done', label: '已读' },
            { value: 'all', label: '全部' },
          ]}
        />
      </div>
      {error && <div className="error">{error}</div>}
      {data &&
        (data.length ? (
          <ul className="reading-stream">
            {data.map((r) => (
              <ReadingCard key={r.id} r={r} />
            ))}
          </ul>
        ) : (
          <Empty>{q ? '没有匹配的条目' : '这里还是空的'}</Empty>
        ))}
    </PageFrame>
  );
}

/** 侧栏数字：没读完的条目 */
function Badge() {
  const { data } = useQuery('reading', 'stats', {});
  return data ? <>{data.byStatus.queue + data.byStatus.reading}</> : null;
}

export const readingView: ModuleView = { icon: BookOpen, Page, Badge };
