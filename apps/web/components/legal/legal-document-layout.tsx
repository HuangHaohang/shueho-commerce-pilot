import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";

type LegalDocumentLayoutProps = {
  title: string;
  lead: string;
  children: React.ReactNode;
};

type LegalSource = {
  label: string;
  href: string;
};

export function LegalDocumentLayout({ title, lead, children }: LegalDocumentLayoutProps) {
  const operator = {
    name: process.env.COMMERCE_LEGAL_ENTITY_NAME?.trim() || null,
    creditCode: process.env.COMMERCE_LEGAL_CREDIT_CODE?.trim() || null,
    address: process.env.COMMERCE_LEGAL_REGISTERED_ADDRESS?.trim() || null,
    serviceEmail: process.env.COMMERCE_LEGAL_SERVICE_EMAIL?.trim() || null,
    privacyEmail: process.env.COMMERCE_LEGAL_PRIVACY_EMAIL?.trim() || null,
  };
  const operatorConfigured = Boolean(
    operator.name && operator.creditCode && operator.address && operator.serviceEmail && operator.privacyEmail,
  );
  return (
    <div className="min-h-dvh bg-[var(--cp-bg)] text-[var(--cp-text)]">
      <header className="sticky top-0 z-20 border-b border-[var(--cp-border-subtle)] bg-[rgba(255,255,255,0.94)] backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[960px] items-center justify-between px-4 md:px-8">
          <Link
            href="/"
            className="inline-flex h-9 items-center gap-2 rounded-[var(--cp-radius-item)] px-2 text-sm text-[var(--cp-text-soft)] transition-colors hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
          >
            <ArrowLeft className="size-4" strokeWidth={1.8} />
            返回
          </Link>
          <Link href="/" className="text-sm font-semibold text-[var(--cp-text)]">
            Commerce Pilot
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[760px] px-5 pb-20 pt-12 md:px-8 md:pt-16">
        <header className="border-b border-[var(--cp-border)] pb-9">
          <h1 className="m-0 text-[32px] font-semibold leading-tight tracking-[0] md:text-[36px]">{title}</h1>
          <p className="mt-4 max-w-[680px] text-[15px] leading-7 text-[var(--cp-text-muted)]">{lead}</p>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--cp-text-faint)]">
            <span>更新日期：2026 年 8 月 26 日</span>
            <span>生效日期：本版本向用户发布之日</span>
            <span>版本：内测版 0.2</span>
          </div>
        </header>

        <section className="border-b border-[var(--cp-border)] py-6" aria-label="运营主体信息">
          <h2 className="m-0 text-sm font-semibold">运营主体</h2>
          {operatorConfigured ? (
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm text-[var(--cp-text-muted)] sm:grid-cols-2">
              <div><dt className="inline">名称：</dt><dd className="inline">{operator.name}</dd></div>
              <div><dt className="inline">统一社会信用代码：</dt><dd className="inline">{operator.creditCode}</dd></div>
              <div className="sm:col-span-2"><dt className="inline">注册地址：</dt><dd className="inline">{operator.address}</dd></div>
              <div><dt className="inline">客服邮箱：</dt><dd className="inline">{operator.serviceEmail}</dd></div>
              <div><dt className="inline">个人信息保护联系邮箱：</dt><dd className="inline">{operator.privacyEmail}</dd></div>
            </dl>
          ) : (
            <p className="mb-0 mt-2 text-sm leading-6 text-[var(--cp-danger)]">
              当前部署尚未配置完整运营主体、统一社会信用代码、注册地址和有效联系方式，仅可用于开发与受控内测，不得据此对外商业上线。
            </p>
          )}
        </section>

        <article className="legal-document pt-10">{children}</article>
      </main>

      <LegalFooter />
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10 scroll-mt-24">
      <h2 className="mb-4 text-[20px] font-semibold leading-8 tracking-[0] text-[var(--cp-text)]">{title}</h2>
      <div className="space-y-4 text-[15px] leading-7 text-[var(--cp-text-soft)]">{children}</div>
    </section>
  );
}

export function LegalSourceList({ sources }: { sources: LegalSource[] }) {
  return (
    <ul className="space-y-3">
      {sources.map((source) => (
        <li key={source.href}>
          <a
            className="inline-flex items-start gap-1.5 underline decoration-[var(--cp-border-strong)] underline-offset-4 hover:text-[var(--cp-text)]"
            href={source.href}
            target="_blank"
            rel="noreferrer"
          >
            <span>{source.label}</span>
            <ExternalLink className="mt-1.5 size-3.5 shrink-0" strokeWidth={1.8} />
          </a>
        </li>
      ))}
    </ul>
  );
}

function LegalFooter() {
  return (
    <footer className="border-t border-[var(--cp-border-subtle)] px-5 py-8 text-sm text-[var(--cp-text-muted)]">
      <nav className="mx-auto flex max-w-[760px] flex-wrap items-center gap-x-5 gap-y-3" aria-label="法律文件">
        <Link className="hover:text-[var(--cp-text)]" href="/terms">
          使用条款
        </Link>
        <Link className="hover:text-[var(--cp-text)]" href="/privacy">
          隐私政策
        </Link>
        <Link className="hover:text-[var(--cp-text)]" href="/ai-notice">
          AI 使用说明
        </Link>
        <Link className="hover:text-[var(--cp-text)]" href="/legal-basis">
          合规依据
        </Link>
        <Link className="hover:text-[var(--cp-text)]" href="/subprocessors">
          第三方服务清单
        </Link>
      </nav>
    </footer>
  );
}
