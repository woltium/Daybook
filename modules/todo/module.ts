import { createHash } from 'node:crypto';
import { z } from 'zod';
import { defineModule, isoDate, type Ctx } from '../../core/module.ts';

// 数据存在每日笔记的「## 待办」一节里。待办要写得整体一些，细碎的跟进事项缩进挂在下面：
//   - [ ] 统一三台机器的分支
//     - 二号机、三号机切到统一分支
//     - 推送到远端
//   - [/] 正在处理的
//   - [x] 做完的
// 这一节里其它的行原样保留。
// 时间线只记「完成待办」和「开始处理」，新增、改名、移动、删除这些过程性的操作不记。

const SECTION = '待办';
const CHECKBOX = /^[-*] \[( |x|X|\/)\] (.*)$/;
const INDENTED = /^\s+\S/;
const date = z.string().regex(isoDate);

export interface Todo {
  /** 日期 + 标题生成，标题不变 id 就不变（在笔记文件里增删别的行不影响） */
  id: string;
  date: string;
  title: string;
  done: boolean;
  /** 正在处理中，笔记里写成 `- [/]` */
  doing: boolean;
  /** 缩进挂在下面的细项 */
  details: string[];
}

// 待办不用模块私有的数据库，schema 只是占位
const schema = z.object({});
type C = Ctx<z.output<typeof schema>>;

const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 8);

/** line 是复选框那一行，end 是它下面细项结束的位置（不含） */
type Parsed = Todo & { line: number; end: number };

const detailText = (raw: string) => raw.trim().replace(/^[-*]\s+/, '');

function parse(day: string, content: string | null) {
  const lines = content ? content.split('\n') : [];
  const seen = new Map<string, number>();
  const items: Parsed[] = [];
  lines.forEach((text, line) => {
    const m = CHECKBOX.exec(text);
    if (!m) return;
    const title = m[2].trim();
    const n = seen.get(title) ?? 0;
    seen.set(title, n + 1);
    let end = line + 1;
    while (end < lines.length && INDENTED.test(lines[end])) end++;
    const details = lines.slice(line + 1, end).map(detailText);
    items.push({ id: `${day}:${hash(title)}${n ? `-${n}` : ''}`, date: day, title, done: m[1] === 'x' || m[1] === 'X', doing: m[1] === '/', details, line, end });
  });
  return { lines, items };
}

const read = (ctx: C, day: string) => parse(day, ctx.notes.read(day, SECTION));
const save = (ctx: C, day: string, lines: string[]) => ctx.notes.write(day, SECTION, lines.join('\n'), 'start');
type State = Pick<Todo, 'done' | 'doing'>;
const OPEN: State = { done: false, doing: false };
const mark = ({ done, doing }: State) => (done ? 'x' : doing ? '/' : ' ');
const line = (title: string, s: State) => `- [${mark(s)}] ${title}`;
const setMark = (text: string, s: State) => text.replace(/\[( |x|X|\/)\]/, `[${mark(s)}]`);
const detailLines = (details: string[]) => details.map((d) => `  - ${d.replace(/\n/g, ' ').trim()}`).filter((d) => d !== '  - ');
const block = (title: string, s: State, details: string[]) => [line(title, s), ...detailLines(details)];
/** 新待办插在最后一条待办（连同细项）后面 */
const insertAt = (doc: { lines: string[]; items: Parsed[] }) => (doc.items.length ? doc.items[doc.items.length - 1].end : doc.lines.length);

function find(ctx: C, id: string) {
  const day = id.slice(0, 10);
  const doc = read(ctx, day);
  const item = doc.items.find((t) => t.id === id);
  if (!item) throw new Error(`找不到这条待办（可能已在笔记文件里改过）：${id}`);
  return { day, doc, item };
}
const titleOf = (ctx: C, id: string) => {
  try {
    return find(ctx, id).item.title;
  } catch {
    return id;
  }
};

/** 今天的文件还没有时新建，并把上一个文件里没做完的待办抄过来 */
function ensureToday(ctx: C) {
  if (ctx.notes.exists(ctx.today)) return;
  const prev = ctx.notes.previous(ctx.today);
  const carried = prev ? read(ctx, prev).items.filter((t) => !t.done) : [];
  save(ctx, ctx.today, carried.flatMap((t) => block(t.title, t, t.details)));
}

const strip = ({ line: _l, end: _e, ...t }: Parsed): Todo => t;
/** 正在处理的在最前，做完的在最后 */
const sortTodos = <T extends Todo>(xs: T[]) => [...xs.filter((t) => t.doing), ...xs.filter((t) => !t.doing && !t.done), ...xs.filter((t) => t.done)];

