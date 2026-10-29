import { z } from 'zod';
import { defineModule, isoDate, type Item } from '../../core/module.ts';
import { fetchArxiv, parseArxivId, searchArxiv } from './arxiv.ts';

const kind = z.enum(['paper', 'tweet', 'note']);
const status = z.enum(['queue', 'reading', 'done']);
const date = z.string().regex(isoDate);

const schema = z.object({
  kind,
  title: z.string().trim().min(1),
  url: z.string().default(''),
  tags: z.array(z.string()).default([]),
  status: status.default('queue'),
  note: z.string().default(''),
  doneAt: z.string().regex(isoDate).nullable().default(null),
  // 论文元数据
  authors: z.array(z.string()).default([]),
  abstract: z.string().default(''),
  arxivId: z.string().nullable().default(null),
  /** 本地 PDF 相对路径，通过 /files/<pdf> 访问 */
  pdf: z.string().nullable().default(null),
});

export type Reading = z.output<typeof schema>;
export type Kind = z.output<typeof kind>;
export type Status = z.output<typeof status>;

const ORDER: Record<Status, number> = { reading: 0, queue: 1, done: 2 };
const KIND_LABEL: Record<Kind, string> = { paper: '论文', tweet: '推文', note: '知识点' };

const cleanTags = (tags: string[]) => [...new Set(tags.map((t) => t.replace(/^#/, '').trim()).filter(Boolean))];

export const reading = defineModule({
  id: 'reading',
  title: '待看',
  description: '待看的论文、推文和知识点，支持标签、笔记、arXiv 检索和 PDF 下载。',
  agentPrompt: [
    '你是阅读助手，管理用户待看的论文、推文和知识点。',
    '收录论文：先用 reading.searchArxiv 找到准确的 arXiv 编号，确认是用户要的那篇，再用 reading.savePaper 收录（会下载 PDF）。',
    '标签要少而短（1 到 3 个），尽量沿用已有条目的标签。',
    '用户问「这篇讲什么」时，基于条目里的摘要和笔记回答，不要编造。',
  ].join('\n'),
  schema,
}).actions((a) => ({
  list: a.query({
    description: '列出阅读条目，可按类型、状态、标签、关键词过滤',
    input: z.object({
      kind: kind.optional(),
      status: z.enum(['queue', 'reading', 'done', 'active', 'all']).optional().describe('active = 未读完，默认 all'),
      tag: z.string().optional(),
      q: z.string().optional().describe('在标题/笔记/标签中搜索'),
    }),
    run: ({ kind, status = 'all', tag, q }, ctx) => {
      const needle = q?.toLowerCase();
      return ctx.store
        .list()
        .filter((r) => !kind || r.data.kind === kind)
        .filter((r) =>
          status === 'all' ? true : status === 'active' ? r.data.status !== 'done' : r.data.status === status,
        )
        .filter((r) => !tag || r.data.tags.includes(tag))
        .filter(
          (r) =>
            !needle ||
            [r.data.title, r.data.note, r.data.abstract, ...r.data.tags].some((s) => s.toLowerCase().includes(needle)),
        )
        .sort((x, y) => ORDER[x.data.status] - ORDER[y.data.status] || y.createdAt.localeCompare(x.createdAt));
    },
  }),

  stats: a.query({
    description: '各类型、各状态的条目数量',
    input: z.object({}),
    run: (_, ctx) => {
      const all = ctx.store.list();
      const count = (f: (r: Item<Reading>) => boolean) => all.filter(f).length;
      return {
        total: all.length,
        byKind: { paper: count((r) => r.data.kind === 'paper'), tweet: count((r) => r.data.kind === 'tweet'), note: count((r) => r.data.kind === 'note') },
        byStatus: { queue: count((r) => r.data.status === 'queue'), reading: count((r) => r.data.status === 'reading'), done: count((r) => r.data.status === 'done') },
      };
    },
  }),

  finishedOn: a.query({
    description: '某天读完的条目',
    input: z.object({ date }),
    agent: false,
    run: ({ date }, ctx) =>
      ctx.store
        .list()
        .filter((r) => r.data.doneAt === date)
        .map((r) => ({ title: r.data.title, url: r.data.url, note: r.data.note })),
  }),

  searchArxiv: a.query({
    description: '在 arXiv 上检索论文（只读，不会保存）。返回 arxivId、标题、作者、摘要、日期。',
    input: z.object({ query: z.string().min(1).describe('英文关键词效果更好'), max: z.number().int().min(1).max(20).default(5) }),
    run: ({ query, max }) => searchArxiv(query, max),
  }),

  add: a.mutation({
    description: '添加一条待看条目（论文 / 推文 / 知识点）',
    input: z.object({
      kind,
      title: z.string().trim().min(1),
      url: z.string().optional(),
      tags: z.array(z.string()).optional(),
      note: z.string().optional(),
    }),
    describe: ({ kind, title, tags }) =>
      `添加${KIND_LABEL[kind]}「${title}」${tags?.length ? ` #${tags.join(' #')}` : ''}`,
    run: ({ tags, ...rest }, ctx) => ctx.store.insert({ ...rest, tags: cleanTags(tags ?? []) }),
  }),

  savePaper: a.mutation({
    description: '按 arXiv 编号收录论文：拉取标题、作者、摘要，并（默认）下载 PDF 到本地。已收录过的会更新而不是重复添加。',
    input: z.object({
      arxivId: z.string().describe('如 2408.03314，也可传 arXiv 链接'),
      title: z.string().optional().describe('仅用于提案展示，实际以 arXiv 元数据为准'),
      tags: z.array(z.string()).optional(),
      download: z.boolean().default(true),
    }),
    describe: ({ arxivId, title, download }) =>
      `收录论文 arXiv:${parseArxivId(arxivId) ?? arxivId}${title ? `「${title}」` : ''}${download ? '，并下载 PDF' : ''}`,
    run: async ({ arxivId, tags, download }, ctx) => {
      const id = parseArxivId(arxivId);
      if (!id) throw new Error(`无法识别的 arXiv 编号：${arxivId}`);
      const paper = await fetchArxiv(id);
      const pdf = download ? await ctx.download(paper.pdfUrl, `papers/${id}.pdf`) : null;
      const existing = ctx.store.list().find((r) => r.data.arxivId === id || parseArxivId(r.data.url) === id);
      const fields = {
        kind: 'paper' as const,
        title: paper.title,
        url: paper.url,
        authors: paper.authors,
        abstract: paper.abstract,
        arxivId: id,
      };
      if (existing) {
        return ctx.store.update(existing.id, {
          ...fields,
          tags: cleanTags([...existing.data.tags, ...(tags ?? [])]),
          ...(pdf ? { pdf } : {}),
        });
      }
      return ctx.store.insert({ ...fields, tags: cleanTags(tags ?? []), pdf });
    },
  }),

  setStatus: a.mutation({
    description: '设置条目状态：queue 待看 / reading 在读 / done 已读',
    input: z.object({ id: z.string(), status, date: date.optional().describe('读完日期，默认今天') }),
    describe: ({ id, status }, ctx) =>
      `把「${ctx.store.get(id)?.data.title ?? id}」标记为${{ queue: '待看', reading: '在读', done: '已读' }[status]}`,
    activity: ({ id, status }, ctx) => {
      const title = ctx.store.get(id)?.data.title ?? id;
      return status === 'queue' ? null : { reading: `开始读「${title}」`, done: `读完「${title}」` }[status];
    },
    run: ({ id, status, date }, ctx) =>
      ctx.store.update(id, { status, doneAt: status === 'done' ? (date ?? ctx.today) : null }),
  }),

  update: a.mutation({
    description: '修改条目的标题、链接、标签或笔记',
    input: z.object({
      id: z.string(),
      title: z.string().trim().min(1).optional(),
      url: z.string().optional(),
      tags: z.array(z.string()).optional(),
      note: z.string().optional(),
    }),
    describe: ({ id, ...p }, ctx) =>
      `修改「${ctx.store.get(id)?.data.title ?? id}」的${Object.keys(p).filter((k) => p[k as keyof typeof p] !== undefined).join('、')}`,
    activity: ({ id, ...p }, ctx) => {
      const fields = Object.keys(p).filter((k) => p[k as keyof typeof p] !== undefined);
      const title = ctx.store.get(id)?.data.title ?? id;
      return fields.length === 1 && fields[0] === 'note' ? `更新了「${title}」的笔记` : null;
    },
    run: ({ id, tags, ...rest }, ctx) =>
      ctx.store.update(id, {
        ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
        ...(tags ? { tags: cleanTags(tags) } : {}),
      }),
  }),

  remove: a.mutation({
    description: '删除一条阅读条目',
    input: z.object({ id: z.string() }),
    describe: ({ id }, ctx) => `删除「${ctx.store.get(id)?.data.title ?? id}」`,
    activity: () => null,
    run: ({ id }, ctx) => ctx.store.remove(id),
  }),

  report: a.query({
    description: '生成某天读完条目的 Markdown 段落（用于日报）',
    input: z.object({ date: date.optional() }),
    run: ({ date }, ctx) => {
      const day = date ?? ctx.today;
      const done = ctx.store.list().filter((r) => r.data.doneAt === day);
      if (!done.length) return '';
      return [
        '## 今日读完',
        ...done.map((r) => {
          const title = r.data.url ? `[${r.data.title}](${r.data.url})` : r.data.title;
          const note = r.data.note.trim().split('\n')[0];
          return `- ${title}${note ? ` — ${note}` : ''}`;
        }),
      ].join('\n');
    },
  }),
}));
