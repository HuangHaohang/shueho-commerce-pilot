"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BarChart3,
  Building2,
  Check,
  Copy,
  Gauge,
  Loader2,
  MailPlus,
  ShieldCheck,
  Users,
  Workflow,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { EnterpriseOperations } from "@/components/enterprise/enterprise-operations";
import { cn } from "@/lib/utils";

type EnterpriseContract = {
  status: "pending" | "active" | "suspended" | "terminated";
  seatLimit: number;
  workspaceLimit: number;
  monthlyTotalTokenLimit: number | null;
  monthlyModelRequestLimit: number | null;
  concurrentTurnLimit: number;
  concurrentTurnLimitPerWorkspace: number;
  concurrentTurnLimitPerUser: number;
  tokenReservationPerTurn: number;
  maxAgentThreadsPerSession: number;
  billingAnchorDay: number;
};

type EnterpriseContextResponse = {
  tenant: {
    id: string;
    slug: string;
    name: string;
    status: "pending" | "active" | "suspended" | "terminated";
    edition: "enterprise";
  };
  workspace: {
    id: string;
    slug: string;
    name: string;
  };
  roleKeys: string[];
  permissions: string[];
  tenantPermissions: string[];
  contract: EnterpriseContract;
};

type EnterpriseInvitationSummary = {
  id: string;
  email: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  roleKeys: string[];
  expiresAt: string;
  createdAt: string;
};

type EnterpriseUsageResponse = {
  periodStart: string;
  workspaceId: string;
  scope: "tenant" | "workspace";
  modelRequests: number;
  missingUsageEvents: number;
  totalTokens: number;
  inputTokens: number;
  ordinaryInputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  cacheHitRatio: number;
  contract: {
    monthlyTotalTokenLimit: number | null;
    monthlyModelRequestLimit: number | null;
  };
};

const invitationSchema = z.object({
  email: z.string().trim().email("请输入有效的工作邮箱。").max(254, "邮箱地址过长。"),
  rolePreset: z.enum(["operator", "analyst", "viewer", "admin"]),
  expiresInDays: z.number().int().min(1).max(30),
});

type InvitationFormValues = z.infer<typeof invitationSchema>;

const rolePresets: Record<
  InvitationFormValues["rolePreset"],
  { label: string; description: string; roleKeys: string[] }
> = {
  operator: {
    label: "Agent 操作员",
    description: "可在当前工作区创建和管理自己的 Agent 任务。",
    roleKeys: ["tenant_member", "workspace_operator"],
  },
  analyst: {
    label: "工作区分析员",
    description: "只读查看工作区元数据和用量。",
    roleKeys: ["tenant_member", "workspace_analyst"],
  },
  viewer: {
    label: "工作区访客",
    description: "只读查看工作区元数据，不授予对话访问。",
    roleKeys: ["tenant_member", "workspace_viewer"],
  },
  admin: {
    label: "企业管理员",
    description: "管理成员、角色、工作区和用量治理。",
    roleKeys: ["tenant_admin", "workspace_owner"],
  },
};

const roleLabels: Record<string, string> = {
  tenant_owner: "企业所有者",
  tenant_admin: "企业管理员",
  tenant_member: "企业成员",
  analytics_viewer: "用量分析员",
  workspace_owner: "工作区所有者",
  workspace_operator: "Agent 操作员",
  workspace_analyst: "工作区分析员",
  workspace_viewer: "工作区访客",
};

const statusLabels: Record<EnterpriseContract["status"], string> = {
  pending: "待生效",
  active: "生效中",
  suspended: "已暂停",
  terminated: "已终止",
};

const fieldClassName =
  "mt-2 h-10 w-full rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 text-sm text-[var(--cp-text)] outline-none transition-[border-color,box-shadow] duration-[var(--cp-duration-fast)] placeholder:text-[var(--cp-text-faint)] focus:border-[var(--cp-border-strong)] focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)] focus-visible:ring-offset-2";

