// 设置页：每日笔记存在哪、内置 agent 的模型接口。
import { useEffect, useState } from "react";
import { api } from "./core/client.ts";
import type { AgentConfig } from "./agent/AgentDock.tsx";
import { Button, PageFrame, Segmented } from "./ui/kit.tsx";

type NotesMode = "local" | "obsidian";
interface NotesConfig {
  mode: NotesMode;
  dir: string;
  obsidianDir: string;
  localDir: string;
  fromEnv: boolean;
}

export function Settings() {
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState("");
  const [notes, setNotes] = useState<NotesConfig | null>(null);
  const [notesMode, setNotesMode] = useState<NotesMode>("local");
  const [notesDir, setNotesDir] = useState("");
  const [notesStatus, setNotesStatus] = useState("");
  const loadNotes = () =>
    void api.get<NotesConfig>("/api/notes/config").then((c) => {
      setNotes(c);
      setNotesMode(c.mode);
      setNotesDir(c.obsidianDir);
    });
  useEffect(loadNotes, []);

  const saveNotes = async () => {
    try {
      await api.put("/api/notes/config", { mode: notesMode, dir: notesDir });
      setNotesStatus("已保存");
      loadNotes();
    } catch (err) {
      setNotesStatus((err as Error).message);
    }
  };

  const load = () =>
    void api.get<AgentConfig>("/api/agent/config").then((c) => {
      setConfig(c);
      setBaseUrl(c.baseUrl);
      setModel(c.model);
    });
  useEffect(load, []);

  const save = async () => {
    try {
      await api.put("/api/agent/config", {
        baseUrl,
        model,
        ...(apiKey ? { apiKey } : {}),
      });
      setApiKey("");
      setStatus("已保存");
      load();
    } catch (err) {
      setStatus((err as Error).message);
    }
  };

  return (
    <PageFrame title="设置">
      <h2 className="section-title">每日笔记</h2>
      <p className="muted" style={{ margin: 0 }}>
        待办和工作总结存成普通的 Markdown 文件，每天一个 MMDD.md，分「##
        待办」和「## 工作总结」两节。
      </p>
      <div style={{ alignSelf: "flex-start" }}>
        <Segmented
          value={notesMode}
          options={[
            { value: "local", label: "本地文件夹" },
            { value: "obsidian", label: "Obsidian" },
          ]}
          onChange={(m) => {
            setNotesMode(m);
            setNotesStatus("");
          }}
        />
      </div>
      {notesMode === "local" ? (
        <p className="muted" style={{ margin: 0 }}>
          存在 <code>{notes?.localDir}</code>，没有会自动新建。
        </p>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>
            存在 Obsidian 库里的某个文件夹（比如每日笔记文件夹），在 Obsidian
            里改了，界面会自动刷新。
          </p>
          <div className="settings-grid">
            <label className="muted" htmlFor="notes-dir">
              文件夹
            </label>
            <input
              id="notes-dir"
              className="input"
              value={notesDir}
              placeholder="/home/you/notes/每日待办"
              onChange={(e) => setNotesDir(e.target.value)}
            />
          </div>
        </>
      )}
      {notes?.fromEnv && (
        <p className="muted" style={{ margin: 0 }}>
          现在用的是环境变量 HUB_NOTES_DIR 指定的 <code>{notes.dir}</code>
          ，这里的设置要去掉它才生效。
        </p>
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Button variant="primary" onClick={() => void saveNotes()}>
          保存
        </Button>
        {notesStatus && <span className="muted">{notesStatus}</span>}
      </div>
      <div style={{ height: 12 }} />
      <h2 className="section-title">Agent 模型</h2>
      <p className="muted" style={{ margin: 0 }}>
        任意 OpenAI 兼容接口都可以，比如 DeepSeek、通义千问、Kimi、本地
        Ollama。保存在本机数据目录的 config.json。
      </p>
      <div className="settings-grid">
        <label className="muted" htmlFor="agent-base">
          接口地址
        </label>
        <input
          id="agent-base"
          className="input"
          value={baseUrl}
          placeholder="https://api.deepseek.com/v1"
          onChange={(e) => setBaseUrl(e.target.value)}
        />
        <label className="muted" htmlFor="agent-model">
          模型
        </label>
        <input
          id="agent-model"
          className="input"
          value={model}
          placeholder="deepseek-chat"
          onChange={(e) => setModel(e.target.value)}
        />
        <label className="muted" htmlFor="agent-key">
          API Key
        </label>
        <input
          id="agent-key"
          className="input"
          type="password"
          value={apiKey}
          placeholder={
            config?.hasKey ? "已设置，留空表示不修改" : "本地模型可以留空"
          }
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Button variant="primary" onClick={() => void save()}>
          保存
        </Button>
        {status && <span className="muted">{status}</span>}
      </div>
    </PageFrame>
  );
}