export const todo = defineModule({
  id: 'todo',
  title: '每日待办',
  description: '每天的待办，存在每日笔记的「待办」一节；新的一天会自动带上前一天没做完的。',
  agentPrompt: [
    '你是待办助手，帮用户管理每天的待办。',
    '待办要整体：一件事一个待办，按目标命名（比如「统一三台机器的分支」）；零碎的验证、确认、推送放进 details，或用 addDetails 挂到已有待办下面，不要拆成很多条。',
    '用户一口气说了一堆事时，先归并成少数几个整体待办再提议。',
    '用户开始做某件事时可以用 setDoing 标成正在处理；完成时用 setDone。',
    '没做完的待办第二天会自动带过去，不需要手动移到明天。',
    '改动前先用 todo.list 拿到准确的 id。',
  ].join('\n'),
  schema,
}).actions((a) => ({
  list: a.query({
    description: '列出某天的待办。返回 id、标题、是否完成、是否正在处理、细项。',
    input: z.object({ date: date.optional().describe('YYYY-MM-DD，默认今天') }),
    run: ({ date }, ctx) => {
      const day = date ?? ctx.today;
      if (day === ctx.today) ensureToday(ctx);
      return sortTodos(read(ctx, day).items.map(strip));
    },
  }),

  doneOn: a.query({
    description: '某天完成的待办标题列表',
    input: z.object({ date }),
    agent: false,
    run: ({ date }, ctx) => read(ctx, date).items.filter((t) => t.done).map((t) => t.title),
  }),

  add: a.mutation({
    description: '新增一条待办。待办要写得整体一些（比如「统一三台机器的分支」），细碎的跟进事项放进 details',
    input: z.object({
      title: z.string().trim().min(1),
      details: z.array(z.string()).optional().describe('挂在待办下面的细项'),
      date: date.optional().describe('归属日期，默认今天'),
    }),
    activity: () => null,
    describe: ({ title, details, date }, ctx) =>
      `新增待办「${title}」${details?.length ? `（细项：${details.join('；')}）` : ''}${date && date !== ctx.today ? ` · ${date}` : ''}`,
    run: ({ title, details, date }, ctx) => {
      const day = date ?? ctx.today;
      if (day === ctx.today) ensureToday(ctx);
      const doc = read(ctx, day);
      doc.lines.splice(insertAt(doc), 0, ...block(title.replace(/\n/g, ' '), OPEN, details ?? []));
      save(ctx, day, doc.lines);
    },
  }),

  addDetails: a.mutation({
    description: '给已有的待办补充细项（缩进挂在它下面），适合把零碎的跟进事项归到一个整体待办里',
    activity: () => null,
    input: z.object({ id: z.string(), details: z.array(z.string().trim().min(1)).min(1) }),
    describe: ({ id, details }, ctx) => `给待办「${titleOf(ctx, id)}」补充细项：${details.join('；')}`,
    run: ({ id, details }, ctx) => {
      const { day, doc, item } = find(ctx, id);
      const known = new Set(item.details);
      doc.lines.splice(item.end, 0, ...detailLines(details.filter((d) => !known.has(d.trim()))));
      save(ctx, day, doc.lines);
    },
  }),

  update: a.mutation({
    description: '修改待办的标题',
    activity: () => null,
    input: z.object({ id: z.string(), title: z.string().trim().min(1) }),
    describe: ({ id, title }, ctx) => `把待办「${titleOf(ctx, id)}」改成「${title}」`,
    run: ({ id, title }, ctx) => {
      const { day, doc, item } = find(ctx, id);
      doc.lines[item.line] = line(title.replace(/\n/g, ' '), item);
      save(ctx, day, doc.lines);
    },
  }),

  setDone: a.mutation({
    description: '把待办标记为完成或未完成',
    input: z.object({ id: z.string(), done: z.boolean() }),
    describe: ({ id, done }, ctx) => `${done ? '完成' : '取消完成'}待办「${titleOf(ctx, id)}」`,
    activity: ({ id, done }, ctx) => (done ? `完成待办「${titleOf(ctx, id)}」` : null),
    run: ({ id, done }, ctx) => {
      const { day, doc, item } = find(ctx, id);
      doc.lines[item.line] = setMark(doc.lines[item.line], { done, doing: false });
      save(ctx, day, doc.lines);
    },
  }),

  setDoing: a.mutation({
    description: '把待办标记为正在处理，或取消正在处理（回到未开始）',
    input: z.object({ id: z.string(), doing: z.boolean() }),
    describe: ({ id, doing }, ctx) => `${doing ? '开始处理' : '暂停处理'}待办「${titleOf(ctx, id)}」`,
    activity: ({ id, doing }, ctx) => (doing ? `开始处理待办「${titleOf(ctx, id)}」` : null),
    run: ({ id, doing }, ctx) => {
      const { day, doc, item } = find(ctx, id);
      doc.lines[item.line] = setMark(doc.lines[item.line], { done: false, doing });
      save(ctx, day, doc.lines);
    },
  }),

  move: a.mutation({
    description: '把待办移到另一天（从原来那天的文件里删掉，加到目标日期的文件里）',
    activity: () => null,
    input: z.object({ id: z.string(), date }),
    describe: ({ id, date }, ctx) => `把待办「${titleOf(ctx, id)}」移到 ${date}`,
    run: ({ id, date }, ctx) => {
      const { day, doc, item } = find(ctx, id);
      if (day === date) return;
      const target = read(ctx, date);
      target.lines.splice(insertAt(target), 0, ...block(item.title, { done: false, doing: item.doing }, item.details));
      save(ctx, date, target.lines);
      doc.lines.splice(item.line, item.end - item.line);
      save(ctx, day, doc.lines);
    },
  }),

  remove: a.mutation({
    description: '删除一条待办',
    activity: () => null,
    input: z.object({ id: z.string() }),
    describe: ({ id }, ctx) => `删除待办「${titleOf(ctx, id)}」`,
    run: ({ id }, ctx) => {
      const { day, doc, item } = find(ctx, id);
      doc.lines.splice(item.line, item.end - item.line);
      save(ctx, day, doc.lines);
    },
  }),

  report: a.query({
    description: '生成某天待办的 Markdown 段落（用于日报）',
    input: z.object({ date: date.optional() }),
    run: ({ date }, ctx) => {
      const xs = sortTodos(read(ctx, date ?? ctx.today).items);
      return xs.length ? ['## 待办', ...xs.flatMap((t) => block(t.title, t, t.details))].join('\n') : '';
    },
  }),
}));