export function EnterpriseAdminDashboard() {
  const contextQuery = useQuery({
    queryKey: ["enterprise-context"],
    queryFn: getEnterpriseContext,
    retry: false,
    staleTime: 30_000,
  });
  const permissions = new Set(contextQuery.data?.permissions ?? []);
  const tenantPermissions = new Set(contextQuery.data?.tenantPermissions ?? []);
  const canReadUsage = permissions.has("usage.read");
  const canReadMembers = tenantPermissions.has("members.read");
  const canManageMembers = tenantPermissions.has("members.manage");
  const usageQuery = useQuery({
    queryKey: ["enterprise-usage", contextQuery.data?.workspace.id],
    queryFn: getEnterpriseUsage,
    enabled: contextQuery.isSuccess && canReadUsage,
    retry: 1,
    staleTime: 15_000,
  });

  return (
    <div className="flex min-h-dvh bg-[var(--cp-bg)] text-[var(--cp-text)] md:h-dvh md:overflow-hidden">
      <EnterpriseAdminSidebar tenantName={contextQuery.data?.tenant.name} />

      <main className="min-w-0 flex-1 md:h-dvh md:overflow-y-auto">
        <EnterpriseAdminMobileHeader />
        <div className="mx-auto w-full max-w-[var(--cp-content-max)] px-4 pb-20 pt-8 md:px-8 md:pb-24 md:pt-12">
          {contextQuery.isLoading ? <EnterpriseAdminSkeleton /> : null}
          {contextQuery.isError ? <EnterpriseContextError error={contextQuery.error} /> : null}
          {contextQuery.data ? (
            <>
              <EnterpriseOverview context={contextQuery.data} />
              <EnterpriseUsageSection
                canReadUsage={canReadUsage}
                usage={usageQuery.data}
                loading={usageQuery.isLoading}
                error={usageQuery.error}
                onRetry={() => void usageQuery.refetch()}
              />
              <EnterpriseOperations
                tenantPermissions={contextQuery.data.tenantPermissions}
                currentWorkspaceId={contextQuery.data.workspace.id}
                invitationSlot={
                  <EnterpriseInvitationSection
                    canReadMembers={canReadMembers}
                    canManageMembers={canManageMembers}
                    tenantName={contextQuery.data.tenant.name}
                    workspaceName={contextQuery.data.workspace.name}
                  />
                }
              />
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function EnterpriseAdminSidebar({ tenantName }: { tenantName?: string }) {
  const items = [
    { href: "#overview", label: "企业概览", icon: Building2 },
    { href: "#usage", label: "用量与额度", icon: BarChart3 },
    { href: "#workspaces", label: "工作区", icon: Workflow },
    { href: "#members", label: "企业成员", icon: Users },
    { href: "#invitations", label: "成员邀请", icon: MailPlus },
    { href: "#audit", label: "最近审计", icon: ShieldCheck },
  ];

  return (
    <aside className="hidden w-[var(--cp-sidebar-width)] shrink-0 flex-col border-r border-[var(--cp-border)] bg-[var(--cp-sidebar)] md:flex">
      <div className="flex h-[var(--cp-topbar-height)] items-center px-4">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2 rounded-[var(--cp-radius-item)] px-2 py-2 text-sm font-semibold hover:bg-[var(--cp-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
        >
          <ArrowLeft className="size-4 shrink-0" strokeWidth={1.8} />
          <span className="truncate">Commerce Pilot</span>
        </Link>
      </div>
      <div className="px-4 pb-5 pt-3">
        <p className="m-0 text-xs text-[var(--cp-text-faint)]">Enterprise</p>
        <p className="mb-0 mt-1 truncate text-sm font-medium text-[var(--cp-text)]">{tenantName || "企业管理"}</p>
      </div>
      <nav className="flex-1 space-y-1 px-2" aria-label="企业管理导航">
        {items.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="flex h-[var(--cp-sidebar-item-height)] items-center gap-3 rounded-[var(--cp-radius-item)] px-3 text-sm text-[var(--cp-text-soft)] transition-colors hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
          >
            <item.icon className="size-[var(--cp-sidebar-icon-size)]" strokeWidth={1.8} />
            {item.label}
          </a>
        ))}
      </nav>
      <div className="border-t border-[var(--cp-border-subtle)] p-3">
        <Link
          href="/enterprise"
          className="flex h-9 items-center rounded-[var(--cp-radius-item)] px-3 text-sm text-[var(--cp-text-muted)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
        >
          Enterprise 方案说明
        </Link>
      </div>
    </aside>
  );
}

function EnterpriseAdminMobileHeader() {
  return (
    <header className="sticky top-0 z-20 flex h-[var(--cp-topbar-height)] items-center justify-between border-b border-[var(--cp-border)] bg-[rgba(255,255,255,0.96)] px-4 md:hidden">
      <Link
        href="/"
        className="inline-flex h-9 items-center gap-2 rounded-[var(--cp-radius-item)] px-2 text-sm text-[var(--cp-text-soft)] hover:bg-[var(--cp-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
      >
        <ArrowLeft className="size-4" strokeWidth={1.8} />
        工作台
      </Link>
      <span className="text-sm font-semibold">Enterprise</span>
    </header>
  );
}

function EnterpriseOverview({ context }: { context: EnterpriseContextResponse }) {
  const contract = context.contract;
  const active = context.tenant.status === "active" && contract.status === "active";

  return (
    <section id="overview" className="scroll-mt-20" aria-labelledby="enterprise-overview-title">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--cp-border)] pb-7">
        <div>
          <p className="m-0 text-sm text-[var(--cp-text-muted)]">Enterprise 管理</p>
          <h1 id="enterprise-overview-title" className="mb-0 mt-2 text-[28px] font-semibold leading-tight">
            {context.tenant.name}
          </h1>
          <p className="mb-0 mt-3 text-sm text-[var(--cp-text-muted)]">当前工作区：{context.workspace.name}</p>
        </div>
        <span
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium",
            active
              ? "bg-[var(--cp-success-bg)] text-[var(--cp-success)]"
              : "bg-[var(--cp-warning-bg)] text-[var(--cp-warning)]",
          )}
        >
          {active ? <Check className="size-3.5" strokeWidth={2} /> : <ShieldCheck className="size-3.5" />}
          {active ? "企业合同生效中" : `合同${statusLabels[contract.status]}`}
        </span>
      </div>

      <dl className="m-0 border-b border-[var(--cp-border)]">
        <OverviewRow label="租户边界" value={`${context.tenant.slug} · ${context.tenant.edition}`} />
        <OverviewRow label="工作区" value={`${context.workspace.name} · ${context.workspace.slug}`} />
        <OverviewRow
          label="我的角色"
          value={context.roleKeys.map((role) => roleLabels[role] || role).join("、") || "未分配角色"}
        />
        <OverviewRow label="合同状态" value={statusLabels[contract.status]} />
      </dl>

      <div className="grid border-b border-[var(--cp-border)] sm:grid-cols-2 lg:grid-cols-4">
        <ContractMetric label="席位上限" value={`${formatInteger(contract.seatLimit)} 人`} />
        <ContractMetric label="工作区上限" value={`${formatInteger(contract.workspaceLimit)} 个`} />
        <ContractMetric label="租户并发" value={`${formatInteger(contract.concurrentTurnLimit)} 个任务`} />
        <ContractMetric label="单用户并发" value={`${formatInteger(contract.concurrentTurnLimitPerUser)} 个任务`} />
      </div>
      <p className="mb-0 mt-4 text-xs leading-5 text-[var(--cp-text-faint)]">
        当前工作区并发上限为 {formatInteger(contract.concurrentTurnLimitPerWorkspace)}；每个根任务最多使用 {formatInteger(contract.maxAgentThreadsPerSession)} 个 Codex agent 线程；临界额度会为每个在途任务预留 {formatInteger(contract.tokenReservationPerTurn)} tokens。租户与工作区标识只用于服务端归属校验，页面不展示运行凭据。
      </p>
    </section>
  );
}

function OverviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-t border-[var(--cp-border-subtle)] py-4 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-6">
      <dt className="text-sm text-[var(--cp-text-muted)]">{label}</dt>
      <dd className="m-0 break-words text-sm text-[var(--cp-text)]">{value}</dd>
    </div>
  );
}

function ContractMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-[var(--cp-border-subtle)] py-5 sm:border-b-0 sm:border-r sm:px-5 first:pl-0 last:border-r-0 last:pr-0">
      <div className="text-xs text-[var(--cp-text-muted)]">{label}</div>
      <div className="mt-2 text-[17px] font-medium text-[var(--cp-text)]">{value}</div>
    </div>
  );
}

function EnterpriseUsageSection({
  canReadUsage,
  usage,
  loading,
  error,
  onRetry,
}: {
  canReadUsage: boolean;
  usage?: EnterpriseUsageResponse;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <section id="usage" className="scroll-mt-20 border-b border-[var(--cp-border)] py-12" aria-labelledby="usage-title">
      <SectionHeading
        id="usage-title"
        icon={BarChart3}
        title="Codex 用量与额度"
        description={
          usage?.scope === "tenant"
            ? "按企业租户和合同账期汇总 App Server 上报的 provider completion 用量。"
            : "按当前工作区和合同账期汇总 App Server 上报的 provider completion 用量。"
        }
      />

      {!canReadUsage ? (
        <PermissionNotice>当前角色没有查看工作区用量的权限。</PermissionNotice>
      ) : null}
      {canReadUsage && loading ? <UsageSkeleton /> : null}
      {canReadUsage && error ? (
        <InlineError message={getErrorMessage(error, "暂时无法读取用量。") } onRetry={onRetry} />
      ) : null}
      {canReadUsage && usage ? <UsageSummary usage={usage} /> : null}
    </section>
  );
}

