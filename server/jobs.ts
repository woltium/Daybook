// 后台任务：生成总结草稿、生成待办提案这类要跑十几秒的事。
// 请求立即返回，进度和结果通过 /api/events 的 job 事件推给界面；切换页面再回来也能看到。
import { events } from './runtime.ts';

export interface Job<R = unknown> {
  key: string;
  status: 'running' | 'done' | 'error';
  /** 当前在做什么，比如「压缩长会话 2/5」 */
  progress: string;
  startedAt: string;
  result?: R;
  error?: string;
}

const jobs = new Map<string, Job>();

const publish = (job: Job) => events.emit('job', job);

export const getJob = (key: string) => jobs.get(key) ?? null;

/** 同一个 key 正在跑时直接返回那个任务，不重复启动 */
export function startJob<R>(key: string, run: (progress: (text: string) => void) => Promise<R>) {
  const existing = jobs.get(key);
  if (existing?.status === 'running') return existing;
  const job: Job = { key, status: 'running', progress: '准备中…', startedAt: new Date().toISOString() };
  jobs.set(key, job);
  publish(job);
  run((text) => {
    job.progress = text;
    publish(job);
  }).then(
    (result) => {
      job.status = 'done';
      job.result = result;
      publish(job);
    },
    (err: unknown) => {
      job.status = 'error';
      job.error = err instanceof Error ? err.message : String(err);
      publish(job);
    },
  );
  return job;
}

export function clearJob(key: string) {
  if (jobs.get(key)?.status !== 'running') jobs.delete(key);
  publish({ key, status: 'done', progress: '', startedAt: '', result: undefined });
}
