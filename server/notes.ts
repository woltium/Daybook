// 每日笔记：一个文件夹里每天一个 MMDD.md，按「## 标题」分节。
// 文件夹可以是「文档」下自动新建的本地文件夹，也可以是 Obsidian 库里的某个文件夹。
// 模块只读写自己那一节（待办 / 工作总结），文件里的其它内容原样保留。
import { existsSync, mkdirSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Notes } from '../core/module.ts';
import { readSection, saveSection } from './config.ts';

export type NotesMode = 'local' | 'obsidian';

interface NotesConfig {
  mode: NotesMode;
  /** Obsidian 模式下的文件夹 */
  dir: string;
}

export class NotesNotConfigured extends Error {
  constructor() {
    super('还没有设置 Obsidian 文件夹：在「设置」里填写，或者改用本地文件夹');
  }
}

/** 系统的「文档」目录（XDG_DOCUMENTS_DIR），找不到就用 ~/Documents */
function documentsDir() {
  const home = homedir();
  if (process.env.XDG_DOCUMENTS_DIR) return process.env.XDG_DOCUMENTS_DIR;
  try {
    const m = /^XDG_DOCUMENTS_DIR="(.+)"$/m.exec(readFileSync(join(home, '.config/user-dirs.dirs'), 'utf8'));
    if (m) return m[1].replace('$HOME', home);
  } catch {
    // 没有 user-dirs.dirs（macOS、Windows 或精简的 Linux）
  }
  return join(home, 'Documents');
}

/** 本地模式用的文件夹：文档/信息中心 */
export const localNotesDir = () => join(documentsDir(), '信息中心');

/** 以前只存了 dir 的配置算 Obsidian 模式，什么都没设就用本地文件夹 */
export function notesConfig(): NotesConfig {
  const c = readSection<NotesConfig>('notes');
  return { mode: c.mode ?? (c.dir ? 'obsidian' : 'local'), dir: c.dir ?? '' };
}

export function notesDir() {
  if (process.env.HUB_NOTES_DIR) return process.env.HUB_NOTES_DIR;
  const { mode, dir } = notesConfig();
  return mode === 'local' ? localNotesDir() : dir;
}

export function saveNotesConfig(c: NotesConfig) {
  saveSection<NotesConfig>('notes', c);
  restartWatch();
}

/** 2026-10-28 → 1028.md（沿用原有命名，不含年份） */
export const fileName = (date: string) => `${date.slice(5, 7)}${date.slice(8, 10)}.md`;

function pathFor(date: string) {
  const dir = notesDir();
  if (!dir) throw new NotesNotConfigured();
  return join(dir, fileName(date));
}

// ───────── 解析与生成 ─────────

interface Doc {
  /** 第一个「## 」标题之前的内容 */
  pre: string[];
  sections: { name: string; lines: string[] }[];
}

const HEADING = /^##\s+(.+?)\s*$/;

function parse(text: string): Doc {
  const doc: Doc = { pre: [], sections: [] };
  let current = doc.pre;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const m = HEADING.exec(line);
    if (m) {
      const section = { name: m[1], lines: [] as string[] };
      doc.sections.push(section);
      current = section.lines;
    } else {
      current.push(line);
    }
  }
  return doc;
}

/** 去掉首尾空行 */
const trimLines = (lines: string[]) => {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
};

function serialize(doc: Doc) {
  const out: string[] = [];
  const pre = trimLines(doc.pre);
  if (pre.length) out.push(...pre, '');
  for (const s of doc.sections) {
    out.push(`## ${s.name}`, ...trimLines(s.lines), '');
  }
  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

const readDoc = (date: string): Doc | null => {
  const path = pathFor(date);
  return existsSync(path) ? parse(readFileSync(path, 'utf8')) : null;
};

// ───────── 对模块公开的接口 ─────────

export const notes: Notes = {
  exists: (date) => existsSync(pathFor(date)),

  read(date, section) {
    const s = readDoc(date)?.sections.find((x) => x.name === section);
    return s ? trimLines(s.lines).join('\n') : null;
  },

  write(date, section, content, position = 'end') {
    const path = pathFor(date);
    const doc = readDoc(date) ?? { pre: [], sections: [] };
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    const existing = doc.sections.find((x) => x.name === section);
    if (existing) existing.lines = lines;
    else if (position === 'start') doc.sections.unshift({ name: section, lines });
    else doc.sections.push({ name: section, lines });
    mkdirSync(notesDir(), { recursive: true });
    writeFileSync(path, serialize(doc));
  },

  mtime(date) {
    const path = pathFor(date);
    return existsSync(path) ? statSync(path).mtime.toISOString() : null;
  },

  previous(date, maxDays = 60) {
    const d = new Date(`${date}T00:00:00`);
    for (let i = 0; i < maxDays; i++) {
      d.setDate(d.getDate() - 1);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (existsSync(pathFor(iso))) return iso;
    }
    return null;
  },
};

// ───────── 在外面（Obsidian、编辑器）改了文件也要通知界面 ─────────

let watcher: FSWatcher | null = null;
let onExternalChange: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function restartWatch() {
  watcher?.close();
  watcher = null;
  const dir = notesDir();
  if (!dir || !onExternalChange) return;
  // 本地文件夹由我们管，先建好，这样用户在文件夹里手动改的文件也能刷新到界面
  if (notesConfig().mode === 'local' && !process.env.HUB_NOTES_DIR) mkdirSync(dir, { recursive: true });
  if (!existsSync(dir)) return;
  try {
    watcher = watch(dir, () => {
      clearTimeout(timer);
      timer = setTimeout(() => onExternalChange?.(), 200);
    });
  } catch (err) {
    console.error('无法监听每日笔记文件夹', err);
  }
}

export function watchNotes(fn: () => void) {
  onExternalChange = fn;
  restartWatch();
}
