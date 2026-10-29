// 渲染进程可用的桌面能力，类型见 web/src/core/desktop.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  openFile: (rel: string) => ipcRenderer.invoke('open-file', rel),
  window: {
    minimize: () => ipcRenderer.invoke('window', 'minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window', 'toggle-maximize'),
    close: () => ipcRenderer.invoke('window', 'close'),
    isMaximized: () => ipcRenderer.invoke('window', 'is-maximized'),
    onMaximized: (fn: (v: boolean) => void) => {
      const listener = (_e: unknown, v: boolean) => fn(v);
      ipcRenderer.on('maximized', listener);
      return () => void ipcRenderer.off('maximized', listener);
    },
  },
});
