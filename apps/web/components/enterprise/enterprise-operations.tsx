"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Check,
  Loader2,
  Plus,
  RotateCcw,
  ScrollText,
  ShieldAlert,
  UserRoundCheck,
  UserRoundX,
  Users,
} from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type WorkspaceSummary = {
  id: string;
  slug: string;
  name: string;
  status: "active" | "archived";
  isDefault: boolean;
  memberCount: number;
  isMember: boolean;
};

type EnterpriseMember = {
  userId: string;
  name: string;
  email: string;
  status: "invited" | "active" | "suspended" | "removed";
  joinedAt: string | null;
  roleKeys: string[];
  workspaces: Array<{ id: string; name: string; status: string }>;
};

type AuditEvent = {
  id: string;
  workspaceId: string | null;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  outcome: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type AuthSession = { user: { id: string } | null };

const workspaceSchema = z.object({
  name: z.string().trim().min(1, "请输入工作区名称。").max(80, "名称不能超过 80 个字符。"),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "请输入 2–63 位小写字母、数字或连字符。"),
});

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

const memberStatusLabels: Record<EnterpriseMember["status"], string> = {
  invited: "待加入",
  active: "使用中",
  suspended: "已暂停",
  removed: "已移除",
};

const auditActionLabels: Record<string, string> = {
  "workspace.create": "创建工作区",
  "workspace.status.change": "变更工作区状态",
  "membership.invite": "创建成员邀请",
  "membership.invite.revoke": "撤销成员邀请",
  "membership.invite.accept": "接受成员邀请",
  "membership.status.change": "变更成员状态",
  "quota.denied": "额度门禁拒绝",
  "agent.turn.reserve": "任务额度门禁",
  "api.rate_limit": "接口限流门禁",
};

const fieldClassName =
  "h-10 w-full rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 text-sm text-[var(--cp-text)] outline-none transition-[border-color,box-shadow] duration-[var(--cp-duration-fast)] placeholder:text-[var(--cp-text-faint)] focus:border-[var(--cp-border-strong)] focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)] focus-visible:ring-offset-2";

export function EnterpriseOperations({
  tenantPermissions,
  currentWorkspaceId,
  invitationSlot,
}: {
  tenantPermissions: string[];
  currentWorkspaceId: string;
  invitationSlot?: React.ReactNode;
}) {
  const permissions = new Set(tenantPermissions);
  return (
    <>
      <WorkspaceSection
        canRead={permissions.has("workspaces.read")}
        canManage={permissions.has("workspaces.manage")}
        currentWorkspaceId={currentWorkspaceId}
      />
      <MemberSection
        canRead={permissions.has("members.read")}
        canManage={permissions.has("members.manage")}
      />
      {invitationSlot}
      <AuditSection canRead={permissions.has("audit.read")} />
    </>
  );
}

