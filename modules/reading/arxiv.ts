// arXiv 公开 API（Atom XML）。无需 key，官方建议请求间隔 ≥ 3 秒。
export interface ArxivPaper {
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  published: string;
  url: string;
  pdfUrl: string;
}

const API = 'https://export.arxiv.org/api/query';

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const tag = (xml: string, name: string) => decode(xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? '');

function parse(xml: string): ArxivPaper[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
    const absUrl = tag(e, 'id');
    const arxivId = absUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, '').replace(/v\d+$/, '');
    return {
      arxivId,
      title: tag(e, 'title'),
      authors: [...e.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) => decode(m[1])),
      abstract: tag(e, 'summary'),
      published: tag(e, 'published').slice(0, 10),
      url: `https://arxiv.org/abs/${arxivId}`,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
    };
  });
}

async function get(params: Record<string, string>) {
  const res = await fetch(`${API}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(30_000) }).catch((err) => {
    throw new Error(err?.name === 'TimeoutError' ? 'arXiv 接口 30 秒没有响应，稍后再试' : `arXiv 请求失败：${err?.message}`);
  });
  if (!res.ok) throw new Error(`arXiv 请求失败：${res.status}`);
  return parse(await res.text());
}

export const searchArxiv = (query: string, max: number) =>
  get({ search_query: `all:${query}`, start: '0', max_results: String(max), sortBy: 'relevance' });

export async function fetchArxiv(arxivId: string) {
  const [paper] = await get({ id_list: arxivId });
  if (!paper?.title) throw new Error(`找不到 arXiv:${arxivId}`);
  return paper;
}

/** 从 arXiv 链接或编号中提取规范 id，如 2408.03314 */
export const parseArxivId = (s: string) => s.match(/(\d{4}\.\d{4,5})(v\d+)?/)?.[1] ?? null;
