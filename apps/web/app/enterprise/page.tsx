import type { Metadata } from "next";
import { ArrowLeft, Check } from "lucide-react";
import Link from "next/link";

import { EnterpriseContactForm } from "@/components/enterprise/enterprise-contact-form";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Enterprise | Commerce Pilot",
  description: "了解 Commerce Pilot Enterprise 的独立租户、工作区权限、用量治理、安全隔离、并发与审计边界。",
};

const enterpriseCapabilities = [
  {
    title: "独立租户",
    description: "按组织划分身份、线程、数据、配置与运行状态边界，避免不同客户之间共享业务上下文。",
  },
  {
    title: "工作区与 RBAC",
    description: "围绕工作区分配成员、角色和资源范围，让查看、审批与执行权限保持清晰。",
  },
  {
    title: "用量治理",
    description: "按工作区约束模型、工具、额度与任务时长，并提供可解释的用量口径和治理策略。",
  },
  {
    title: "安全隔离",
    description: "以拒绝优先的运行策略、受控工具边界和独立运行资源承接生产电商数据。",
  },
  {
    title: "并发策略",
    description: "针对团队规模和任务类型规划并发、排队与限流，避免高峰任务互相挤占。",
  },
  {
    title: "审计记录",
    description: "记录任务、审批、目标对象、执行结果与读回证据，为复核和问题追踪保留依据。",
  },
];

const operatingBoundaries = [
  "租户、用户与工作区共同决定资源归属，不能只依赖浏览器状态。",
  "高影响电商动作需要明确审批范围，写入完成后仍要读取目标系统验证结果。",
  "并发、模型与工具权限按组织策略治理，并留下可供复核的审计事件。",
];

export default function EnterprisePage() {
  return (
    <div className="min-h-dvh bg-[var(--cp-bg)] text-[var(--cp-text)]">
      <header className="sticky top-0 z-20 border-b border-[var(--cp-border-subtle)] bg-[rgba(255,255,255,0.94)] backdrop-blur-md">
        <div className="mx-auto flex h-[var(--cp-topbar-height)] max-w-[960px] items-center justify-between px-4 md:px-8">
          <Link
            href="/"
            className="inline-flex h-9 items-center gap-2 rounded-[var(--cp-radius-item)] px-2 text-sm text-[var(--cp-text-soft)] transition-colors hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
          >
            <ArrowLeft className="size-4" strokeWidth={1.8} />
            返回工作台
          </Link>
          <span className="text-sm font-semibold">Enterprise</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[900px] px-5 pb-24 md:px-8">
        <section className="border-b border-[var(--cp-border)] pb-14 pt-14 md:pb-16 md:pt-20">
          <p className="m-0 text-sm font-medium text-[var(--cp-text-muted)]">Commerce Pilot Enterprise</p>
          <h1 className="mb-0 mt-4 max-w-[760px] text-[34px] font-semibold leading-[1.2] md:text-[40px]">
            为组织级电商 Agent 建立清晰的运行边界
          </h1>
          <p className="mb-0 mt-6 max-w-[700px] text-[15px] leading-7 text-[var(--cp-text-muted)]">
            Enterprise 面向需要独立租户、工作区权限、用量治理和审计能力的团队。实际部署范围会根据组织结构、并发规模与安全要求共同确认。
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-3">
            <Button asChild size="lg" className="rounded-full">
              <a href="#contact-sales">联系销售团队</a>
            </Button>
            <span className="text-xs leading-5 text-[var(--cp-text-faint)]">当前尚未接入销售 CRM，页面不会伪造提交成功。</span>
          </div>
        </section>

        <section className="py-14 md:py-16" aria-labelledby="enterprise-capabilities-title">
          <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)] md:gap-10">
            <h2 id="enterprise-capabilities-title" className="m-0 text-[22px] font-semibold leading-8">
              组织级能力边界
            </h2>
            <p className="m-0 max-w-[600px] text-[15px] leading-7 text-[var(--cp-text-muted)]">
              这些能力用于约束 Agent 如何访问上下文、消耗资源和执行工作，不以装饰性功能替代真实治理。
            </p>
          </div>

          <dl className="mb-0 mt-10 border-y border-[var(--cp-border)]">
            {enterpriseCapabilities.map((capability) => (
              <div
                key={capability.title}
                className="grid gap-2 border-b border-[var(--cp-border-subtle)] py-6 last:border-b-0 md:grid-cols-[220px_minmax(0,1fr)] md:gap-10"
              >
                <dt className="text-[15px] font-medium text-[var(--cp-text)]">{capability.title}</dt>
                <dd className="m-0 max-w-[620px] text-[15px] leading-7 text-[var(--cp-text-muted)]">
                  {capability.description}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="border-y border-[var(--cp-border)] py-12" aria-labelledby="enterprise-governance-title">
          <div className="grid gap-8 md:grid-cols-[300px_minmax(0,1fr)] md:gap-12">
            <div>
              <h2 id="enterprise-governance-title" className="m-0 text-[22px] font-semibold leading-8">
                治理从归属和证据开始
              </h2>
              <p className="mb-0 mt-4 text-sm leading-6 text-[var(--cp-text-muted)]">
                接洽阶段会先确认组织边界和风险要求，再确定部署与容量方案。
              </p>
            </div>
            <ul className="m-0 space-y-5 p-0">
              {operatingBoundaries.map((boundary) => (
                <li key={boundary} className="flex items-start gap-3 text-[15px] leading-7 text-[var(--cp-text-soft)]">
                  <Check className="mt-1.5 size-4 shrink-0 text-[var(--cp-text-muted)]" strokeWidth={1.8} />
                  <span>{boundary}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="contact-sales" className="scroll-mt-24 py-14 md:py-16" aria-labelledby="contact-sales-title">
          <div className="grid gap-10 md:grid-cols-[280px_minmax(0,1fr)] md:gap-14">
            <div>
              <h2 id="contact-sales-title" className="m-0 text-[24px] font-semibold leading-8">
                联系销售团队
              </h2>
              <p className="mb-0 mt-4 text-[15px] leading-7 text-[var(--cp-text-muted)]">
                提供组织规模和优先治理需求，可用于后续接入销售渠道时确认方案范围。
              </p>
              <p className="mb-0 mt-5 text-xs leading-5 text-[var(--cp-text-faint)]">
                当前未配置销售邮箱、公司主体或 CRM 接口，因此不会展示虚构联系方式。
              </p>
            </div>
            <EnterpriseContactForm />
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--cp-border-subtle)] px-5 py-8 text-sm text-[var(--cp-text-muted)]">
        <div className="mx-auto flex max-w-[900px] flex-wrap items-center gap-x-5 gap-y-3 md:px-3">
          <Link href="/" className="hover:text-[var(--cp-text)]">
            返回工作台
          </Link>
          <Link href="/terms" className="hover:text-[var(--cp-text)]">
            使用条款
          </Link>
          <Link href="/privacy" className="hover:text-[var(--cp-text)]">
            隐私政策
          </Link>
        </div>
      </footer>
    </div>
  );
}
