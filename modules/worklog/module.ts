import { z } from 'zod';
import { defineModule, isoDate } from '../../core/module.ts';

// 数据存在每日笔记的「## 工作总结」一节里，整节就是总结正文（Markdown）。
const SECTION = '工作总结';
const date = z.string().regex(isoDate);

// 不用模块私有的数据库，schema 只是占位
const schema = z.object({});

export const worklog = defineModule({
  id: 'worklog',
  title: '工作总结',
  description: '每天一篇 Markdown 工作总结，存在每日笔记的「工作总结」一节。',
  agentPrompt: [
    '你是工作总结助手，帮用户写、改当天的工作总结。',
    '总结要概括：按项目或事情合并成 3 到 8 条 Markdown 列表，每条一句话，写做了什么、进展、卡在哪；不写命令、文件名这些细节。',
    '动手前先用 worklog.get 看现有内容；在原文基础上补充或改写，不要丢掉用户已经写的内容。',
    '只补一段用 append，整体重写用 save。需要时可以查当天完成的待办。',
  ].join('\n'),
  schema,
}).actions((a) => ({
  get: a.query({
    description: '读取某天的工作总结全文',
    input: z.object({ date: date.optional() }),
    run: ({ date }, ctx) => {
      const day = date ?? ctx.today;
      return { content: ctx.notes.read(day, SECTION) ?? '', updatedAt: ctx.notes.mtime(day) };
    },
  }),

  collectDone: a.query({
    description: '汇总某天完成的待办和读完的条目（来自其它模块），返回可直接插入总结的 Markdown',
    input: z.object({ date: date.optional() }),
    run: async ({ date }, ctx) => {
      const day = date ?? ctx.today;
      const [todos, reads] = await Promise.all([
        ctx.query<string[]>('todo', 'doneOn', { date: day }),
        ctx.query<{ title: string; url: string }[]>('reading', 'finishedOn', { date: day }),
      ]);
      const lines = todos.map((t) => `- ${t}`);
      if (reads.length) lines.push('', '读完：', ...reads.map((r) => `- ${r.url ? `[${r.title}](${r.url})` : r.title}`));
      return { count: todos.length + reads.length, markdown: lines.join('\n') };
    },
  }),

  save: a.mutation({
    description: '用新内容整篇覆盖某天的工作总结',
    input: z.object({ date: date.optional(), content: z.string() }),
    describe: ({ date, content }) => `覆盖 ${date ?? '今天'} 的工作总结（${content.length} 字）`,
    activity: ({ date }, ctx) => (date && date !== ctx.today ? `更新了 ${date} 的工作总结` : '更新了工作总结'),
    run: ({ date, content }, ctx) => ctx.notes.write(date ?? ctx.today, SECTION, content, 'end'),
  }),

  append: a.mutation({
    description: '在某天的工作总结末尾追加一段 Markdown（不会覆盖已有内容）',
    input: z.object({ date: date.optional(), text: z.string().min(1) }),
    describe: ({ date, text }) => `在 ${date ?? '今天'} 的工作总结末尾追加：${text.length > 60 ? `${text.slice(0, 60)}…` : text}`,
    activity: ({ date }, ctx) => (date && date !== ctx.today ? `往 ${date} 的工作总结里追加了一段` : '往工作总结里追加了一段'),
    run: ({ date, text }, ctx) => {
      const day = date ?? ctx.today;
      const current = ctx.notes.read(day, SECTION) ?? '';
      ctx.notes.write(day, SECTION, current ? `${current}\n\n${text}` : text, 'end');
    },
  }),

  report: a.query({
    description: '生成某天工作总结的 Markdown 段落（用于日报）',
    input: z.object({ date: date.optional() }),
    run: ({ date }, ctx) => {
      const content = ctx.notes.read(date ?? ctx.today, SECTION)?.trim();
      return content ? `## 工作总结\n\n${content}` : '';
    },
  }),
}));
