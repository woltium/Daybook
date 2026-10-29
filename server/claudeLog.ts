// 读取 Claude Code 的对话记录（~/.claude/projects/<项目>/<会话>.jsonl），
// 整理出某一天每个会话里「你说了什么、Claude 最后答了什么」的精简摘录，用来写工作总结。
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { beijingMidnight } from '../core/time.ts';
import { createInterface } from 'node:readline';

export const claudeProjectsDir = () => process.env.HUB_CLAUDE_DIR ?? join(homedir(), '.claude', 'projects');

export interface ClaudeTurn {
  at: string;
  user: string;
  /** 这一轮 Claude 最后一段文字回复 */
  reply: string;
}

export interface ClaudeSession {
  id: string;
  title: string;
  project: string;
  turns: ClaudeTurn[];
}

const MAX_USER = 300;
const MAX_REPLY = 300;

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** 去掉系统附加的提示和粘贴的大段内容，只留自己打的字 */
const cleanUser = (s: string) =>
  s
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, '［粘贴的内容］')
    .replace(/<command-[\w-]+>[\s\S]*?<\/command-[\w-]+>/g, '')
    .trim();

type Content = string | { type: string; text?: string }[];
const textOf = (c: Content) => (typeof c === 'string' ? c : c.filter((x) => x.type === 'text').map((x) => x.text ?? '').join('\n'));

interface Rec {
  type: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  origin?: { kind?: string } | null;
  timestamp?: string;
  cwd?: string;
  customTitle?: string;
  message?: { content: Content };
}

const isHuman = (r: Rec) => {
  if (r.type !== 'user' || r.isMeta || r.isSidechain || !r.message) return false;
  if (r.origin) return r.origin.kind === 'human';
  // 旧版本没有 origin：有文字、不是工具结果、不是系统注入
  const text = textOf(r.message.content);
  return Boolean(text) && !text.startsWith('<');
};

async function readSession(file: string, from: number, to: number): Promise<ClaudeSession | null> {
  const session: ClaudeSession = { id: basename(file, '.jsonl'), title: '', project: '', turns: [] };
  let current: ClaudeTurn | null = null;
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let r: Rec;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r.type === 'custom-title' && r.customTitle) session.title = r.customTitle;
    if (isHuman(r)) {
      const t = Date.parse(r.timestamp ?? '');
      current = null;
      if (t >= from && t < to) {
        const user = cleanUser(textOf(r.message!.content));
        if (user) {
          current = { at: r.timestamp!, user: clip(user, MAX_USER), reply: '' };
          session.turns.push(current);
          if (r.cwd) session.project = r.cwd.replace(homedir(), '~');
        }
      }
    } else if (current && r.type === 'assistant' && !r.isSidechain && r.message) {
      const text = textOf(r.message.content).trim();
      if (text) current.reply = clip(text, MAX_REPLY);
    }
  }
  return session.turns.length ? session : null;
}

/** 某一天（本地时间）在 Claude Code 里的所有会话 */
export async function claudeSessionsOn(date: string): Promise<ClaudeSession[]> {
  const root = claudeProjectsDir();
  if (!existsSync(root)) return [];
  const from = beijingMidnight(date);
  const to = from + 24 * 3600 * 1000;
  const files = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) =>
      readdirSync(join(root, d.name))
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => join(root, d.name, f)),
    )
    // 当天之前就没再动过的文件不用看
    .filter((f) => statSync(f).mtimeMs >= from);
  const sessions = await Promise.all(files.map((f) => readSession(f, from, to)));
  return sessions.filter((s): s is ClaudeSession => s !== null).sort((a, b) => a.turns[0].at.localeCompare(b.turns[0].at));
}
