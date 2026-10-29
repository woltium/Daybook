import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** 数据目录：桌面版由主进程通过 HUB_DATA_DIR 指定，默认是项目下的 data/ */
export const dataDir = process.env.HUB_DATA_DIR ?? join(process.cwd(), 'data');
export const filesDir = join(dataDir, 'files');
mkdirSync(filesDir, { recursive: true });

export const db = new DatabaseSync(process.env.HUB_DB ?? join(dataDir, 'hub.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS items (
    id         TEXT PRIMARY KEY,
    module     TEXT NOT NULL,
    date       TEXT,
    data       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_items_module_date ON items (module, date);

  CREATE TABLE IF NOT EXISTS proposals (
    id           TEXT PRIMARY KEY,
    conversation TEXT,
    module       TEXT NOT NULL,
    action       TEXT NOT NULL,
    input        TEXT NOT NULL,
    summary      TEXT NOT NULL,
    status       TEXT NOT NULL,          -- pending | applied | rejected | failed
    result       TEXT,
    notified     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals (status);

  CREATE TABLE IF NOT EXISTS activity (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    module  TEXT NOT NULL,
    action  TEXT NOT NULL,
    summary TEXT NOT NULL,
    via     TEXT NOT NULL,              -- ui | agent
    date    TEXT NOT NULL,              -- 本地日期 YYYY-MM-DD
    at      TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_activity_date ON activity (date);

  -- 和 agent 的每一轮对话（用户的话 + 最终回复 + 调用过的工具），用来生成工作总结
  CREATE TABLE IF NOT EXISTS chat_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation TEXT NOT NULL,
    scope        TEXT NOT NULL DEFAULT 'today',  -- 在哪一页聊的：today 或模块 id
    date         TEXT NOT NULL,
    user         TEXT NOT NULL,
    reply        TEXT NOT NULL,
    steps        TEXT NOT NULL,
    at           TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_log_date ON chat_log (date);
`);

// 旧数据库补上 scope 列
const chatCols = db.prepare('PRAGMA table_info(chat_log)').all() as { name: string }[];
if (!chatCols.some((c) => c.name === 'scope')) db.exec("ALTER TABLE chat_log ADD COLUMN scope TEXT NOT NULL DEFAULT 'today'");
