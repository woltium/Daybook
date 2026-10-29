// 「今天」页：一首轮换的诗 + 今天发生的事（含待批准的提案）。只依赖时间线和 manifest，不关心具体模块。
import { Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../core/client.ts';
import { formatDate, today } from '../core/date.tsx';
import { Button, PageFrame } from '../ui/kit.tsx';
import { poemAt } from './poems.ts';
import { Timeline } from './Timeline.tsx';
import { useManifest } from './manifest.ts';

export function Today({ onOpenModule }: { onOpenModule: (id: string) => void }) {
  const manifest = useManifest();
  const [copied, setCopied] = useState(false);
  const [, tick] = useState(0);

  // 过了零点让「今天」跟着变，诗也按时换档
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  /** 拼接各模块的 report（有这个 action 的模块才参与），复制为日报 */
  const copyReport = async () => {
    const parts = await Promise.all(
      manifest
        .filter((m) => m.actions.some((a) => a.name === 'report'))
        .map((m) => api.post<{ result: string }>(`/api/m/${m.id}/report`, { date: today() }).then((r) => r.result)),
    );
    await navigator.clipboard.writeText([`# ${today()} 日报`, ...parts.filter(Boolean)].join('\n\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const poem = poemAt();

  return (
    <PageFrame
      title="今天"
      sub={formatDate(today())}
      tools={
        <Button icon={Copy} onClick={() => void copyReport()}>
          {copied ? '已复制' : '复制日报'}
        </Button>
      }
    >
      <figure className="poem">
        <blockquote className="poem__lines">{poem.lines}</blockquote>
        <figcaption className="poem__by">
          — {poem.author}，<cite>{poem.title}</cite>
        </figcaption>
      </figure>
      <Timeline onOpenModule={onOpenModule} />
    </PageFrame>
  );
}
