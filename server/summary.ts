// 根据某天在 Claude Code 里的对话（加上 Daybook 里和 agent 的对话、完成的待办）起草工作总结。
// 一天可能聊很多，所以分两步：长会话先各自压成一两句，再整体概括。
// 只返回草稿，写不写进笔记由用户在界面上决定。
// 也能从对话里找出没收尾的事，生成「新增待办」提案，批准后才写进笔记。
import { beijingClock } from '../core/time.ts';
import { agentConfig, AgentConfigError, chatLog, complete, isConfigured, type AgentConfig } from './agent.ts';
import { claudeSessionsOn, type ClaudeSession } from './claudeLog.ts';
import { createProposal, listProposals } from './proposals.ts';
import { runAction } from './runtime.ts';

const FINAL_PROMPT = `你是用户的工作记录助手。下面是用户某一天和 AI 助手（主要是 Claude Code）的各个对话会话的摘录或摘要，以及当天完成的待办、已经写过的总结（可能为空）。
请写一份当天的工作总结，要求：
- 概括性地写，按项目或事情合并，总共 3 到 8 条，每条一句话、不超过 40 个字：做了什么、结论或进展、卡在哪
- 不要逐个会话复述，不要罗列细节、命令、文件名、代码
- 和工作无关的闲聊、试用性质的小问题可以略过或合成一条
- 只写材料里有依据的内容，不要编造
- 已有总结里的内容要保留并融合进去
- 如果材料里明确提到之后的打算，最后加一个「后续」小列表（最多 3 条）
- 直接输出 Markdown 无序列表，不要标题和寒暄`;

const SESSION_PROMPT = `下面是用户和 AI 助手某一次会话的摘录（用户的话 + 助手每轮最后的回复，都截断过）。
用一到两句中文概括这次会话在做什么、得到了什么结论或进展、还有什么没解决。不要细节，不要寒暄，直接输出这一两句话。`;

/** 单个会话摘录超过这个长度就先压缩成一两句 */
const SESSION_LIMIT = 2500;

export class NothingToSummarize extends Error {}

const time = (iso: string) => beijingClock(iso);
const projectName = (p: string) => (p.includes('scratch-workspaces') ? '临时会话' : p);

const transcript = (s: ClaudeSession) =>
  s.turns.map((t) => `[${time(t.at)}] 用户：${t.user}${t.reply ? `\n  助手：${t.reply}` : ''}`).join('\n');

async function briefOf(cfg: AgentConfig, s: ClaudeSession) {
  const text = transcript(s);
  if (text.length <= SESSION_LIMIT) return text;
  const msg = await complete(
    cfg,
    [
      { role: 'system', content: SESSION_PROMPT },
      { role: 'user', content: `会话标题：${s.title || '无'}\n项目：${projectName(s.project)}\n\n${text}` },
    ],
    false,
  );
  return `（摘要）${msg.content?.trim() ?? ''}`;
}

/** 限制并发，避免一次打出太多请求 */
async function mapLimit<T, R>(xs: T[], limit: number, fn: (x: T) => Promise<R>) {
  const out: R[] = new Array(xs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, xs.length) }, async () => {
      while (next < xs.length) {
        const i = next++;
        out[i] = await fn(xs[i]);
      }
    }),
  );
  return out;
}

/** 一天的材料：各会话摘录（长的先压缩）、Daybook 里的对话、待办 */
/** 进度说明，界面上实时显示（见 server/jobs.ts） */
export type Progress = (text: string) => void;

async function gather(date: string, progress: Progress) {
  const cfg = agentConfig();
  if (!isConfigured(cfg)) throw new AgentConfigError('agent 未配置：在左侧栏「设置」里填写接口地址和模型');

  progress('读取当天的 Claude 会话…');
  const sessions = await claudeSessionsOn(date);
  const hubTurns = chatLog(date);
  const todos = (await runAction('todo', 'list', { date })) as { id: string; title: string; done: boolean; category: string | null }[];
  if (!sessions.length && !hubTurns.length) throw new NothingToSummarize('这一天在 Claude 和 Daybook 里都没有对话记录');

  const long = sessions.filter((s) => transcript(s).length > SESSION_LIMIT).length;
  let compressed = 0;
  progress(long ? `找到 ${sessions.length} 个会话，正在压缩其中 ${long} 个长会话…` : `找到 ${sessions.length} 个会话`);
  const briefs = await mapLimit(sessions, 4, async (s) => {
    const isLong = transcript(s).length > SESSION_LIMIT;
    const brief = await cachedBrief(cfg, s);
    if (isLong) progress(`压缩长会话 ${++compressed}/${long}：${s.title || '无标题'}`);
    return brief;
  });
  const conversations = [
    `日期：${date}`,
    '',
    '# Claude Code 会话',
    ...(sessions.length
      ? sessions.flatMap((s, i) => [
          '',
          `## ${time(s.turns[0].at)} ${s.title || '无标题'}（${projectName(s.project)}，${s.turns.length} 轮）`,
          briefs[i],
        ])
      : ['（没有）']),
    '',
    '# Daybook 里和 agent 的对话',
    ...(hubTurns.length ? hubTurns.map((t) => `[${time(t.at)}] 用户：${t.user}\n  助手：${t.reply.slice(0, 300)}`) : ['（没有）']),
  ].join('\n');
  return {
    cfg,
    conversations,
    todos,
    sessions: sessions.length,
    turns: sessions.reduce((n, s) => n + s.turns.length, 0) + hubTurns.length,
  };
}