function WorkspaceSection({
  canRead,
  canManage,
  currentWorkspaceId,
}: {
  canRead: boolean;
  canManage: boolean;
  currentWorkspaceId: string;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["enterprise-workspaces"],
    queryFn: getWorkspaces,
    enabled: canRead,
    retry: 1,
    staleTime: 20_000,
  });
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const membersQuery = useQuery({
    queryKey: ["enterprise-members"],
    queryFn: getMembers,
    enabled: canManage,
    retry: 1,
    staleTime: 15_000,
  });
  const [memberWorkspaceId, setMemberWorkspaceId] = useState("");
  const [memberUserId, setMemberUserId] = useState("");
  const [memberRoleKey, setMemberRoleKey] = useState("workspace_operator");
  const [assigningMember, setAssigningMember] = useState(false);

  async function assignWorkspaceMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!memberWorkspaceId || !memberUserId) {
      setFormError("请选择工作区和企业成员。");
      return;
    }
    setAssigningMember(true);
    setFormError(null);
    try {
      await requestJson(`/api/enterprise/workspaces/${encodeURIComponent(memberWorkspaceId)}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: memberUserId, roleKeys: [memberRoleKey] }),
      });
      await Promise.all([
        query.refetch(),
        membersQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["enterprise-audit"] }),
      ]);
    } catch (error) {
      setFormError(getErrorMessage(error, "无法更新工作区成员授权。"));
    } finally {
      setAssigningMember(false);
    }
  }

  async function selectWorkspace(workspaceId: string) {
    setSelectingId(workspaceId);
    setFormError(null);
    try {
      await requestJson("/api/enterprise/workspaces/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      window.location.assign("/");
    } catch (error) {
      setFormError(getErrorMessage(error, "无法切换工作区。"));
      setSelectingId(null);
    }
  }

  async function createWorkspace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreated(false);
    const parsed = workspaceSchema.safeParse({ name, slug });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message || "工作区信息格式不正确。");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await requestJson("/api/enterprise/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      setName("");
      setSlug("");
      setCreated(true);
      await Promise.all([
        query.refetch(),
        queryClient.invalidateQueries({ queryKey: ["enterprise-audit"] }),
      ]);
    } catch (error) {
      setFormError(getErrorMessage(error, "无法创建工作区。"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section id="workspaces" className="scroll-mt-20 border-b border-[var(--cp-border)] py-12" aria-labelledby="workspaces-title">
      <OperationsHeading
        id="workspaces-title"
        icon={Building2}
        title="工作区"
        description="工作区是企业内的项目与数据边界；新工作区会先只授予创建人所有者权限。"
      />

      {!canRead ? <PermissionNotice>当前角色没有读取企业工作区的权限。</PermissionNotice> : null}
      {canRead && query.isLoading ? <RowsSkeleton label="正在加载工作区" /> : null}
      {canRead && query.isError ? (
        <InlineError message={getErrorMessage(query.error, "无法读取工作区。") } onRetry={() => void query.refetch()} />
      ) : null}
      {canRead && query.data ? (
        <div className="mt-7">
          <div className="flex items-center justify-between gap-4 text-xs text-[var(--cp-text-muted)]">
            <span>{query.data.workspaces.filter((workspace) => workspace.status === "active").length} 个使用中</span>
            <span>合同上限 {query.data.workspaceLimit} 个</span>
          </div>
          <ul className="m-0 mt-3 list-none divide-y divide-[var(--cp-border-subtle)] border-y border-[var(--cp-border)] p-0">
            {query.data.workspaces.map((workspace) => (
              <li key={workspace.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{workspace.name}</span>
                    {workspace.isDefault ? <StatusPill>默认</StatusPill> : null}
                    {workspace.id === currentWorkspaceId ? <StatusPill>当前</StatusPill> : null}
                    {workspace.status === "archived" ? <StatusPill tone="muted">已归档</StatusPill> : null}
                  </div>
                  <p className="mb-0 mt-1 text-xs text-[var(--cp-text-muted)]">
                    {workspace.slug} · {workspace.memberCount} 名活跃成员
                  </p>
                </div>
                {workspace.status === "active" && workspace.isMember && workspace.id !== currentWorkspaceId ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={selectingId !== null}
                    onClick={() => void selectWorkspace(workspace.id)}
                  >
                    {selectingId === workspace.id ? <Loader2 className="animate-spin" /> : null}
                    进入工作区
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canManage ? (
        <form className="mt-8 border-t border-[var(--cp-border-subtle)] pt-6" onSubmit={createWorkspace} noValidate>
          <p className="m-0 text-sm font-medium">创建工作区</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <label>
              <span className="sr-only">工作区名称</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={fieldClassName}
                placeholder="工作区名称"
                maxLength={80}
              />
            </label>
            <label>
              <span className="sr-only">工作区标识</span>
              <input
                value={slug}
                onChange={(event) => setSlug(event.target.value.toLowerCase())}
                className={fieldClassName}
                placeholder="workspace-slug"
                maxLength={63}
              />
            </label>
            <Button type="submit" disabled={submitting} className="h-10">
              {submitting ? <Loader2 className="animate-spin" /> : <Plus />}
              创建
            </Button>
          </div>
          <div className="mt-2 min-h-5 text-xs" aria-live="polite">
            {formError ? <span className="text-[var(--cp-danger)]">{formError}</span> : null}
            {created ? <span className="text-[var(--cp-success)]">工作区已创建并完成权限读回。</span> : null}
            {!formError && !created ? <span className="text-[var(--cp-text-faint)]">标识创建后不可修改，请使用稳定的英文业务名称。</span> : null}
          </div>
        </form>
      ) : null}
      {canManage && query.data && membersQuery.data ? (
        <form className="mt-6 border-t border-[var(--cp-border-subtle)] pt-6" onSubmit={assignWorkspaceMember}>
          <p className="m-0 text-sm font-medium">添加成员或更新工作区角色</p>
          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <select className={fieldClassName} value={memberWorkspaceId} onChange={(event) => setMemberWorkspaceId(event.target.value)}>
              <option value="">选择工作区</option>
              {query.data.workspaces.filter((workspace) => workspace.status === "active").map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
              ))}
            </select>
            <select className={fieldClassName} value={memberUserId} onChange={(event) => setMemberUserId(event.target.value)}>
              <option value="">选择企业成员</option>
              {membersQuery.data.members.filter((member) => member.status === "active").map((member) => (
                <option key={member.userId} value={member.userId}>{member.name || member.email}</option>
              ))}
            </select>
            <select className={fieldClassName} value={memberRoleKey} onChange={(event) => setMemberRoleKey(event.target.value)}>
              <option value="workspace_operator">Agent 操作员</option>
              <option value="workspace_analyst">工作区分析员</option>
              <option value="workspace_viewer">工作区访客</option>
              <option value="workspace_owner">工作区所有者</option>
            </select>
            <Button type="submit" className="h-10" disabled={assigningMember}>
              {assigningMember ? <Loader2 className="animate-spin" /> : <UserRoundCheck />}
              保存授权
            </Button>
          </div>
          <p className="mb-0 mt-2 text-xs text-[var(--cp-text-faint)]">重复保存会替换该成员在所选工作区的直接角色，并保留企业级角色。</p>
        </form>
      ) : null}
    </section>
  );
}

function MemberSection({ canRead, canManage }: { canRead: boolean; canManage: boolean }) {
  const queryClient = useQueryClient();
  const membersQuery = useQuery({
    queryKey: ["enterprise-members"],
    queryFn: getMembers,
    enabled: canRead,
    retry: 1,
    staleTime: 15_000,
  });
  const sessionQuery = useQuery({
    queryKey: ["auth-session"],
    queryFn: getAuthSession,
    enabled: canRead,
    retry: false,
    staleTime: 30_000,
  });
  const [confirmation, setConfirmation] = useState<{
    userId: string;
    status: "active" | "suspended" | "removed";
  } | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ userId: string; message: string } | null>(null);

  async function changeStatus(userId: string, status: "active" | "suspended" | "removed") {
    setPendingUserId(userId);
    setRowError(null);
    try {
      await requestJson(`/api/enterprise/members/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setConfirmation(null);
      await Promise.all([
        membersQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["enterprise-audit"] }),
      ]);
    } catch (error) {
      setRowError({ userId, message: getErrorMessage(error, "无法更新成员状态。") });
    } finally {
      setPendingUserId(null);
    }
  }

  const members = membersQuery.data?.members ?? [];
  const activeSeats = members.filter(
    (member) => member.status === "active" || member.status === "invited" || member.status === "suspended",
  ).length;

  return (
    <section id="members" className="scroll-mt-20 border-b border-[var(--cp-border)] py-12" aria-labelledby="member-list-title">
      <OperationsHeading
        id="member-list-title"
        icon={Users}
        title="企业成员"
        description="查看企业席位、角色与工作区归属；暂停或移除会立即撤销访问并中断该成员的运行中任务。"
      />

      {!canRead ? <PermissionNotice>当前角色没有读取企业成员的权限。</PermissionNotice> : null}
      {canRead && membersQuery.isLoading ? <RowsSkeleton label="正在加载企业成员" /> : null}
      {canRead && membersQuery.isError ? (
        <InlineError message={getErrorMessage(membersQuery.error, "无法读取企业成员。") } onRetry={() => void membersQuery.refetch()} />
      ) : null}
      {canRead && membersQuery.data ? (
        <div className="mt-7">
          <div className="flex items-center justify-between gap-4 text-xs text-[var(--cp-text-muted)]">
            <span>{activeSeats} 个已分配席位</span>
            <span>合同上限 {membersQuery.data.seatLimit} 人</span>
          </div>
          <ul className="m-0 mt-3 list-none divide-y divide-[var(--cp-border-subtle)] border-y border-[var(--cp-border)] p-0">
            {members.map((member) => {
              const isOwner = member.roleKeys.includes("tenant_owner");
              const isSelf = sessionQuery.data?.user?.id === member.userId;
              const isPending = pendingUserId === member.userId;
              const memberConfirmation = confirmation?.userId === member.userId ? confirmation : null;
              return (
                <li key={member.userId} className="py-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{member.name || member.email}</span>
                        {isSelf ? <StatusPill>当前账号</StatusPill> : null}
                        <StatusPill tone={member.status === "active" ? "success" : "muted"}>
                          {memberStatusLabels[member.status]}
                        </StatusPill>
                      </div>
                      <p className="mb-0 mt-1 break-all text-xs text-[var(--cp-text-muted)]">{member.email}</p>
                      <p className="mb-0 mt-1 text-xs leading-5 text-[var(--cp-text-faint)]">
                        {member.roleKeys.map((role) => roleLabels[role] || role).join("、") || "未分配角色"}
                        {member.workspaces.length > 0
                          ? ` · ${member.workspaces.map((workspace) => workspace.name).join("、")}`
                          : " · 未加入工作区"}
                      </p>
                    </div>

                    {canManage ? (
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {isOwner || isSelf ? (
                          <span className="inline-flex h-8 items-center gap-1.5 text-xs text-[var(--cp-text-faint)]">
                            <ShieldAlert className="size-3.5" />
                            {isOwner ? "需先转移所有权" : "不能操作自己"}
                          </span>
                        ) : member.status === "suspended" ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isPending}
                            onClick={() => setConfirmation({ userId: member.userId, status: "active" })}
                          >
                            <RotateCcw />
                            重新启用
                          </Button>
                        ) : (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={isPending}
                              onClick={() => setConfirmation({ userId: member.userId, status: "suspended" })}
                            >
                              <UserRoundX />
                              暂停
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={isPending}
                              className="text-[var(--cp-danger)] hover:text-[var(--cp-danger)]"
                              onClick={() => setConfirmation({ userId: member.userId, status: "removed" })}
                            >
                              移除
                            </Button>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>

                  {memberConfirmation ? (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--cp-radius-item)] bg-[var(--cp-bg-subtle)] px-3 py-2.5">
                      <p className="m-0 text-xs leading-5 text-[var(--cp-text-muted)]">
                        {memberConfirmation.status === "active"
                          ? "确认恢复该成员的企业与工作区访问？"
                          : memberConfirmation.status === "suspended"
                            ? "确认暂停访问并中断该成员当前运行中的任务？"
                            : "确认永久移除成员、角色与工作区归属？该操作不能在此页面撤销。"}
                      </p>
                      <div className="flex gap-2">
                        <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setConfirmation(null)}>
                          取消
                        </Button>
                        <Button
                          type="button"
                          variant={memberConfirmation.status === "removed" ? "destructive" : "default"}
                          size="sm"
                          disabled={isPending}
                          onClick={() => void changeStatus(member.userId, memberConfirmation.status)}
                        >
                          {isPending ? <Loader2 className="animate-spin" /> : memberConfirmation.status === "active" ? <UserRoundCheck /> : <Check />}
                          确认{memberConfirmation.status === "active" ? "启用" : memberConfirmation.status === "suspended" ? "暂停" : "移除"}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {rowError?.userId === member.userId ? (
                    <p role="alert" className="mb-0 mt-3 text-xs text-[var(--cp-danger)]">{rowError.message}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {members.length === 0 ? <EmptyReadout>当前企业还没有成员。</EmptyReadout> : null}
        </div>
      ) : null}
    </section>
  );
}

function AuditSection({ canRead }: { canRead: boolean }) {
  const query = useQuery({
    queryKey: ["enterprise-audit"],
    queryFn: getAuditEvents,
    enabled: canRead,
    retry: 1,
    staleTime: 10_000,
  });

  return (
    <section id="audit" className="scroll-mt-20 border-b border-[var(--cp-border)] py-12" aria-labelledby="audit-title">
      <OperationsHeading
        id="audit-title"
        icon={ScrollText}
        title="最近审计"
        description="只展示操作类型、目标和结果；提示词、工具参数、凭据与客户数据不会进入此读数。"
      />
      {!canRead ? <PermissionNotice>当前角色没有读取企业审计事件的权限。</PermissionNotice> : null}
      {canRead && query.isLoading ? <RowsSkeleton label="正在加载审计事件" /> : null}
      {canRead && query.isError ? (
        <InlineError message={getErrorMessage(query.error, "无法读取审计事件。") } onRetry={() => void query.refetch()} />
      ) : null}
      {canRead && query.data ? (
        <ol className="m-0 mt-7 list-none divide-y divide-[var(--cp-border-subtle)] border-y border-[var(--cp-border)] p-0">
          {query.data.events.map((event) => (
            <li key={event.id} className="grid gap-2 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <p className="m-0 truncate text-sm font-medium">{auditActionLabels[event.action] || event.action}</p>
                <p className="mb-0 mt-1 truncate text-xs text-[var(--cp-text-muted)]">
                  {event.targetType}{event.targetId ? ` · ${shortIdentifier(event.targetId)}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs text-[var(--cp-text-faint)] sm:justify-end">
                <StatusPill tone={event.outcome === "succeeded" ? "success" : "warning"}>
                  {event.outcome === "succeeded" ? "成功" : event.outcome}
                </StatusPill>
                <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      {canRead && query.data?.events.length === 0 ? <EmptyReadout>暂无可显示的审计事件。</EmptyReadout> : null}
    </section>
  );
}

function OperationsHeading({
  id,
  icon: Icon,
  title,
  description,
}: {
  id: string;
  icon: typeof Building2;
  title: string;
  description: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-8">
      <h2 id={id} className="m-0 flex items-center gap-2 text-[19px] font-semibold">
        <Icon className="size-4.5 text-[var(--cp-text-muted)]" strokeWidth={1.8} />
        {title}
      </h2>
      <p className="m-0 max-w-[520px] text-sm leading-6 text-[var(--cp-text-muted)]">{description}</p>
    </div>
  );
}

function PermissionNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-7 border-y border-[var(--cp-border-subtle)] bg-[var(--cp-bg-subtle)] px-4 py-3 text-sm text-[var(--cp-text-muted)]">
      {children}
    </div>
  );
}

function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-y border-[var(--cp-border)] py-4">
      <p className="m-0 text-sm text-[var(--cp-danger)]">{message}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>重新读取</Button>
    </div>
  );
}

function RowsSkeleton({ label }: { label: string }) {
  return (
    <div className="mt-7 animate-pulse space-y-3 border-y border-[var(--cp-border)] py-4" aria-label={label}>
      <div className="h-4 w-4/5 rounded bg-[var(--cp-bg-muted)]" />
      <div className="h-4 w-3/5 rounded bg-[var(--cp-bg-muted)]" />
    </div>
  );
}

function EmptyReadout({ children }: { children: React.ReactNode }) {
  return <p className="m-0 border-b border-[var(--cp-border)] py-5 text-sm text-[var(--cp-text-muted)]">{children}</p>;
}

function StatusPill({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "muted" | "success" | "warning";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium",
        tone === "success" && "bg-[var(--cp-success-bg)] text-[var(--cp-success)]",
        tone === "warning" && "bg-[var(--cp-warning-bg)] text-[var(--cp-warning)]",
        tone === "muted" && "bg-[var(--cp-bg-muted)] text-[var(--cp-text-muted)]",
        tone === "default" && "bg-[var(--cp-bg-subtle)] text-[var(--cp-text-soft)]",
      )}
    >
      {children}
    </span>
  );
}

async function getWorkspaces(): Promise<{ workspaces: WorkspaceSummary[]; workspaceLimit: number }> {
  return requestJson("/api/enterprise/workspaces");
}

async function getMembers(): Promise<{ members: EnterpriseMember[]; seatLimit: number }> {
  return requestJson("/api/enterprise/members");
}

async function getAuditEvents(): Promise<{ events: AuditEvent[] }> {
  return requestJson("/api/enterprise/audit?limit=30");
}

async function getAuthSession(): Promise<AuthSession> {
  return requestJson("/api/account/session");
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new Error(payload?.error || "请求暂时无法完成。");
  }
  return payload as T;
}

function shortIdentifier(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
