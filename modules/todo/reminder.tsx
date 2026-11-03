// 待办提醒弹窗的内容。窗口的开关由 electron/main.ts 负责：这里的操作改了提醒状态，没有到点的待办时窗口自己会关。
import { AlarmClock, Check } from 'lucide-react';
import { useEffect } from 'react';
import { call, useQuery } from '../../web/src/core/client.ts';
import { beijingAt } from '../../core/time.ts';
import { cityTimes, useWorldClock } from '../../web/src/core/worldclock.ts';
import { Button, WorldClock } from '../../web/src/ui/kit.tsx';

const SNOOZE_MINUTES = 10;

export function ReminderPopup() {
  const { data, reload } = useQuery('todo', 'due', {});
  const cities = useWorldClock();
  // 弹窗开着时又有别的待办到点，也要列出来
  useEffect(() => {
    const t = setInterval(reload, 15_000);
    return () => clearInterval(t);
  }, [reload]);
  return (
    <div className="reminder">
      <header className="reminder__head">
        <span className="reminder__title">
          <AlarmClock size={15} />
          待办提醒
        </span>
        <WorldClock limit={1} />
      </header>
      <ul className="reminder__list">
        {data?.map((t) => (
          <li key={t.id} className="reminder__item">
            <div className="reminder__name">{t.title}</div>
            <div className="reminder__actions">
              <span className="muted" title={cityTimes(cities, beijingAt(t.date, t.time!))}>
                {t.time}
              </span>
              <Button variant="primary" icon={Check} onClick={() => call('todo', 'setDone', { id: t.id, done: true })}>
                完成
              </Button>
              <Button onClick={() => call('todo', 'snooze', { id: t.id, minutes: SNOOZE_MINUTES })}>{SNOOZE_MINUTES} 分钟后</Button>
              <Button variant="ghost" onClick={() => call('todo', 'dismiss', { id: t.id })}>
                关掉
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