function UsageSummary({ usage }: { usage: EnterpriseUsageResponse }) {
  return (
    <div className="mt-8">
      <p className="m-0 text-xs text-[var(--cp-text-faint)]">
        {usage.scope === "tenant" ? "企业租户" : "当前工作区"}账期自 {formatDate(usage.periodStart)} 起
      </p>

      <div className="mt-5 grid gap-6 sm:grid-cols-2">
        <QuotaMeter
          label="总 Token"
          used={usage.totalTokens}
          limit={usage.contract.monthlyTotalTokenLimit}
          unit="tokens"
        />
        <QuotaMeter
          label="模型请求"
          used={usage.modelRequests}
          limit={usage.contract.monthlyModelRequestLimit}
          unit="次"
        />
      </div>

      <div className="mt-8 grid border-y border-[var(--cp-border)] sm:grid-cols-2 lg:grid-cols-4">
        <UsageMetric label="输入 Token" value={usage.inputTokens} />
        <UsageMetric label="缓存命中输入" value={usage.cachedInputTokens} />
        <UsageMetric label="缓存写入输入" value={usage.cacheWriteInputTokens} />
        <UsageMetric label="输出 Token" value={usage.outputTokens} />
      </div>

      <dl className="m-0 mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        <CompactUsageRow label="普通输入" value={formatInteger(usage.ordinaryInputTokens)} />
        <CompactUsageRow label="缓存命中率" value={formatPercent(usage.cacheHitRatio)} />
        <CompactUsageRow label="推理输出" value={formatInteger(usage.reasoningOutputTokens)} />
        <CompactUsageRow label="模型完成次数" value={formatInteger(usage.modelRequests)} />
      </dl>

      <div className="mt-7 flex items-start gap-3 border-y border-[var(--cp-border-subtle)] bg-[var(--cp-bg-subtle)] px-4 py-3 text-xs leading-5 text-[var(--cp-text-muted)]">
        <Gauge className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} />
        <p className="m-0">
          缓存命中输入与缓存写入输入都属于输入 Token 的分类；推理输出属于输出 Token。缓存命中率按缓存命中输入 ÷ 输入 Token 计算，不代表请求成功率。
        </p>
      </div>
      {usage.missingUsageEvents > 0 ? (
        <p className="mb-0 mt-4 text-xs leading-5 text-[var(--cp-warning)]">
          本账期有 {formatInteger(usage.missingUsageEvents)} 次外部 provider 调用未返回 token 明细；请求次数已计入，token 显示为未知并需要账单对账，系统不会把它解释为免费调用。
        </p>
      ) : null}
    </div>
  );
}

