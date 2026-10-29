// 桌面能力（Electron preload 注入）。在普通浏览器里调试时退化为网页行为。
interface WindowControls {
  minimize(): Promise<boolean>;
  toggleMaximize(): Promise<boolean>;
  close(): Promise<boolean>;
  isMaximized(): Promise<boolean>;
  onMaximized(fn: (maximized: boolean) => void): () => void;
}

interface Desktop {
  openExternal(url: string): Promise<void>;
  openFile(rel: string): Promise<void>;
  /** 无边框窗口的按钮；浏览器里没有 */
  window?: WindowControls;
}

declare global {
  interface Window {
    desktop?: Desktop;
  }
}

export const desktop: Desktop = window.desktop ?? {
  openExternal: async (url) => void window.open(url, '_blank', 'noopener'),
  openFile: async (rel) => void window.open(`/files/${rel}`, '_blank'),
};
