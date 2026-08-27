import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  h1: ({ children }) => <h1 className="mb-4 mt-7 text-[22px] font-semibold leading-8 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-3 mt-6 text-[18px] font-semibold leading-7 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-5 text-[15px] font-semibold leading-6 first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="mb-4 mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-4 list-disc space-y-2 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-4 list-decimal space-y-2 pl-6">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-[var(--cp-border-strong)] pl-4 text-[var(--cp-text-muted)]">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="cp-flat-scrollbar my-5 max-w-full overflow-x-auto border-y border-[var(--cp-border)]">
      <table className="w-full min-w-[560px] border-separate border-spacing-0 text-left text-[13px] leading-5 [&_tbody_tr:nth-child(even)]:bg-[var(--cp-bg-subtle)]">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[var(--cp-bg-muted)]">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-[var(--cp-border-strong)] px-3 py-2.5 align-bottom font-semibold text-[var(--cp-text)]">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-[var(--cp-border-subtle)] px-3 py-2.5 align-top text-[var(--cp-text-soft)] last:border-r-0">
      {children}
    </td>
  ),
  pre: ({ children }) => (
    <pre className="cp-flat-scrollbar my-4 max-w-full overflow-x-auto rounded-[var(--cp-radius-item)] bg-[var(--cp-bg-muted)] p-3 font-mono text-[12px] leading-5">
      {children}
    </pre>
  ),
  code: ({ className, children }) => className ? (
    <code className={`${className} font-mono`}>{children}</code>
  ) : (
    <code className="rounded-[var(--cp-radius-xs)] bg-[var(--cp-bg-muted)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--cp-text)]">
      {children}
    </code>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-[var(--cp-text)] underline decoration-[var(--cp-border-strong)] underline-offset-4 hover:decoration-[var(--cp-text)]"
    >
      {children}
    </a>
  ),
};

export function AssistantMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}