// 生成总结和生成待办会各读一遍材料，长会话的压缩结果缓存起来（会话有新对话时轮数变了会重新压缩）
const briefCache = new Map<string, string>();
async function cachedBrief(cfg: AgentConfig, s: ClaudeSession) {
  const key = `${s.id}:${s.turns[0].at}:${s.turns.length}`;
  const hit = briefCache.get(key);
  if (hit) return hit;
  const brief = await briefOf(cfg, s);
  briefCache.set(key, brief);
  return brief;
}

export async function draftSummary(date: string, progress: Progress = () => {}) {
  const g = await gather(date, progress);
  const { content: existing } = (await runAction('worklog', 'get', { date })) as { content: string };
  const done = g.todos.filter((t) => t.done).map((t) => t.title);
  const material = [
    g.conversations,
    '',
    '# 当天完成的待办',
    ...(done.length ? done.map((t) => `- ${t}`) : ['（没有）']),
    '',
    '# 已有总结',
    existing.trim() || '（空）',
  ].join('\n');

  progress('正在写总结…');
  const msg = await complete(
    g.cfg,
    [
      { role: 'system', content: FINAL_PROMPT },
      { role: 'user', content: material },
    ],
    false,
  );
  const draft = msg.content?.trim();
  if (!draft) throw new Error('模型没有返回总结');
  return { draft, sessions: g.sessions, turns: g.turns };
}

// ───────── 没收尾的事 → 待办提案 ─────────

const TODO_PROMPT = `下面是用户某一天和 AI 助手的各个会话摘录或摘要，以及已有的待办（按分类列出）。
请整理出需要后续跟进的事，要求：
- 一件大事是一个分类，按项目或目标命名，比如「统一三台机器的分支」；里面每一步是一条待办，比如「推送到远端」
- 属于已有分类的，category 用一模一样的分类名，不要另起意思相近的分类
- 零散的小事可以不分类（不写 category）
- 只挑材料里明确还没收尾的事，不要编造；已有的待办不要重复；试用性质、和工作无关的小事直接略过
- 新建的待办最多 8 条，标题动词开头，不超过 20 个字
- 只输出 JSON 数组，不要别的文字。每一项是：{"todo": "待办标题", "category": "分类名"}
- 没有需要跟进的就输出 []`;

const normalize = (s: string) => s.replace(/[\s，。、,.!！?？「」“”"']/g, '').toLowerCase();

type Suggestion = { todo?: string; category?: string };

/**
 * 让模型从对话里整理出没收尾的事，按分类（一件大事）归好。
 * 每一条都是一个提案，在时间线里批准后才写进笔记。
 */
export async function proposeTodos(date: string, progress: Progress = () => {}) {
  const g = await gather(date, progress);
  const open = g.todos.filter((t) => !t.done);
  const pending = listProposals('pending').filter((p) => p.module === 'todo' && p.action === 'add');
  const pendingTitles = pending.map((p) => (p.input as { title: string }).title);

  const groups = [...new Set(open.map((t) => t.category))];
  const material = [
    g.conversations,
    '',
    '# 已有的待办',
    ...groups.flatMap((c) => [c ? `分类「${c}」：` : '不分类：', ...open.filter((t) => t.category === c).map((t) => `  - ${t.title}`)]),
    ...g.todos.filter((t) => t.done).map((t) => `已完成: ${t.category ? `${t.category}：` : ''}${t.title}`),
    ...pending.map((p) => `待批准: ${p.summary}`),
    ...(g.todos.length || pending.length ? [] : ['（没有）']),
  ].join('\n');

  progress('正在整理需要跟进的事…');
  const msg = await complete(
    g.cfg,
    [
      { role: 'system', content: TODO_PROMPT },
      { role: 'user', content: material },
    ],
    false,
  );
  let suggestions: Suggestion[];
  try {
    suggestions = JSON.parse(msg.content?.match(/\[[\s\S]*\]/)?.[0] ?? '[]');
    if (!Array.isArray(suggestions)) throw new Error();
  } catch {
    throw new Error('模型返回的格式不对，请重试');
  }

  // 已有待办、待批准的提案里已经有的都跳过；分类名和已有的只差标点空格时用已有的写法
  const seenTitles = new Set([...g.todos.map((t) => t.title), ...pendingTitles].map(normalize));
  const known = new Map(g.todos.flatMap((t) => (t.category ? [[normalize(t.category), t.category] as const] : [])));
  const created = [];
  for (const s of suggestions) {
    if (created.length >= 8) break;
    const title = typeof s.todo === 'string' ? s.todo.trim() : '';
    if (!title || seenTitles.has(normalize(title))) continue;
    seenTitles.add(normalize(title));
    const raw = typeof s.category === 'string' ? s.category.trim() : '';
    const category = raw ? (known.get(normalize(raw)) ?? raw) : undefined;
    created.push(createProposal('todo', 'add', { title, category, date }));
  }
  return { suggested: suggestions.length, created: created.length };
}
