// 后台任务（server/jobs.ts）的界面状态：切换页面再回来，进度和结果都还在。
import { useCallback, useEffect, useState } from 'react';
import { api, onEvent } from './client.ts';

export interface Job<R> {
  key: string;
  status: 'running' | 'done' | 'error';
  progress: string;
  startedAt: string;
  result?: R;
  error?: string;
}

export function useJob<R>(kind: 'draft' | 'todos', date: string) {
  const key = `${kind}:${date}`;
  const [job, setJob] = useState<Job<R> | null>(null);

  useEffect(() => {
    let alive = true;
    setJob(null);
    void api.get<Job<R> | null>(`/api/summary/${kind}?date=${date}`).then((j) => alive && setJob(j));
    const off = onEvent('job', (data) => {
      const j = data as Job<R>;
      if (j.key === key) setJob(j.startedAt ? { ...j } : null);
    });
    return () => {
      alive = false;
      off();
    };
  }, [kind, date, key]);

  const start = useCallback(() => void api.post<Job<R>>(`/api/summary/${kind}`, { date }).then(setJob), [kind, date]);
  const clear = useCallback(() => void api.del(`/api/summary/${kind}?date=${date}`).then(() => setJob(null)), [kind, date]);

  return { job, start, clear, running: job?.status === 'running' };
}
