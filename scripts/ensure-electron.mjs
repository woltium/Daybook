// Electron 自带的安装脚本在这台机器上会解压不完整（没有报错就退出）。
// 这里检查一遍，缺了就从 ~/.cache/electron 里的压缩包手动解压。
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

export function ensureElectron() {
  const dir = join(process.cwd(), 'node_modules', 'electron');
  if (!existsSync(dir)) return;

  const { version } = require(join(dir, 'package.json'));
  const binary = join(dir, 'dist', 'electron');
  if (existsSync(join(dir, 'path.txt')) && existsSync(binary)) return;

  if (process.platform !== 'linux') {
    execFileSync(process.execPath, [join(dir, 'install.js')], { stdio: 'inherit' });
    return;
  }

  const zipName = `electron-v${version}-linux-${process.arch}.zip`;
  const cacheRoot = process.env.electron_config_cache ?? join(homedir(), '.cache', 'electron');
  const findZip = () =>
    existsSync(cacheRoot)
      ? readdirSync(cacheRoot)
          .map((d) => join(cacheRoot, d, zipName))
          .find(existsSync)
      : undefined;

  // 缓存里没有就先让官方脚本下载
  if (!findZip()) execFileSync(process.execPath, [join(dir, 'install.js')], { stdio: 'inherit' });
  const zip = findZip();
  if (!zip) {
    throw new Error(`找不到 ${zipName}，请检查网络或设置 ELECTRON_MIRROR 后重试 npm install`);
  }

  rmSync(join(dir, 'dist'), { recursive: true, force: true });
  execFileSync('unzip', ['-q', zip, '-d', join(dir, 'dist')], { stdio: 'inherit' });
  writeFileSync(join(dir, 'path.txt'), 'electron');
  console.log(`已从缓存解压 Electron ${version}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) ensureElectron();
