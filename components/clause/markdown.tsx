'use client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
export function Markdown({ text, onPage, pages }: { text: string; onPage?: (page: number) => void; pages?: number[] }) {
  const source = onPage ? text.replace(/\[p\.\s*(\d+)\]/g, (whole, n) => (!pages || pages.includes(Number(n))) ? `[p. ${n}](#page-${n})` : whole) : text;
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ href, children }) => href?.startsWith('#page-') ? <button className="citation-inline" onClick={() => onPage?.(Number(href.slice(6)))}>{children}</button> : <span>{children}</span>,
    img: () => null,
  }}>{source}</ReactMarkdown></div>;
}
