// 单窗口：左侧栏是「今天」和各模块入口，右侧显示当前页。路由用 hash：#/today、#/m/<id>、#/settings。
import { CalendarDays, Settings as SettingsIcon } from 'lucide-react';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ModuleId } from '../../modules/index.ts';
import { DateProvider } from './core/date.tsx';
import { Settings } from './Settings.tsx';
import { AgentDock } from './agent/AgentDock.tsx';
import { Today } from './today/Today.tsx';
import { TitleBar } from './ui/TitleBar.tsx';
import { useManifest } from './today/manifest.ts';
import { moduleOrder, views } from './views.ts';
import './styles.css';

type Route = 'today' | 'settings' | ModuleId;

const parse = (): Route => {
  const m = location.hash.match(/^#\/m\/([\w-]+)/);
  if (m && m[1] in views) return m[1] as ModuleId;
  return location.hash === '#/settings' ? 'settings' : 'today';
};
const hashOf = (r: Route) => (r === 'today' || r === 'settings' ? `#/${r}` : `#/m/${r}`);

function App() {
  const [route, setRoute] = useState(parse);
  const manifest = useManifest();
  const titles: Record<string, string> = Object.fromEntries(manifest.map((m) => [m.id, m.title]));

  useEffect(() => {
    const onHash = () => setRoute(parse());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);
  const go = (r: string) => {
    location.hash = hashOf(r as Route);
  };

  const Page = route === 'today' || route === 'settings' ? null : views[route].Page;

  return (
    <DateProvider>
      <div className="shell">
        <nav className="sidebar">
          <div className="sidebar__brand">Daybook</div>
          <button type="button" className="nav-item" aria-current={route === 'today' ? 'page' : undefined} onClick={() => go('today')}>
            <CalendarDays size={16} />
            <span className="nav-item__label">今天</span>
          </button>
          <div className="nav-sep" />
          {moduleOrder.map((id) => {
            const { icon: Icon, Badge } = views[id];
            return (
              <button key={id} type="button" className="nav-item" aria-current={route === id ? 'page' : undefined} onClick={() => go(id)}>
                <Icon size={16} />
                <span className="nav-item__label">{titles[id] ?? id}</span>
                <span className="nav-item__count">
                  <Badge />
                </span>
              </button>
            );
          })}
          <div className="sidebar__bottom">
            <button type="button" className="nav-item" aria-current={route === 'settings' ? 'page' : undefined} onClick={() => go('settings')}>
              <SettingsIcon size={16} />
              <span className="nav-item__label">设置</span>
            </button>
          </div>
        </nav>
        <div className="main">
          <TitleBar />
          {route === 'today' ? <Today onOpenModule={go} /> : route === 'settings' ? <Settings /> : Page && <Page />}
          {route !== 'settings' && (
            <AgentDock
              scope={route}
              name={route === 'today' ? '总览助手' : `${titles[route] ?? route}助手`}
              onOpenSettings={() => go('settings')}
            />
          )}
        </div>
      </div>
    </DateProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
