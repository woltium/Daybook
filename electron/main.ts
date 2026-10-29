// Electron 主进程：在本进程里启动后端，打开主窗口。
// 由 scripts/build-electron.mjs 打包成 dist-electron/main.mjs。
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, screen, shell } from 'electron';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const devUrl = process.env.HUB_DEV_URL;

// 以前叫 InfoHub（打包）/ info-hub（开发），新目录还没有时把旧的整个挪过来
const userData = app.getPath('userData');
if (!existsSync(userData)) {
  const old = ['InfoHub', 'info-hub'].map((n) => join(app.getPath('appData'), n)).find(existsSync);
  if (old) renameSync(old, userData);
}

// 必须在加载后端之前确定数据目录
process.env.HUB_DATA_DIR ??= app.isPackaged ? join(app.getPath('userData'), 'data') : join(root, 'data');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const { startServer } = await import('../server/app.ts');
const { filesDir } = await import('../server/db.ts');
// ───────── 窗口位置记忆 ─────────

interface Bounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}

const statePath = () => join(app.getPath('userData'), 'window.json');
const DEFAULT_BOUNDS: Bounds = { width: 1180, height: 800 };

function loadBounds(): Bounds {
  try {
    const b = JSON.parse(readFileSync(statePath(), 'utf8')) as Bounds;
    const visible =
      b.x === undefined ||
      b.y === undefined ||
      screen.getAllDisplays().some(({ workArea: a }) => b.x! < a.x + a.width - 80 && b.x! + b.width > a.x + 80 && b.y! >= a.y - 20 && b.y! < a.y + a.height - 80);
    return visible ? b : DEFAULT_BOUNDS;
  } catch {
    return DEFAULT_BOUNDS;
  }
}

function saveBounds(win: BrowserWindow) {
  try {
    writeFileSync(statePath(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }, null, 2));
  } catch (err) {
    console.error('保存窗口位置失败', err);
  }
}

// ───────── 主窗口（单窗口，模块在左侧栏切换） ─────────

let base = '';
let mainWindow: BrowserWindow | null = null;

function openMain() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return;
  }
  const bounds = loadBounds();
  const win = new BrowserWindow({
    title: 'Daybook',
    ...bounds,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    // 不用系统标题栏，标题栏和窗口按钮由界面自己画（见 web/src/ui/TitleBar.tsx）
    frame: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff',
    webPreferences: { preload: join(root, 'dist-electron', 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  if (bounds.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', () => saveBounds(win));
  win.on('closed', () => (mainWindow = null));

  // 外部链接交给系统浏览器
  const external = (url: string) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(base)) void shell.openExternal(url);
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    external(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(base)) {
      e.preventDefault();
      external(url);
    }
  });

  void win.loadURL(`${base}/#/today`);
  const sendMaximized = () => win.webContents.send('maximized', win.isMaximized());
  win.on('maximize', sendMaximized);
  win.on('unmaximize', sendMaximized);
  mainWindow = win;
}

// ───────── 给渲染进程的接口（见 preload.ts） ─────────

ipcMain.handle('window', (e, action: 'minimize' | 'toggle-maximize' | 'close' | 'is-maximized') => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return false;
  if (action === 'minimize') win.minimize();
  if (action === 'toggle-maximize') (win.isMaximized() ? win.unmaximize() : win.maximize());
  if (action === 'close') win.close();
  return win.isMaximized();
});
ipcMain.handle('open-external', (_e, url: string) => {
  if (/^https?:\/\//.test(url)) return shell.openExternal(url);
});
ipcMain.handle('open-file', async (_e, rel: string) => {
  const target = resolve(filesDir, rel);
  const r = relative(filesDir, target);
  if (r.startsWith('..') || r.includes(`..${sep}`)) throw new Error('非法路径');
  const err = await shell.openPath(target);
  if (err) throw new Error(err);
});

// ───────── 启动 ─────────

app.on('second-instance', () => openMain());
app.on('window-all-closed', () => app.quit());

// 注意：ESM 主进程的顶层 await 结束前 ready 不会触发，所以这里不能 await whenReady
async function start() {
  if (!devUrl) Menu.setApplicationMenu(null);
  const preferred = Number(process.env.HUB_API_PORT ?? 5179);
  const staticDir = devUrl ? undefined : join(root, 'dist');
  const server = await startServer(preferred, staticDir).catch(() => {
    console.warn(`端口 ${preferred} 被占用，改用随机端口`);
    return startServer(0, staticDir);
  });
  app.on('will-quit', () => server.close());

  base = devUrl ?? `http://127.0.0.1:${server.port}`;
  console.log(`后端 http://127.0.0.1:${server.port}  ·  界面 ${base}`);
  openMain();
}

app.whenReady().then(start, (err) => {
  console.error(err);
  app.quit();
});
