import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: 'web',
  base: './',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5178,
    strictPort: true,
    // 模块视图在 web/ 之外（modules/<id>/view.tsx）
    fs: { allow: [root] },
    proxy: { '/api': `http://127.0.0.1:${process.env.HUB_API_PORT ?? 5180}`, '/files': `http://127.0.0.1:${process.env.HUB_API_PORT ?? 5180}` },
  },
});
