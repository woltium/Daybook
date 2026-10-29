// 用 esbuild 打包主进程（含后端）和 preload。npm 依赖保持外部引用。
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';

export const configs = [
  {
    entryPoints: ['electron/main.ts'],
    outfile: 'dist-electron/main.mjs',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    packages: 'external',
    sourcemap: true,
    // 依赖里的 CommonJS 需要 require
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  },
  {
    entryPoints: ['electron/preload.ts'],
    outfile: 'dist-electron/preload.cjs',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['electron'],
  },
];

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await Promise.all(configs.map((c) => build(c)));
  console.log('dist-electron 已生成');
}
