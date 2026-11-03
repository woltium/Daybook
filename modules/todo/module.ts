import { createHash } from 'node:crypto';
import { z } from 'zod';
import { defineModule, isoDate, type Ctx } from '../../core/module.ts';
import { beijingAt } from '../../core/time.ts';

// 数据存在每日笔记的「## 待办」一节里。一件大事用「### 分类」当标题，下面每条都是能单独勾选的待办；
// 没有分类的待办写在第一个分类标题前面：
//   - [ ] 没有分类的
//   ### 统一三台机器的分支
//   - [/] 二号机、三号机切到统一分支
//   - [ ] 推送到远端 ⏰14:30
//   - [x] 做完的
//   - [>] 暂时归档的
// 这一节里其它的行原样保留，没有待办的分类标题会被去掉。时间是这条待办那一天的北京时间，没做完抄到第二天时不带时间。
// 以前的格式是在待办下面缩进挂细项，读到时会改成：这条待办变成分类，细项变成分类下的待办。
// 暂时归档的待办平时不显示、不算进进度，没做完也照样抄到第二天，恢复后回到未开始。
// 时间线只记「完成待办」和「开始处理」，新增、改名、移动、删除这些过程性的操作不记。

const SECTION = '待办';
const CHECKBOX = /^[-*] \[( |x|X|\/|>)\] (.*)$/;
const GROUP = /^###\s+(.+?)\s*$/;
const INDENTED = /^\s+\S/;
const TIME = /\s*⏰\s*(([01]\d|2[0-3]):[0-5]\d)\s*$/;
const date = z.string().regex(isoDate);
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const category = z.string().trim().min(1).transform((c) => c.replace(/\n/g, ' ').replace(/^#+\s*/, '').trim());

export interface Todo {
  /** 日期 + 标题生成，标题不变 id 就不变（在笔记文件里增删别的行、换分类都不影响） */
  id: string;
  date: string;
  title: string;
  done: boolean;
  /** 正在处理中，笔记里写成 `- [/]` */
  doing: boolean;
  /** 暂时归档，笔记里写成 `- [>]` */
  archived: boolean;
  /** 所在的分类（「### 」标题），没有分类为 null */
  category: string | null;
  /** 提醒时间 HH:MM（北京时间），笔记里写在标题后面：⏰14:30 */
  time: string | null;
}

// 待办本身存在笔记里，数据库只记提醒的状态：snoozeUntil 为空表示已经关掉，否则是稍后提醒的时刻。
// 记录跟着 todoId + time 走，改了时间就会重新提醒。
const schema = z.object({ todoId: z.string(), time: clockTime, snoozeUntil: z.string().nullable() });
type C = Ctx<z.output<typeof schema>>;

const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 8);

/** line 是复选框那一行，end 是它下面旧格式细项结束的位置（不含），legacy 是那些细项 */
type Parsed = Todo & { line: number; end: number; legacy: string[] };
type Doc = { day: string; lines: string[]; items: Parsed[]; groups: { name: string; line: number }[] };

const detailText = (raw: string) => raw.trim().replace(/^[-*]\s+/, '');

function parse(day: string, content: string | null): Doc {
  const lines = content ? content.split('\n') : [];
  const seen = new Map<string, number>();
  const items: Parsed[] = [];
  const groups: Doc['groups'] = [];
  let group: string | null = null;
  lines.forEach((text, line) => {
    const g = GROUP.exec(text);
    if (g) {
      group = g[1];
      groups.push({ name: group, line });
      return;
    }
    const m = CHECKBOX.exec(text);
    if (!m) return;
    const raw = m[2].trim();
    const time = TIME.exec(raw)?.[1] ?? null;
    const title = raw.replace(TIME, '');
    const n = seen.get(title) ?? 0;
    seen.set(title, n + 1);
    let end = line + 1;
    while (end < lines.length && INDENTED.test(lines[end])) end++;
    const legacy = lines.slice(line + 1, end).map(detailText);
    items.push({ id: `${day}:${hash(title)}${n ? `-${n}` : ''}`, date: day, title, done: m[1] === 'x' || m[1] === 'X', doing: m[1] === '/', archived: m[1] === '>', category: group, time, line, end, legacy });
  });
  return { day, lines, items, groups };
}

/** 去掉没有内容的分类标题，连续空行并成一行，分类标题前空一行 */
function tidy(lines: string[]) {
  const out: string[] = [];
  const blank = (s: string | undefined) => s === undefined || !s.trim();
  for (let i = 0; i < lines.length; i++) {
    if (GROUP.test(lines[i])) {
      let j = i + 1;
      while (j < lines.length && blank(lines[j])) j++;
      if (j === lines.length || GROUP.test(lines[j])) {
        i = j - 1;
        continue;
      }
      if (!blank(out.at(-1))) out.push('');
    }
    if (blank(lines[i]) && blank(out.at(-1))) continue;
    out.push(lines[i]);
  }
  return out;
}

const read = (ctx: C, day: string) => parse(day, ctx.notes.read(day, SECTION));
const save = (ctx: C, doc: Doc) => ctx.notes.write(doc.day, SECTION, tidy(doc.lines).join('\n'), 'start');
type State = Pick<Todo, 'done' | 'doing'> & { archived?: boolean; time?: string | null };
const OPEN: State = { done: false, doing: false };
const mark = ({ done, doing, archived }: State) => (done ? 'x' : archived ? '>' : doing ? '/' : ' ');
const line = (title: string, s: State) => `- [${mark(s)}] ${title}${s.time ? ` ⏰${s.time}` : ''}`;
const setMark = (text: string, s: State) => text.replace(/\[( |x|X|\/|>)\]/, `[${mark(s)}]`);

/** 把几行待办插到分类的最后（没有这个分类就在最后新建），返回插入后的文档 */
function insert(doc: Doc, group: string | null, block: string[]): Doc {
  const lines = [...doc.lines];
  const last = doc.items.filter((t) => t.category === group).at(-1);
  const heading = doc.groups.find((g) => g.name === group);
  if (last) lines.splice(last.end, 0, ...block);
  else if (heading) lines.splice(heading.line + 1, 0, ...block);
  else if (group === null) lines.splice(doc.groups[0]?.line ?? lines.length, 0, ...block, '');
  else lines.push('', `### ${group}`, ...block);
  return parse(doc.day, lines.join('\n'));
}

/** 从文档里拿掉一条待办（连同旧格式的细项） */
function cut(doc: Doc, item: Parsed): Doc {
  const lines = [...doc.lines];
  lines.splice(item.line, item.end - item.line);
  return parse(doc.day, lines.join('\n'));
}

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

/** 旧格式的细项变成待办：细项自己写了复选框就照着来，否则跟着原来那条待办是否做完 */
const legacyLine = (d: string, parent: Parsed) => {
  const m = /^\[( |x|X|\/|>)\]\s+(.*)$/.exec(d);
  return m ? `- [${m[1]}] ${m[2]}` : line(d.replace(/\n/g, ' '), { done: parent.done, doing: false });
};

/** 旧格式（待办下面缩进挂细项）改成分类：没分类的待办变成同名分类，原来那条只在处理中或有提醒时间时留下 */
function migrate(ctx: C, day: string) {
  let doc = read(ctx, day);
  const old = doc.items.filter((t) => t.legacy.length);
  if (!old.length) return;
  for (const t of [...old].reverse()) doc = cut(doc, t);
  for (const t of old) {
    const keep = t.category !== null || t.doing || t.time ? [line(t.title, t)] : [];
    doc = insert(doc, t.category ?? t.title, [...keep, ...t.legacy.map((d) => legacyLine(d, t))]);
  }
  save(ctx, doc);
}

/** 今天的文件还没有时新建，并把上一个文件里没做完的待办按分类抄过来 */
function ensureToday(ctx: C) {
  if (ctx.notes.exists(ctx.today)) return;
  const prev = ctx.notes.previous(ctx.today);
  let doc = parse(ctx.today, null);
  for (const t of prev ? read(ctx, prev).items.filter((t) => !t.done) : []) {
    doc = insert(doc, t.category, [line(t.title, { ...t, time: null }), ...t.legacy.map((d) => `  - ${d}`)]);
  }
  save(ctx, doc);
  migrate(ctx, ctx.today);
}

const strip = ({ line: _l, end: _e, legacy: _d, ...t }: Parsed): Todo => t;

/** 记下这条提醒的状态：snoozeUntil 为空表示关掉 */
function setReminder(ctx: C, day: string, todoId: string, time: string, snoozeUntil: string | null) {
  const existing = ctx.store.list({ date: day }).find((r) => r.data.todoId === todoId && r.data.time === time);
  if (existing) ctx.store.update(existing.id, { snoozeUntil });
  else ctx.store.insert({ todoId, time, snoozeUntil }, day);
}
/** 分类按笔记里的顺序（没分类的在最前），每个分类里正在处理的在最前，做完的、归档的在最后 */
const rank = (t: Todo) => (t.doing ? 0 : t.archived ? 3 : t.done ? 2 : 1);
const sortTodos = <T extends Todo>(xs: T[]) => {
  const groups = [...new Set([null, ...xs.map((t) => t.category)])];
  return [...xs].sort((a, b) => groups.indexOf(a.category) - groups.indexOf(b.category) || rank(a) - rank(b));
};
/** 按分类分好的 Markdown，用于日报 */
const markdown = (xs: Todo[]) =>
  [...new Set([null, ...xs.map((t) => t.category)])].flatMap((g) => {
    const ts = xs.filter((t) => t.category === g).map((t) => line(t.title, t));
    return ts.length && g ? [`### ${g}`, ...ts] : ts;
  });

export const todo = defineModule({
  id: 'todo',
  title: '每日待办',
  description: '每天的待办，存在每日笔记的「待办」一节，可以按分类分组；新的一天会自动带上前一天没做完的。',
  agentPrompt: [
    '你是待办助手，帮用户管理每天的待办。',
    '一件大事用一个分类（category，按目标命名，比如「统一三台机器的分支」），里面的每一步是一条单独的待办（比如「推送到远端」）；零散的小事可以不分类。',
    '新加的待办属于已有的分类时，用同一个分类名，不要另起一个意思相近的分类。',
    '用户一口气说了一堆事时，先按目标归成少数几个分类再提议。',
    '用户开始做某件事时可以用 setDoing 标成正在处理；完成时用 setDone。',
    '用户说某件事先放一放、以后再说时，用 setArchived 暂时归档；归档的待办不显示在列表里，想做时再恢复。',
    '没做完的待办第二天会自动带过去（连同分类），不需要手动移到明天。',
    '用户说了具体时间的待办，用 time 或 setTime 设上（北京时间 HH:MM），到点会弹窗提醒。',
    '改动前先用 todo.list 拿到准确的 id 和已有的分类。',
  ].join('\n'),
  schema,
}).actions((a) => ({
  list: a.query({
    description: '列出某天的待办，按分类排好。返回 id、标题、是否完成、是否正在处理、是否已归档、分类、提醒时间。',
    input: z.object({ date: date.optional().describe('YYYY-MM-DD，默认今天') }),
    run: ({ date }, ctx) => {
      const day = date ?? ctx.today;
      if (day === ctx.today) ensureToday(ctx);
      migrate(ctx, day);
      return sortTodos(read(ctx, day).items.map(strip));
    },
  }),

  doneOn: a.query({
    description: '某天完成的待办标题列表',
    input: z.object({ date }),
    agent: false,
    run: ({ date }, ctx) => read(ctx, date).items.filter((t) => t.done).map((t) => (t.category ? `${t.category}：${t.title}` : t.title)),
  }),

  due: a.query({
    description: '今天已经到点、还要弹窗提醒的待办',
    input: z.object({}),
    agent: false,
    run: (_, ctx) => {
      const now = Date.now();
      const states = ctx.store.list({ date: ctx.today });
      return read(ctx, ctx.today)
        .items.filter((t) => {
          if (t.done || t.archived || !t.time || beijingAt(ctx.today, t.time) > now) return false;
          const s = states.find((r) => r.data.todoId === t.id && r.data.time === t.time);
          return !s || (s.data.snoozeUntil !== null && Date.parse(s.data.snoozeUntil) <= now);
        })
        .map(strip);
    },
  }),

  add: a.mutation({
    description: '新增一条待办，可以放进某个分类（没有这个分类会新建）',
    input: z.object({
      title: z.string().trim().min(1),
      category: category.optional().describe('所在分类，一件大事的名字；不填就是不分类'),
      date: date.optional().describe('归属日期，默认今天'),
      time: clockTime.optional().describe('提醒时间 HH:MM（北京时间），到点弹窗'),
    }),
    activity: () => null,
    describe: ({ title, category, date, time }, ctx) =>
      `新增待办「${title}」${category ? `（分类：${category}）` : ''}${date && date !== ctx.today ? ` · ${date}` : ''}${time ? ` · ${time} 提醒` : ''}`,
    run: ({ title, category, date, time }, ctx) => {
      const day = date ?? ctx.today;
      if (day === ctx.today) ensureToday(ctx);
      save(ctx, insert(read(ctx, day), category ?? null, [line(title.replace(/\n/g, ' '), { ...OPEN, time })]));
    },
  }),

  setCategory: a.mutation({
    description: '把待办换到另一个分类（没有这个分类会新建），category 为 null 表示不分类',
    activity: () => null,
    input: z.object({ id: z.string(), category: category.nullable() }),
    describe: ({ id, category }, ctx) => (category ? `把待办「${titleOf(ctx, id)}」放进分类「${category}」` : `把待办「${titleOf(ctx, id)}」移出分类`),
    run: ({ id, category }, ctx) => {
      const { doc, item } = find(ctx, id);
      if (item.category === category) return;
      save(ctx, insert(cut(doc, item), category, doc.lines.slice(item.line, item.end)));
    },
  }),

  renameCategory: a.mutation({
    description: '给某天的分类改名；改成已有的分类名时两个分类合并',
    activity: () => null,
    input: z.object({ date: date.optional().describe('默认今天'), from: z.string(), to: category }),
    describe: ({ from, to }) => `把分类「${from}」改名为「${to}」`,
    run: ({ date, from, to }, ctx) => {
      let doc = read(ctx, date ?? ctx.today);
      if (from === to) return;
      if (!doc.groups.some((g) => g.name === from)) throw new Error(`没有这个分类：${from}`);
      if (doc.groups.some((g) => g.name === to)) {
        const moving = doc.items.filter((t) => t.category === from);
        const blocks = moving.map((t) => doc.lines.slice(t.line, t.end));
        for (const t of [...moving].reverse()) doc = cut(doc, t);
        doc = insert(doc, to, blocks.flat());
      } else {
        for (const g of doc.groups) if (g.name === from) doc.lines[g.line] = `### ${to}`;
      }
      save(ctx, doc);
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
      save(ctx, doc);
      // id 由标题生成，改名后提醒状态要跟过去，不然已关掉的提醒会再弹一次
      const renamed = parse(day, doc.lines.join('\n')).items.find((t) => t.line === item.line)!;
      for (const r of ctx.store.list({ date: day })) if (r.data.todoId === id) ctx.store.update(r.id, { todoId: renamed.id });
    },
  }),

  setTime: a.mutation({
    description: '设置或清除待办的提醒时间（北京时间 HH:MM），到点弹窗提醒',
    activity: () => null,
    input: z.object({ id: z.string(), time: clockTime.nullable() }),
    describe: ({ id, time }, ctx) => (time ? `把待办「${titleOf(ctx, id)}」的提醒时间设为 ${time}` : `清除待办「${titleOf(ctx, id)}」的提醒时间`),
    run: ({ id, time }, ctx) => {
      const { doc, item } = find(ctx, id);
      doc.lines[item.line] = line(item.title, { ...item, time });
      save(ctx, doc);
    },
  }),

  snooze: a.mutation({
    description: '稍后再提醒',
    agent: false,
    activity: () => null,
    input: z.object({ id: z.string(), minutes: z.number().int().positive() }),
    run: ({ id, minutes }, ctx) => {
      const { day, item } = find(ctx, id);
      if (item.time) setReminder(ctx, day, id, item.time, new Date(Date.now() + minutes * 60_000).toISOString());
    },
  }),

  dismiss: a.mutation({
    description: '关掉提醒，这个时间不再弹',
    agent: false,
    activity: () => null,
    input: z.object({ id: z.string() }),
    run: ({ id }, ctx) => {
      const { day, item } = find(ctx, id);
      if (item.time) setReminder(ctx, day, id, item.time, null);
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
      save(ctx, doc);
      // 做完的提醒已经没用了，取消完成时也不要再弹
      if (done && item.time) setReminder(ctx, day, id, item.time, null);
    },
  }),

  setDoing: a.mutation({
    description: '把待办标记为正在处理，或取消正在处理（回到未开始）',
    input: z.object({ id: z.string(), doing: z.boolean() }),
    describe: ({ id, doing }, ctx) => `${doing ? '开始处理' : '暂停处理'}待办「${titleOf(ctx, id)}」`,
    activity: ({ id, doing }, ctx) => (doing ? `开始处理待办「${titleOf(ctx, id)}」` : null),
    run: ({ id, doing }, ctx) => {
      const { doc, item } = find(ctx, id);
      doc.lines[item.line] = setMark(doc.lines[item.line], { done: false, doing });
      save(ctx, doc);
    },
  }),

  setArchived: a.mutation({
    description: '暂时归档待办（先放一放，不显示在列表里），或从归档恢复（回到未开始）',
    activity: () => null,
    input: z.object({ id: z.string(), archived: z.boolean() }),
    describe: ({ id, archived }, ctx) => `${archived ? '归档' : '恢复'}待办「${titleOf(ctx, id)}」`,
    run: ({ id, archived }, ctx) => {
      const { doc, item } = find(ctx, id);
      doc.lines[item.line] = setMark(doc.lines[item.line], { done: false, doing: false, archived });
      save(ctx, doc);
    },
  }),

  move: a.mutation({
    description: '把待办移到另一天（从原来那天的文件里删掉，加到目标日期的文件里，分类不变）',
    activity: () => null,
    input: z.object({ id: z.string(), date }),
    describe: ({ id, date }, ctx) => `把待办「${titleOf(ctx, id)}」移到 ${date}`,
    run: ({ id, date }, ctx) => {
      const { day, doc, item } = find(ctx, id);
      if (day === date) return;
      save(ctx, insert(read(ctx, date), item.category, [line(item.title, { ...item, done: false }), ...doc.lines.slice(item.line + 1, item.end)]));
      save(ctx, cut(doc, item));
    },
  }),

  remove: a.mutation({
    description: '删除一条待办',
    activity: () => null,
    input: z.object({ id: z.string() }),
    describe: ({ id }, ctx) => `删除待办「${titleOf(ctx, id)}」`,
    run: ({ id }, ctx) => {
      const { doc, item } = find(ctx, id);
      save(ctx, cut(doc, item));
    },
  }),

  report: a.query({
    description: '生成某天待办的 Markdown 段落（用于日报）',
    input: z.object({ date: date.optional() }),
    run: ({ date }, ctx) => {
      const xs = sortTodos(read(ctx, date ?? ctx.today).items.filter((t) => !t.archived));
      return xs.length ? ['## 待办', ...markdown(xs)].join('\n') : '';
    },
  }),
}));
