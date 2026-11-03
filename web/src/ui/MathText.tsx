// 文本里的 LaTeX 公式用 KaTeX 渲染：$$…$$、\[…\] 是块级公式，$…$、\(…\) 是行内公式。
// 行内 $ 按 pandoc 的规则判断，避免把「$5 到 $10」这种金额当成公式。
import katex from 'katex';
import 'katex/dist/katex.min.css';
import type { ReactNode } from 'react';

const MATH = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?!\s)((?:\\\$|[^$\n])+?)(?<!\s)\$(?!\d)/g;

function Formula({ tex, display }: { tex: string; display: boolean }) {
  const html = katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false, output: 'html' });
  return <span className={display ? 'math-block' : undefined} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** 把含公式的文本拆成 React 节点；非公式部分交给 plain 处理（默认原样输出） */
export function withMath(text: string, plain: (s: string, key: number) => ReactNode = (s) => s): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MATH)) {
    if (m.index > last) out.push(plain(text.slice(last, m.index), out.length));
    const block = m[1] ?? m[2];
    out.push(<Formula key={out.length} tex={block ?? m[3] ?? m[4]} display={block !== undefined} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(plain(text.slice(last), out.length));
  return out;
}

export function MathText({ text }: { text: string }) {
  return <>{withMath(text)}</>;
}
