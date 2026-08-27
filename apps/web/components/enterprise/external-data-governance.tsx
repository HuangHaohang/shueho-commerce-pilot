"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CircleAlert,
  Copy,
  Database,
  KeyRound,
  Loader2,
  Plus,
  ReceiptText,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ApprovalMode = "always_ask" | "task" | "policy";

type GovernanceResponse = {
  policy: {
    status: "enabled" | "disabled";
    approvalMode: ApprovalMode;
    allowedPlatforms: string[];
    allowedEndpointIds: string[];
    monthlyCallLimit: number;
    monthlySpendLimitMicros: number | null;
    perCallAutoApprovalMicros: number | null;
    perTurnCallLimit: number | null;
    currency: string;
    retentionDays: number | null;
  };
  rateCards: Array<{
    id: string;
    endpointId: string;
    vendorUnitCostMicros: number | null;
    customerUnitPriceMicros: number;
    currency: string;
    effectiveFrom: string;
  }>;
  providerCatalog: {
    latestImport: {
      sourceFilename: string;
      sourceExportedAt: string;
      rowCount: number;
      allowedRowCount: number;
    } | null;
    platforms: Array<{ id: string; name: string; endpointCount: number }>;
    endpoints: Array<{
      endpointId: string;
      platformId: string;
      platformName: string;
      apiPath: string;
      vendorUnitCostMicros: number | null;
      currency: string;
      permissionStatus: "allowed" | "unavailable";
    }>;
  };
  usage: {
    periodStart: string;
    reservedCalls: number;
    dispatchedCalls: number;
    succeededCalls: number;
    failedCalls: number;
    unknownCalls: number;
    unpricedCalls: number;
    billableAmountMicros: number;
    vendorCostMicros: number;
  };
  recentCalls: Array<{
    id: string;
    endpointId: string;
    platform: string;
    source: "codex_harness" | "external_mcp";
    state: string;
    approvalState: string;
    pricingStatus: "priced" | "unpriced";
    billableAmountMicros: number | null;
    currency: string;
    upstreamCode: number | null;
    createdAt: string;
  }>;
};

type TokenResponse = {
  mcpUrl: string;
  tokens: Array<{
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    status: "active" | "revoked";
    expiresAt: string | null;
    lastUsedAt: string | null;
    createdAt: string;
    createdByUserId: string;
    createdByName: string | null;
  }>;
};

type RuntimeHealthResponse = {
  externalData: {
    configured?: boolean;
    connected?: boolean;
    controlConfigured?: boolean;
    error?: string | null;
  } | null;
};

const approvalOptions: Array<{ value: ApprovalMode; label: string; description: string }> = [
  { value: "always_ask", label: "每次询问", description: "每个收费调用都等待用户确认" },
  { value: "task", label: "允许任务授权", description: "用户可为当前任务预先授权" },
  { value: "policy", label: "企业策略自动调用", description: "按费率和单次上限自动批准" },
];

const fieldClassName =
  "h-10 w-full rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 text-sm text-[var(--cp-text)] outline-none placeholder:text-[var(--cp-text-faint)] focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]";

