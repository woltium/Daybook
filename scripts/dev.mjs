// 开发模式：Vite 提供界面（热更新），esbuild 监听主进程和后端，改动后自动重启 Electron。
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { context } from 'esbuild';
import { createServer } from 'vite';
import { configs } from './build-electron.mjs';
import { ensureElectron } from './ensure-electron.mjs';

const require = createRequire(import.meta.url);
ensureElectron();
const electronPath = require('electron');

const API_PORT = process.env.HUB_API_PORT ?? '5180';
process.env.HUB_API_PORT = API_PORT;

const vite = await createServer({ configFile: 'vite.config.ts' });
await vite.listen();
const devUrl = vite.resolvedUrls.local[0].replace(/\/$/, '');

let child = null;
let restarting = false;
let timer = null;

function startElectron() {
  child = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, HUB_DEV_URL: devUrl, HUB_API_PORT: API_PORT },
  });
  child.on('exit', () => {
    if (restarting) {
      restarting = false;
      startElectron();
    } else {
      void shutdown();
    }
  });
}

function scheduleRestart() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!child) return startElectron();
    console.log('[dev] 主进程已重新构建，重启 Electron');
    restarting = true;
    child.kill();
  }, 150);
}

const rebuild = { name: 'restart', setup: (b) => b.onEnd((r) => !r.errors.length && scheduleRestart()) };
const contexts = await Promise.all(configs.map((c) => context({ ...c, plugins: [rebuild] })));
await Promise.all(contexts.map((c) => c.watch()));

async function shutdown() {
  await Promise.all(contexts.map((c) => c.dispose()));
  await vite.close();
  process.exit(0);
}
process.on('SIGINT', () => {
  restarting = false;
  child ? child.kill() : void shutdown();
});
