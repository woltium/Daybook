// 自绘标题栏：整条可拖动窗口，右侧是最小化 / 最大化 / 关闭。在浏览器里调试时不显示按钮。
import { Copy, Minus, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { desktop } from '../core/desktop.ts';

export function TitleBar() {
  const controls = desktop.window;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!controls) return;
    void controls.isMaximized().then(setMaximized);
    return controls.onMaximized(setMaximized);
  }, [controls]);

  return (
    <div className="titlebar" onDoubleClick={() => void controls?.toggleMaximize()}>
      {controls && (
        <div className="titlebar__controls">
          <button type="button" className="win-btn" aria-label="最小化" onClick={() => void controls.minimize()}>
            <Minus size={15} />
          </button>
          <button type="button" className="win-btn" aria-label={maximized ? '还原' : '最大化'} onClick={() => void controls.toggleMaximize()}>
            {maximized ? <Copy size={13} style={{ transform: 'scaleX(-1)' }} /> : <Square size={12} />}
          </button>
          <button type="button" className="win-btn win-btn--close" aria-label="关闭" onClick={() => void controls.close()}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