export function ExternalDataGovernance({ permissions }: { permissions: string[] }) {
  const queryClient = useQueryClient();
  const permissionSet = useMemo(() => new Set(permissions), [permissions]);
  const canRead = permissionSet.has("external_data.usage.read");
  const canManage = permissionSet.has("external_data.policy.manage");
  const canManageTokens = permissionSet.has("mcp.access_token.manage");
  const governanceQuery = useQuery({
    queryKey: ["external-data-governance"],
    queryFn: getGovernance,
    enabled: canRead,
    retry: 1,
    staleTime: 10_000,
  });
  const tokenQuery = useQuery({
    queryKey: ["enterprise-mcp-tokens"],
    queryFn: getMcpTokens,
    enabled: canManageTokens,
    retry: 1,
    staleTime: 10_000,
  });
  const runtimeQuery = useQuery({
    queryKey: ["gateway-health", "external-data-governance"],
    queryFn: getRuntimeHealth,
    retry: 1,
    staleTime: 10_000,
  });
  const [policy, setPolicy] = useState<GovernanceResponse["policy"] | null>(null);
  const [endpointAllowlistDraft, setEndpointAllowlistDraft] = useState("");
  const [monthlyBudgetDraft, setMonthlyBudgetDraft] = useState("");
  const [autoCeilingDraft, setAutoCeilingDraft] = useState("");
  const [policySaving, setPolicySaving] = useState(false);
  const [policyMessage, setPolicyMessage] = useState<string | null>(null);
  const [rateEndpointId, setRateEndpointId] = useState("");
  const [customerPrice, setCustomerPrice] = useState("");
  const [vendorCost, setVendorCost] = useState("");
  const [rateSaving, setRateSaving] = useState(false);
  const [rateMessage, setRateMessage] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState("");
  const [tokenPaidScope, setTokenPaidScope] = useState(false);
  const [tokenCreating, setTokenCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [tokenMessage, setTokenMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (governanceQuery.data?.policy) {
      setPolicy(governanceQuery.data.policy);
      setEndpointAllowlistDraft(governanceQuery.data.policy.allowedEndpointIds.join("\n"));
      setMonthlyBudgetDraft(microsToInput(governanceQuery.data.policy.monthlySpendLimitMicros));
      setAutoCeilingDraft(microsToInput(governanceQuery.data.policy.perCallAutoApprovalMicros));
    }
  }, [governanceQuery.data?.policy]);

  async function savePolicy() {
    if (!policy || policySaving) return;
    const endpointItems = endpointAllowlistDraft
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (endpointItems.length > 500 || endpointItems.some((item) => !/^[a-z0-9_]+\.[A-Za-z0-9_.-]+$/.test(item))) {
      setPolicyMessage("接口白名单存在无效 endpoint_id，请每行填写一个完整标识。");
      return;
    }
    const monthlySpendLimitMicros = moneyToMicros(monthlyBudgetDraft);
    const perCallAutoApprovalMicros = moneyToMicros(autoCeilingDraft);
    if (
      (monthlyBudgetDraft.trim() && monthlySpendLimitMicros === null) ||
      (autoCeilingDraft.trim() && perCallAutoApprovalMicros === null)
    ) {
      setPolicyMessage("金额预算格式无效，最多保留六位小数。");
      return;
    }
    const policyToSave = {
      ...policy,
      allowedEndpointIds: [...new Set(endpointItems)].sort(),
      monthlySpendLimitMicros,
      perCallAutoApprovalMicros,
    };
    setPolicySaving(true);
    setPolicyMessage(null);
    try {
      const response = await requestJson<{ policy: GovernanceResponse["policy"] }>(
        "/api/enterprise/external-data",
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(policyToSave) },
      );
      setPolicy(response.policy);
      setPolicyMessage("策略已保存并完成读回。");
      await Promise.all([
        governanceQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["enterprise-audit"] }),
      ]);
    } catch (error) {
      setPolicyMessage(errorMessage(error, "无法保存外部数据策略。"));
    } finally {
      setPolicySaving(false);
    }
  }

  async function saveRateCard(event: React.FormEvent) {
    event.preventDefault();
    if (rateSaving) return;
    const customerMicros = moneyToMicros(customerPrice);
    const vendorMicros = vendorCost.trim() ? moneyToMicros(vendorCost) : null;
    if (!/^[a-z0-9_]+\.[A-Za-z0-9_.-]+$/.test(rateEndpointId) || customerMicros === null || (vendorCost.trim() && vendorMicros === null)) {
      setRateMessage("请填写有效接口标识和金额。金额使用人民币元。 ");
      return;
    }
    setRateSaving(true);
    setRateMessage(null);
    try {
      await requestJson("/api/enterprise/external-data/rate-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpointId: rateEndpointId,
          vendorUnitCostMicros: vendorMicros,
          customerUnitPriceMicros: customerMicros,
        }),
      });
      setRateEndpointId("");
      setCustomerPrice("");
      setVendorCost("");
      setRateMessage("费率已生效并完成读回。");
      await Promise.all([
        governanceQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["enterprise-audit"] }),
      ]);
    } catch (error) {
      setRateMessage(errorMessage(error, "无法保存费率。"));
    } finally {
      setRateSaving(false);
    }
  }

  async function retireRateCard(id: string) {
    setRateMessage(null);
    try {
      await requestJson(`/api/enterprise/external-data/rate-cards/${encodeURIComponent(id)}`, { method: "DELETE" });
      await Promise.all([
        governanceQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["enterprise-audit"] }),
      ]);
    } catch (error) {
      setRateMessage(errorMessage(error, "无法停用费率。"));
    }
  }

  async function createToken(event: React.FormEvent) {
    event.preventDefault();
    if (!tokenName.trim() || tokenCreating) return;
    setTokenCreating(true);
    setTokenMessage(null);
    setCreatedToken(null);
    try {
      const response = await requestJson<{ token: { token: string } }>("/api/enterprise/mcp-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tokenName.trim(),
          scopes: ["external_data.catalog.read", ...(tokenPaidScope ? ["external_data.call"] : [])],
          expiresInDays: 90,
        }),
      });
      setCreatedToken(response.token.token);
      setTokenName("");
      setTokenPaidScope(false);
      await Promise.all([
        tokenQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["enterprise-audit"] }),
      ]);
    } catch (error) {
      setTokenMessage(errorMessage(error, "无法创建 MCP 访问令牌。"));
    } finally {
      setTokenCreating(false);
    }
  }

  async function revokeToken(id: string) {
    setTokenMessage(null);
    try {
      await requestJson(`/api/enterprise/mcp-tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
      await Promise.all([
        tokenQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["enterprise-audit"] }),
      ]);
    } catch (error) {
      setTokenMessage(errorMessage(error, "无法撤销 MCP 访问令牌。"));
    }
  }

  if (!canRead && !canManage && !canManageTokens) return null;
  const data = governanceQuery.data;
  const platformOptions = data?.providerCatalog.platforms ?? [];
  const hasOfficialPricing = Boolean(
    data?.providerCatalog.endpoints.some((endpoint) => endpoint.permissionStatus === "allowed"),
  );

  return (
    <section id="external-data" className="scroll-mt-20 border-b border-[var(--cp-border)] py-12" aria-labelledby="external-data-title">
      <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-8">
        <h2 id="external-data-title" className="m-0 flex items-center gap-2 text-[19px] font-semibold">
          <Database className="size-4.5 text-[var(--cp-text-muted)]" strokeWidth={1.8} />
          外部数据治理
        </h2>
        <div>
          <p className="m-0 max-w-[540px] text-sm leading-6 text-[var(--cp-text-muted)]">
            JustOneAPI 调用统一经过接口白名单、用户授权、预算预占、审计和计费结算；供应商凭据不会提供给成员或 MCP 客户端。
          </p>
          <p className="mb-0 mt-2 text-xs text-[var(--cp-text-faint)]">
            运行状态：{runtimeLabel(runtimeQuery.data)}
          </p>
        </div>
      </div>

      {canRead && governanceQuery.isLoading ? <LoadingRows /> : null}
      {canRead && governanceQuery.isError ? <InlineNotice tone="danger">无法读取外部数据治理状态。</InlineNotice> : null}
      {data ? (
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          <Metric label="本周期成功调用" value={`${data.usage.succeededCalls} 次`} />
          <Metric label="对客户计费" value={formatMoney(data.usage.billableAmountMicros, "CNY")} />
          <Metric
            label="待处理异常"
            value={`${data.usage.unknownCalls + data.usage.unpricedCalls} 项`}
            warning={data.usage.unknownCalls + data.usage.unpricedCalls > 0}
          />
        </div>
      ) : null}

      {canManage && policy ? (
        <div className="mt-10 border-t border-[var(--cp-border-subtle)] pt-8">
          <SectionTitle icon={ShieldCheck} title="权限与自动调用策略" />
          <label className="mt-5 flex items-center justify-between gap-5 border-y border-[var(--cp-border-subtle)] py-3 text-sm">
            <span>
              <span className="block font-medium">启用 JustOneAPI 数据能力</span>
              <span className="mt-1 block text-xs text-[var(--cp-text-muted)]">关闭后目录、Harness 和外部 MCP 调用全部拒绝。</span>
            </span>
            <input
              type="checkbox"
              checked={policy.status === "enabled"}
              onChange={(event) => setPolicy({ ...policy, status: event.target.checked ? "enabled" : "disabled" })}
              className="size-4 accent-[var(--cp-text)]"
            />
          </label>

          <div className="mt-6">
            <p className="m-0 text-sm font-medium">最高自动化等级</p>
            <div className="mt-3 grid gap-1 rounded-[var(--cp-radius-item)] bg-[var(--cp-bg-subtle)] p-1 sm:grid-cols-3">
              {approvalOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    "min-h-[58px] rounded-[6px] px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
                    policy.approvalMode === option.value ? "bg-[var(--cp-surface)] shadow-sm" : "hover:bg-[var(--cp-surface-hover)]",
                  )}
                  onClick={() => setPolicy({ ...policy, approvalMode: option.value })}
                >
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--cp-text-muted)]">{option.description}</span>
                </button>
              ))}
            </div>
          </div>

          <fieldset className="mt-6">
            <legend className="text-sm font-medium">允许平台</legend>
            <div className="mt-3 grid gap-x-5 gap-y-2 sm:grid-cols-3">
              {platformOptions.map((platform) => (
                <label key={platform.id} className="flex min-h-8 items-center gap-2 text-sm text-[var(--cp-text-soft)]">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--cp-text)]"
                    checked={policy.allowedPlatforms.includes(platform.id)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...policy.allowedPlatforms, platform.id]
                        : policy.allowedPlatforms.filter((item) => item !== platform.id);
                      setPolicy({ ...policy, allowedPlatforms: [...new Set(next)].sort() });
                    }}
                  />
                  <span className="truncate">{platform.name}</span>
                  <span className="text-xs text-[var(--cp-text-faint)]">{platform.endpointCount}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="mt-6 block">
            <span className="text-sm font-medium">接口白名单（可选）</span>
            <span className="mt-1 block text-xs leading-5 text-[var(--cp-text-muted)]">
              每行一个 endpoint_id；留空表示允许已勾选平台下的接口，实际收费调用仍受费率、预算和批准策略控制。
            </span>
            <textarea
              rows={4}
              className="mt-3 max-h-36 min-h-24 w-full resize-y rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 py-2 font-mono text-xs leading-5 text-[var(--cp-text)] outline-none placeholder:text-[var(--cp-text-faint)] focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
              value={endpointAllowlistDraft}
              placeholder="taobao.get_item_detail_v9"
              onChange={(event) => setEndpointAllowlistDraft(event.target.value)}
            />
          </label>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <LabeledInput label="每月调用上限">
              <input
                type="number"
                className={fieldClassName}
                min={1}
                max={1_000_000}
                value={policy.monthlyCallLimit}
                onChange={(event) => setPolicy({ ...policy, monthlyCallLimit: Math.max(1, Number(event.target.value) || 1) })}
              />
            </LabeledInput>
            <LabeledInput label="每月金额预算（元）">
              <input
                inputMode="decimal"
                className={fieldClassName}
                placeholder="未设置"
                value={monthlyBudgetDraft}
                onChange={(event) => setMonthlyBudgetDraft(event.target.value)}
              />
            </LabeledInput>
            <LabeledInput label="单次自动批准上限（元）">
              <input
                inputMode="decimal"
                className={fieldClassName}
                placeholder="未设置"
                value={autoCeilingDraft}
                onChange={(event) => setAutoCeilingDraft(event.target.value)}
              />
            </LabeledInput>
            <LabeledInput label="每任务调用上限（次）">
              <input
                type="number"
                className={fieldClassName}
                min={1}
                max={100}
                placeholder="未设置"
                value={policy.perTurnCallLimit ?? ""}
                onChange={(event) => {
                  const value = event.target.value.trim();
                  setPolicy({
                    ...policy,
                    perTurnCallLimit: value ? Math.min(100, Math.max(1, Number(value) || 1)) : null,
                  });
                }}
              />
            </LabeledInput>
            <LabeledInput label="审计保存天数">
              <select
                className={fieldClassName}
                value={policy.retentionDays === null ? "permanent" : String(policy.retentionDays)}
                onChange={(event) => setPolicy({
                  ...policy,
                  retentionDays: event.target.value === "permanent" ? null : Number(event.target.value),
                })}
              >
                <option value={90}>90 天</option>
                <option value={180}>180 天</option>
                <option value={365}>365 天</option>
                <option value={730}>730 天</option>
                <option value="permanent">永久（仅审计元数据）</option>
              </select>
            </LabeledInput>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-xs text-[var(--cp-text-muted)]" aria-live="polite">
              {policyMessage || (policy.monthlySpendLimitMicros !== null && !hasOfficialPricing && !data?.rateCards.length
                ? "已设置金额预算；未配置费率的接口将被拒绝，防止绕过预算。"
                : policy.approvalMode === "policy" && !data?.rateCards.length
                  ? "没有费率时，企业策略自动调用仍会降级为逐次询问。"
                : "自动调用不能突破成员 RBAC、平台白名单、接口白名单或预算。")}
            </p>
            <Button type="button" disabled={policySaving || policy.allowedPlatforms.length === 0} onClick={() => void savePolicy()}>
              {policySaving ? <Loader2 className="animate-spin" /> : <Check />}
              保存策略
            </Button>
          </div>
        </div>
      ) : null}

      {canManage ? (
        <div className="mt-10 border-t border-[var(--cp-border-subtle)] pt-8">
          <SectionTitle icon={ReceiptText} title="费率与计费口径" />
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--cp-text-muted)]">
            <span>
              {data?.providerCatalog.latestImport
                ? `${data.providerCatalog.latestImport.sourceFilename} · ${formatDateTime(data.providerCatalog.latestImport.sourceExportedAt)}`
                : "尚未导入 JustOneAPI 官方定价表"}
            </span>
            <span>
              {data?.providerCatalog.latestImport
                ? `${data.providerCatalog.latestImport.allowedRowCount}/${data.providerCatalog.latestImport.rowCount} 个接口已开通`
                : "0 个接口"}
            </span>
          </div>
          <div className="cp-flat-scrollbar mt-3 max-h-[320px] overflow-y-auto overscroll-contain border-y border-[var(--cp-border)]">
            {(data?.providerCatalog.endpoints ?? []).map((endpoint) => (
              <div
                key={endpoint.endpointId}
                className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-[var(--cp-border-subtle)] py-2.5 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="m-0 truncate text-sm font-medium">{endpoint.apiPath}</p>
                  <p className="mb-0 mt-0.5 truncate text-xs text-[var(--cp-text-faint)]">
                    {endpoint.platformName} · {endpoint.endpointId}
                  </p>
                </div>
                <div className="text-right">
                  <p className="m-0 text-sm">
                    {endpoint.vendorUnitCostMicros === null
                      ? "未定价"
                      : `${formatMoney(endpoint.vendorUnitCostMicros, endpoint.currency)} / 次`}
                  </p>
                  <p className={cn(
                    "mb-0 mt-0.5 text-xs",
                    endpoint.permissionStatus === "allowed" ? "text-[var(--cp-success)]" : "text-[var(--cp-text-faint)]",
                  )}>
                    {endpoint.permissionStatus === "allowed" ? "已开通" : "未开通"}
                  </p>
                </div>
              </div>
            ))}
            {data?.providerCatalog.endpoints.length === 0
              ? <p className="m-0 py-4 text-sm text-[var(--cp-text-muted)]">尚未导入官方定价数据。</p>
              : null}
          </div>
          <h3 className="mb-0 mt-7 text-sm font-medium">客户计费覆盖（可选）</h3>
          <form className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" onSubmit={saveRateCard}>
            <input className={fieldClassName} value={rateEndpointId} onChange={(event) => setRateEndpointId(event.target.value.trim())} placeholder="endpoint_id" aria-label="接口标识" />
            <input className={fieldClassName} inputMode="decimal" value={customerPrice} onChange={(event) => setCustomerPrice(event.target.value)} placeholder="客户单价（元）" aria-label="客户单价" />
            <input className={fieldClassName} inputMode="decimal" value={vendorCost} onChange={(event) => setVendorCost(event.target.value)} placeholder="供应商成本（可选）" aria-label="供应商成本" />
            <Button type="submit" disabled={rateSaving} className="h-10">
              {rateSaving ? <Loader2 className="animate-spin" /> : <Plus />}
              保存费率
            </Button>
          </form>
          {rateMessage ? <p className="mb-0 mt-2 text-xs text-[var(--cp-text-muted)]">{rateMessage}</p> : null}
          <div className="mt-4 divide-y divide-[var(--cp-border-subtle)] border-y border-[var(--cp-border)]">
            {(data?.rateCards ?? []).map((rate) => (
              <div key={rate.id} className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 py-2.5 text-sm">
                <span className="truncate font-medium">{rate.endpointId}</span>
                <span className="text-[var(--cp-text-muted)]">{formatMoney(rate.customerUnitPriceMicros, rate.currency)} / 次</span>
                <Button type="button" variant="ghost" size="icon" aria-label={`停用 ${rate.endpointId} 费率`} onClick={() => void retireRateCard(rate.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            {data?.rateCards.length === 0 ? <p className="m-0 py-4 text-sm text-[var(--cp-text-muted)]">暂无客户覆盖费率，默认使用官方导入单价。</p> : null}
          </div>
        </div>
      ) : null}

      {canManageTokens ? (
        <div className="mt-10 border-t border-[var(--cp-border-subtle)] pt-8">
          <SectionTitle icon={KeyRound} title="外部 MCP 访问令牌" />
          <p className="mb-0 mt-2 break-all text-xs text-[var(--cp-text-muted)]">
            Streamable HTTP：<code>{tokenQuery.data?.mcpUrl || "正在读取"}</code>
          </p>
          <form className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center" onSubmit={createToken}>
            <input className={fieldClassName} value={tokenName} onChange={(event) => setTokenName(event.target.value)} placeholder="例如：同事的 Codex" aria-label="令牌名称" />
            <label className="flex h-10 items-center gap-2 px-2 text-sm text-[var(--cp-text-soft)]">
              <input type="checkbox" className="size-4 accent-[var(--cp-text)]" checked={tokenPaidScope} onChange={(event) => setTokenPaidScope(event.target.checked)} />
              允许付费调用
            </label>
            <Button type="submit" disabled={tokenCreating || !tokenName.trim()} className="h-10">
              {tokenCreating ? <Loader2 className="animate-spin" /> : <Plus />}
              创建令牌
            </Button>
          </form>
          {createdToken ? (
            <div className="mt-4 flex items-start justify-between gap-3 rounded-[var(--cp-radius-item)] bg-[var(--cp-bg-subtle)] px-3 py-3">
              <div className="min-w-0">
                <p className="m-0 text-xs font-medium">令牌只显示一次</p>
                <code className="mt-1 block break-all text-xs text-[var(--cp-text-muted)]">{createdToken}</code>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="复制 MCP 访问令牌"
                onClick={async () => {
                  await navigator.clipboard.writeText(createdToken);
                  setCopied(true);
                }}
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          ) : null}
          {tokenMessage ? <p className="mb-0 mt-2 text-xs text-[var(--cp-danger)]">{tokenMessage}</p> : null}
          <div className="mt-4 divide-y divide-[var(--cp-border-subtle)] border-y border-[var(--cp-border)]">
            {(tokenQuery.data?.tokens ?? []).map((token) => (
              <div key={token.id} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-2.5">
                <div className="min-w-0">
                  <p className="m-0 truncate text-sm font-medium">{token.name}</p>
                  <p className="mb-0 mt-1 text-xs text-[var(--cp-text-muted)]">
                    {token.prefix} · {token.scopes.includes("external_data.call") ? "目录与付费调用" : "仅目录"}
                    {token.createdByName ? ` · ${token.createdByName}` : ""}
                    {token.lastUsedAt ? ` · 最近使用 ${formatDateTime(token.lastUsedAt)}` : " · 尚未使用"}
                  </p>
                </div>
                {token.status === "active" ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => void revokeToken(token.id)}>撤销</Button>
                ) : <span className="text-xs text-[var(--cp-text-faint)]">已撤销</span>}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {canRead && data ? (
        <div className="mt-10 border-t border-[var(--cp-border-subtle)] pt-8">
          <SectionTitle icon={CircleAlert} title="最近调用与审计读数" />
          <div className="mt-5 divide-y divide-[var(--cp-border-subtle)] border-y border-[var(--cp-border)]">
            {data.recentCalls.map((call) => (
              <div key={call.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="m-0 truncate text-sm font-medium">{call.endpointId}</p>
                  <p className="mb-0 mt-1 text-xs text-[var(--cp-text-muted)]">
                    {call.source === "codex_harness" ? "网页 Agent" : "外部 MCP"} · {call.platform} · {formatDateTime(call.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs text-[var(--cp-text-muted)]">
                  <span>{callStateLabel(call.state)}</span>
                  <span>{call.billableAmountMicros === null ? "未计价" : formatMoney(call.billableAmountMicros, call.currency)}</span>
                </div>
              </div>
            ))}
            {data.recentCalls.length === 0 ? <p className="m-0 py-4 text-sm text-[var(--cp-text-muted)]">尚无外部数据调用。</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: typeof ShieldCheck; title: string }) {
  return <h3 className="m-0 flex items-center gap-2 text-base font-semibold"><Icon className="size-4 text-[var(--cp-text-muted)]" strokeWidth={1.8} />{title}</h3>;
}

function Metric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return <div className="border-t border-[var(--cp-border)] pt-3"><p className="m-0 text-xs text-[var(--cp-text-muted)]">{label}</p><p className={cn("mb-0 mt-1 text-lg font-semibold", warning && "text-[var(--cp-warning)]")}>{value}</p></div>;
}

function LabeledInput({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-xs text-[var(--cp-text-muted)]">{label}</span>{children}</label>;
}

function LoadingRows() {
  return <div className="mt-8 space-y-3" aria-label="正在读取外部数据治理"><div className="h-10 animate-pulse bg-[var(--cp-bg-subtle)]" /><div className="h-10 animate-pulse bg-[var(--cp-bg-subtle)]" /></div>;
}

function InlineNotice({ children, tone }: { children: React.ReactNode; tone: "danger" }) {
  return <p className={cn("mb-0 mt-7 text-sm", tone === "danger" && "text-[var(--cp-danger)]")}>{children}</p>;
}

async function getGovernance(): Promise<GovernanceResponse> {
  return requestJson<GovernanceResponse>("/api/enterprise/external-data");
}

async function getMcpTokens(): Promise<TokenResponse> {
  return requestJson<TokenResponse>("/api/enterprise/mcp-tokens");
}

async function getRuntimeHealth(): Promise<RuntimeHealthResponse> {
  return requestJson<RuntimeHealthResponse>("/api/gateway/health");
}

async function requestJson<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error || `请求失败：HTTP ${response.status}`);
  return payload;
}

function moneyToMicros(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) return null;
  if (!/^\d+(?:\.\d{0,6})?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  const micros = Math.round(parsed * 1_000_000);
  return Number.isSafeInteger(micros) && micros >= 0 ? micros : null;
}

function microsToInput(value: number | null): string {
  if (value === null) return "";
  return (value / 1_000_000).toFixed(2).replace(/\.00$/, "");
}

function formatMoney(micros: number, currency: string): string {
  return `${currency} ${(micros / 1_000_000).toFixed(2)}`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function callStateLabel(value: string): string {
  if (value === "succeeded") return "成功";
  if (value === "business_failed") return "业务失败";
  if (value === "unknown") return "待核对";
  if (value === "cancelled") return "已取消";
  if (value === "dispatched") return "已发送";
  return "待处理";
}

function runtimeLabel(value: RuntimeHealthResponse | undefined): string {
  if (!value) return "正在读取";
  if (value.externalData?.connected && value.externalData.controlConfigured) return "已连接并受治理";
  if (value.externalData?.configured && !value.externalData.controlConfigured) return "治理回调未配置";
  return value.externalData?.error || "SHUEHO 外部数据服务待连接";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
