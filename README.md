# 信息中心

本地桌面应用（Electron，单窗口），三个平级模块：每日待办、工作总结、待看（论文 / 推文 / 知识点）。
左侧栏是「今天」和各模块入口（带数字）；「今天」页按时间列出今天发生的事，agent 的提案也在时间线里批准或拒绝。
每一页底部都有 agent 对话框。每页一个独立的对话，用各自固定的提示词（模块的写在 `defineModule` 的 `agentPrompt` 里，
「今天」页的在 `server/agent.ts`）；换页再回来，这一页的对话还在。

## 运行

```bash
npm install
npm run dev        # 开发：界面热更新，主进程或后端改动后自动重启
npm start          # 构建后以正式模式运行
npm run dist       # 打包成 AppImage 和 deb，输出到 release/
npm run server     # 只跑后端，不开窗口（给外部 agent 用）
npm run typecheck
```

数据位置：
- 待办和工作总结：每日笔记文件夹，在「设置」里选——「本地文件夹」（默认，`文档/信息中心`，没有会自动新建）
  或「Obsidian」（填库里的某个文件夹）；也可以用 `HUB_NOTES_DIR` 直接指定。每天一个 `MMDD.md`，
  「## 待办」一节是 `- [ ]` / `- [/]`（处理中）/ `- [x]` 复选框（顶格），下面缩进的 `  - ` 行是这条待办的细项；
  「## 工作总结」一节是总结正文；文件里的其它内容原样保留。
  新的一天第一次打开时，会把上一个文件里没做完的待办抄过来。在 Obsidian 或编辑器里改文件，界面会自动刷新。
- 其它（待看、时间线、提案、agent 对话记录、配置）：开发和 `npm start` 用项目下的 `data/`；
  打包后的应用用 `~/.config/InfoHub/data/`。可以用 `HUB_DATA_DIR` 覆盖。

## 结构

```
core/module.ts          模块契约：defineModule + query / mutation
modules/<id>/module.ts  模块的数据 schema 和 action（服务端，不含 UI）
modules/<id>/view.tsx   模块的界面：icon + Badge（侧栏图标和数字）、Page（模块页）
modules/index.ts        服务端模块注册表
web/src/views.ts        界面注册表
web/src/ui/kit.tsx      共享组件（按钮、快速添加、行内编辑、自动保存文本框、日期切换、页面骨架……）
web/src/core/client.ts  call / useQuery：界面只能通过 action 访问模块，类型从模块定义推导
web/src/main.tsx        外壳：左侧栏 + 路由（#/today、#/m/<id>、#/settings）
web/src/today/          「今天」页：时间线（含提案审批）、agent 对话
server/                 后端：模块运行时、SQLite 存储、时间线、提案、工具网关、agent、HTTP 接口
electron/               主进程（单窗口、位置记忆）和 preload
```

### 新增一个模块

1. `modules/<id>/module.ts`：用 `defineModule` 定义 schema、`agentPrompt`（这一页 agent 的固定提示词）和 action。只读的用 `a.query`，写操作用 `a.mutation`，
   写操作要提供 `describe`（提案里给人看的一句话）；时间线默认也用它，想换个说法就写 `activity`，返回 null 不记录。
   不想开放给 agent 的 action 设 `agent: false`。
2. `modules/<id>/view.tsx`：导出 `{ icon, Page, Badge }`，用 `call` / `useQuery` 和共享组件。
3. 在 `modules/index.ts` 和 `web/src/views.ts` 各加一行。

模块之间只能通过 `ctx.query` 读取别的模块公开的 query，不能改别人的数据。

## Agent 与提案

- 所有开放给 agent 的 action 都会自动变成工具（JSON Schema 来自 zod）。
- query 直接返回结果；mutation **只生成提案**，要在「今天」时间线里批准后才执行。
  批准或拒绝的结果会在下一轮对话里告诉 agent。
- 内置 agent 支持任意 OpenAI 兼容接口（DeepSeek、通义、Kimi、本地 Ollama 等），
  在左侧栏「设置」里填写，保存在数据目录的 `config.json`。
  也可以用环境变量 `HUB_AGENT_BASE_URL`、`HUB_AGENT_MODEL`、`HUB_AGENT_API_KEY`。
- 工作总结页的「根据当天的 Claude 对话生成」会读取 Claude Code 当天的会话记录（`~/.claude/projects/*/*.jsonl`，
  只取你打的字和每轮最后的回复，并截断），加上信息中心里和 agent 的对话、完成的待办，交给模型概括成 3–8 条。
  长会话会先各自压成一两句再汇总。草稿可以改完再选择替换或追加，不会自动写入。
  旁边的「从对话整理待办提案」会找出当天没收尾的事，按整体的目标来记：要么新建一个待办（最多 4 条），
  零碎的验证、推送之类缩进挂在下面；要么把细项补到已有的待办下面。每一项是一个提案，到「今天」页批准后才写进笔记。
  两个按钮都在后台跑，页面上会显示进度，切换页面再回来结果还在。
  注意：这些对话内容会发给你配置的模型接口。
- 外部 agent 可以直接用工具网关（应用运行时默认端口 5179）：

```bash
curl http://127.0.0.1:5179/api/tools
```

```bash
curl -X POST http://127.0.0.1:5179/api/tools/reading__savePaper -H 'Content-Type: application/json' -d '{"arxivId":"2408.03314"}'
```

注意：接口只监听本机，但没有鉴权；本机上的其它程序可以直接调用审批接口。