function QuotaMeter({
  label,
  used,
  limit,
  unit,
}: {
  label: string;
  used: number;
  limit: number | null;
  unit: string;
}) {
  const ratio = limit && limit > 0 ? Math.min(1, used / limit) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-[var(--cp-text-muted)]">
          {formatInteger(used)} / {limit === null ? "未设硬上限" : `${formatInteger(limit)} ${unit}`}
        </span>
      </div>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--cp-bg-muted)]"
        role="progressbar"
        aria-label={`${label}额度使用`}
        aria-valuemin={0}
        aria-valuemax={limit ?? undefined}
        aria-valuenow={limit === null ? undefined : used}
      >
        <div className="h-full rounded-full bg-[var(--cp-text-muted)]" style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

function UsageMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-b border-[var(--cp-border-subtle)] py-5 sm:border-r sm:px-5 sm:[&:nth-child(2)]:border-r-0 lg:border-b-0 lg:[&:nth-child(2)]:border-r lg:last:border-r-0 first:pl-0 last:pr-0">
      <div className="text-xs text-[var(--cp-text-muted)]">{label}</div>
      <div className="mt-2 text-lg font-medium tabular-nums">{formatInteger(value)}</div>
    </div>
  );
}

function CompactUsageRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--cp-border-subtle)] pb-3">
      <dt className="text-sm text-[var(--cp-text-muted)]">{label}</dt>
      <dd className="m-0 text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function EnterpriseInvitationSection({
  canReadMembers,
  canManageMembers,
  tenantName,
  workspaceName,
}: {
  canReadMembers: boolean;
  canManageMembers: boolean;
  tenantName: string;
  workspaceName: string;
}) {
  const queryClient = useQueryClient();
  const invitationsQuery = useQuery({
    queryKey: ["enterprise-invitations"],
    queryFn: getEnterpriseInvitations,
    enabled: canReadMembers,
    retry: 1,
    staleTime: 15_000,
  });
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeConfirmationId, setRevokeConfirmationId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [invitation, setInvitation] = useState<{
    email: string;
    roleLabel: string;
    inviteUrl: string;
    expiresAt: string;
  } | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    watch,
    formState: { errors },
  } = useForm<InvitationFormValues>({
    defaultValues: { email: "", rolePreset: "operator", expiresInDays: 7 },
  });
  const rolePreset = watch("rolePreset");

  async function createInvitation(values: InvitationFormValues) {
    clearErrors();
    setRequestError(null);
    setCopyState("idle");
    const parsed = invitationSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "email" || field === "rolePreset" || field === "expiresInDays") {
          setError(field, { type: "validation", message: issue.message });
        }
      }
      return;
    }

    setSubmitting(true);
    try {
      const preset = rolePresets[parsed.data.rolePreset];
      const response = await fetch("/api/enterprise/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: parsed.data.email,
          roleKeys: preset.roleKeys,
          expiresInDays: parsed.data.expiresInDays,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { invitation?: { inviteUrl: string; expiresAt: string }; error?: string }
        | null;
      if (!response.ok || !payload?.invitation) {
        throw new Error(payload?.error || "无法创建企业邀请。");
      }
      setInvitation({
        email: parsed.data.email.trim().toLowerCase(),
        roleLabel: preset.label,
        inviteUrl: payload.invitation.inviteUrl,
        expiresAt: payload.invitation.expiresAt,
      });
      await Promise.all([
        invitationsQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["enterprise-audit"] }),
      ]);
    } catch (error) {
      setRequestError(getErrorMessage(error, "无法创建企业邀请。"));
    } finally {
      setSubmitting(false);
    }
  }

  async function revokeInvitation(invitationId: string) {
    setRevokingId(invitationId);
    setRevokeError(null);
    try {
      const response = await fetch(`/api/enterprise/invitations/${encodeURIComponent(invitationId)}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "无法撤销企业邀请。");
      setRevokeConfirmationId(null);
      await Promise.all([
        invitationsQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["enterprise-audit"] }),
      ]);
    } catch (error) {
      setRevokeError(getErrorMessage(error, "无法撤销企业邀请。"));
    } finally {
      setRevokingId(null);
    }
  }

  async function copyInvitationUrl() {
    if (!invitation) return;
    try {
      await navigator.clipboard.writeText(invitation.inviteUrl);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section id="invitations" className="scroll-mt-20 border-b border-[var(--cp-border)] py-12" aria-labelledby="invitations-title">
      <SectionHeading
        id="invitations-title"
        icon={MailPlus}
        title="邀请企业成员"
        description={`邀请成员加入 ${tenantName} 的 ${workspaceName}。邀请与指定工作邮箱绑定。`}
      />

      {!canReadMembers ? (
        <PermissionNotice>当前角色没有读取企业邀请的权限。</PermissionNotice>
      ) : null}
      {canReadMembers && invitationsQuery.isLoading ? (
        <p className="mb-0 mt-7 text-sm text-[var(--cp-text-muted)]">正在读取待处理邀请…</p>
      ) : null}
      {canReadMembers && invitationsQuery.isError ? (
        <InlineError
          message={getErrorMessage(invitationsQuery.error, "无法读取企业邀请。")}
          onRetry={() => void invitationsQuery.refetch()}
        />
      ) : null}
      {canReadMembers && invitationsQuery.data ? (
        <div className="mt-7">
          <p className="m-0 text-xs text-[var(--cp-text-muted)]">
            {invitationsQuery.data.invitations.filter((item) => item.status === "pending").length} 个待处理邀请
          </p>
          {invitationsQuery.data.invitations.some((item) => item.status === "pending") ? (
            <ul className="m-0 mt-3 list-none divide-y divide-[var(--cp-border-subtle)] border-y border-[var(--cp-border)] p-0">
              {invitationsQuery.data.invitations
                .filter((item) => item.status === "pending")
                .map((item) => (
                  <li key={item.id} className="py-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="m-0 break-all text-sm font-medium">{item.email}</p>
                        <p className="mb-0 mt-1 text-xs leading-5 text-[var(--cp-text-muted)]">
                          {item.roleKeys.map((role) => roleLabels[role] || role).join("、")} · {formatDateTime(item.expiresAt)} 到期
                        </p>
                      </div>
                      {canManageMembers ? (
                        revokeConfirmationId === item.id ? (
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={revokingId === item.id}
                              onClick={() => setRevokeConfirmationId(null)}
                            >
                              取消
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              disabled={revokingId === item.id}
                              onClick={() => void revokeInvitation(item.id)}
                            >
                              {revokingId === item.id ? <Loader2 className="animate-spin" /> : <X />}
                              确认撤销
                            </Button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-[var(--cp-danger)] hover:text-[var(--cp-danger)]"
                            onClick={() => {
                              setRevokeError(null);
                              setRevokeConfirmationId(item.id);
                            }}
                          >
                            撤销
                          </Button>
                        )
                      ) : null}
                    </div>
                    {revokeError && revokeConfirmationId === item.id ? (
                      <p role="alert" className="mb-0 mt-2 text-xs text-[var(--cp-danger)]">{revokeError}</p>
                    ) : null}
                  </li>
                ))}
            </ul>
          ) : (
            <p className="mb-0 mt-3 border-y border-[var(--cp-border-subtle)] py-4 text-sm text-[var(--cp-text-muted)]">
              当前没有待处理邀请。
            </p>
          )}
        </div>
      ) : null}

      {!canManageMembers && canReadMembers ? (
        <PermissionNotice>当前角色没有邀请企业成员的权限。</PermissionNotice>
      ) : null}
      {canManageMembers ? (
        <form className="mt-8" noValidate onSubmit={handleSubmit(createInvitation)}>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="工作邮箱" error={errors.email?.message} errorId="invite-email-error">
              <input
                {...register("email")}
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="name@company.com"
                className={fieldClassName}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? "invite-email-error" : undefined}
              />
            </FormField>
            <FormField label="邀请有效期" error={errors.expiresInDays?.message} errorId="invite-expiry-error">
              <select
                {...register("expiresInDays", { valueAsNumber: true })}
                className={fieldClassName}
                aria-invalid={Boolean(errors.expiresInDays)}
                aria-describedby={errors.expiresInDays ? "invite-expiry-error" : undefined}
              >
                <option value={7}>7 天</option>
                <option value={14}>14 天</option>
                <option value={30}>30 天</option>
              </select>
            </FormField>
          </div>

          <fieldset className="mt-6 border-0 p-0">
            <legend className="text-sm font-medium text-[var(--cp-text-soft)]">成员角色</legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {(Object.entries(rolePresets) as Array<
                [InvitationFormValues["rolePreset"], (typeof rolePresets)[InvitationFormValues["rolePreset"]]]
              >).map(([value, preset]) => (
                <label
                  key={value}
                  className={cn(
                    "flex cursor-pointer gap-3 rounded-[var(--cp-radius-item)] border px-3.5 py-3 transition-colors",
                    rolePreset === value
                      ? "border-[var(--cp-border-strong)] bg-[var(--cp-bg-subtle)]"
                      : "border-[var(--cp-border-subtle)] hover:bg-[var(--cp-bg-subtle)]",
                  )}
                >
                  <input
                    {...register("rolePreset")}
                    type="radio"
                    value={value}
                    className="mt-1 size-4 accent-[var(--cp-text)]"
                  />
                  <span>
                    <span className="block text-sm font-medium">{preset.label}</span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--cp-text-muted)]">
                      {preset.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {requestError ? (
            <p role="alert" className="mb-0 mt-5 text-sm text-[var(--cp-danger)]">
              {requestError}
            </p>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : <MailPlus />}
              {submitting ? "正在创建" : "创建邀请"}
            </Button>
            <span className="text-xs leading-5 text-[var(--cp-text-faint)]">系统不会自动发送邮件；请安全地转交一次性链接。</span>
          </div>
        </form>
      ) : null}

      {invitation ? (
        <div className="mt-8 border-y border-[var(--cp-border)] bg-[var(--cp-bg-subtle)] px-4 py-4" aria-live="polite">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="m-0 text-sm font-medium">邀请已创建</p>
              <p className="mb-0 mt-1 text-xs leading-5 text-[var(--cp-text-muted)]">
                {invitation.email} · {invitation.roleLabel} · {formatDateTime(invitation.expiresAt)} 到期
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="清除邀请链接"
              onClick={() => {
                setInvitation(null);
                setCopyState("idle");
              }}
            >
              <X />
            </Button>
          </div>
          <div className="mt-4 flex min-w-0 gap-2">
            <input
              readOnly
              value={invitation.inviteUrl}
              aria-label="一次性企业邀请链接"
              className="h-10 min-w-0 flex-1 rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 font-mono text-xs text-[var(--cp-text-soft)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button type="button" variant="outline" onClick={copyInvitationUrl}>
              <Copy />
              复制
            </Button>
          </div>
          <p className="mb-0 mt-3 text-xs leading-5 text-[var(--cp-text-muted)]" role="status">
            {copyState === "copied"
              ? "链接已复制。"
              : copyState === "failed"
                ? "无法自动复制，请选中链接后手动复制。"
                : "链接仅在创建响应中返回；接收人必须用被邀请邮箱登录。"}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function SectionHeading({
  id,
  icon: Icon,
  title,
  description,
}: {
  id: string;
  icon: typeof Workflow;
  title: string;
  description: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-8">
      <h2 className="m-0 flex items-center gap-2 text-[19px] font-semibold" id={id}>
        <Icon className="size-4.5 text-[var(--cp-text-muted)]" strokeWidth={1.8} />
        {title}
      </h2>
      <p className="m-0 max-w-[520px] text-sm leading-6 text-[var(--cp-text-muted)]">{description}</p>
    </div>
  );
}

function FormField({
  label,
  error,
  errorId,
  children,
}: {
  label: string;
  error?: string;
  errorId: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm font-medium text-[var(--cp-text-soft)]">
      {label}
      {children}
      {error ? (
        <span id={errorId} className="mt-1.5 block text-xs font-normal text-[var(--cp-danger)]">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function PermissionNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-7 border-y border-[var(--cp-border-subtle)] bg-[var(--cp-bg-subtle)] px-4 py-3 text-sm text-[var(--cp-text-muted)]">
      {children}
    </div>
  );
}

function EnterpriseContextError({ error }: { error: unknown }) {
  const unauthenticated = error instanceof ApiRequestError && error.status === 401;
  return (
    <section className="border-y border-[var(--cp-border)] py-10" aria-labelledby="enterprise-context-error-title">
      <ShieldCheck className="size-5 text-[var(--cp-text-muted)]" strokeWidth={1.8} />
      <h1 id="enterprise-context-error-title" className="mb-0 mt-4 text-[22px] font-semibold">
        {unauthenticated ? "请先登录企业账号" : "无法打开企业管理"}
      </h1>
      <p className="mb-0 mt-3 max-w-[560px] text-sm leading-6 text-[var(--cp-text-muted)]">
        {getErrorMessage(error, "当前账号没有可用的企业租户或工作区。")}
      </p>
      <Button asChild className="mt-6">
        <Link href="/">返回工作台{unauthenticated ? "登录" : ""}</Link>
      </Button>
    </section>
  );
}

function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-y border-[var(--cp-border)] py-4">
      <p className="m-0 text-sm text-[var(--cp-danger)]">{message}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        重新读取
      </Button>
    </div>
  );
}

function EnterpriseAdminSkeleton() {
  return (
    <div className="animate-pulse" aria-label="正在加载企业管理信息">
      <div className="h-4 w-24 rounded bg-[var(--cp-bg-muted)]" />
      <div className="mt-4 h-8 w-56 rounded bg-[var(--cp-bg-muted)]" />
      <div className="mt-10 space-y-4 border-y border-[var(--cp-border)] py-6">
        <div className="h-4 w-full rounded bg-[var(--cp-bg-muted)]" />
        <div className="h-4 w-4/5 rounded bg-[var(--cp-bg-muted)]" />
        <div className="h-4 w-3/5 rounded bg-[var(--cp-bg-muted)]" />
      </div>
    </div>
  );
}

function UsageSkeleton() {
  return (
    <div className="mt-8 grid animate-pulse gap-6 sm:grid-cols-2" aria-label="正在加载用量">
      <div className="h-14 rounded bg-[var(--cp-bg-muted)]" />
      <div className="h-14 rounded bg-[var(--cp-bg-muted)]" />
    </div>
  );
}

class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function getEnterpriseContext(): Promise<EnterpriseContextResponse> {
  const response = await fetch("/api/enterprise/context", { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as EnterpriseContextResponse | { error?: string } | null;
  if (!response.ok) {
    throw new ApiRequestError(
      payload && "error" in payload && payload.error ? payload.error : "无法读取企业上下文。",
      response.status,
    );
  }
  return payload as EnterpriseContextResponse;
}

async function getEnterpriseUsage(): Promise<EnterpriseUsageResponse> {
  const response = await fetch("/api/enterprise/usage", { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as EnterpriseUsageResponse | { error?: string } | null;
  if (!response.ok) {
    throw new ApiRequestError(
      payload && "error" in payload && payload.error ? payload.error : "无法读取企业用量。",
      response.status,
    );
  }
  return payload as EnterpriseUsageResponse;
}

async function getEnterpriseInvitations(): Promise<{ invitations: EnterpriseInvitationSummary[] }> {
  const response = await fetch("/api/enterprise/invitations", { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as
    | { invitations: EnterpriseInvitationSummary[] }
    | { error?: string }
    | null;
  if (!response.ok) {
    throw new ApiRequestError(
      payload && "error" in payload && payload.error ? payload.error : "无法读取企业邀请。",
      response.status,
    );
  }
  return payload as { invitations: EnterpriseInvitationSummary[] };
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
