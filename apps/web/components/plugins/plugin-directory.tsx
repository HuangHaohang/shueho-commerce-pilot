"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ImageIcon,
  Plug,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

import type { CommercePluginInventoryItem } from "@/lib/plugins/catalog";
import { cn } from "@/lib/utils";

type PluginInventoryResponse = {
  plugins: CommercePluginInventoryItem[];
  policy: {
    installMode: "application-managed";
    arbitraryPackages: false;
    hostExecution: false;
    runtimeFoundation: "codex-app-server";
  };
};

export function PluginDirectory() {
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);
  const inventoryQuery = useQuery({
    queryKey: ["commerce-plugin-inventory"],
    queryFn: getPluginInventory,
    retry: 1,
    staleTime: 10_000,
  });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--cp-border)] pb-8">
        <div>
          <p className="m-0 text-sm text-[var(--cp-text-muted)]">应用托管能力</p>
          <h1 className="mb-0 mt-2 text-[28px] font-semibold leading-tight">插件</h1>
          <p className="mb-0 mt-3 max-w-[620px] text-sm leading-6 text-[var(--cp-text-muted)]">
            查看当前工作区真实可用的 MCP、技能与应用工具。插件不能替换 Codex Harness 或扩大宿主权限。
          </p>
        </div>
        {inventoryQuery.data ? (
          <div className="text-xs text-[var(--cp-text-faint)]">
            {inventoryQuery.data.plugins.filter((plugin) => plugin.enabled).length} 个运行中
          </div>
        ) : null}
      </div>

      <section className="py-8" aria-labelledby="installed-plugins-title">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 id="installed-plugins-title" className="m-0 text-[17px] font-semibold">
            已安装
          </h2>
          <span className="text-xs text-[var(--cp-text-faint)]">由服务端运行策略管理</span>
        </div>

        {inventoryQuery.isLoading ? <PluginInventorySkeleton /> : null}
        {inventoryQuery.isError ? (
          <div className="border-y border-[var(--cp-border)] py-8 text-sm text-[var(--cp-danger)]">
            无法读取插件运行状态。
          </div>
        ) : null}
        {inventoryQuery.data ? (
          <div className="border-y border-[var(--cp-border)]">
            {inventoryQuery.data.plugins.map((plugin) => {
              const expanded = expandedPlugin === plugin.manifest.name;
              const PluginIcon = plugin.manifest.name === "commerce-web-search" ? Search : ImageIcon;
              return (
                <div key={plugin.manifest.name} className="border-b border-[var(--cp-border-subtle)] last:border-b-0">
                  <button
                    type="button"
                    className="grid w-full grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 px-2 py-5 text-left hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--cp-focus)]"
                    aria-expanded={expanded}
                    aria-controls={`plugin-details-${plugin.manifest.name}`}
                    onClick={() => setExpandedPlugin((current) => current === plugin.manifest.name ? null : plugin.manifest.name)}
                  >
                    <span className="flex size-10 items-center justify-center rounded-[var(--cp-radius-item)] bg-[var(--cp-bg-muted)] text-[var(--cp-text-soft)]">
                      <PluginIcon className="size-5" strokeWidth={1.7} />
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-medium text-[var(--cp-text)]">
                          {plugin.manifest.interface.displayName}
                        </span>
                        <span className="text-[11px] text-[var(--cp-text-faint)]">v{plugin.manifest.version}</span>
                      </span>
                      <span className="mt-1 block truncate text-sm text-[var(--cp-text-muted)]">
                        {plugin.manifest.interface.shortDescription}
                      </span>
                    </span>
                    <span className="flex items-center gap-3 pl-3">
                      <span className={cn(
                        "inline-flex items-center gap-1.5 text-xs",
                        plugin.health === "ready" ? "text-[var(--cp-success)]" : plugin.health === "degraded" ? "text-[var(--cp-warning)]" : "text-[var(--cp-danger)]",
                      )}>
                        <span className="size-1.5 rounded-full bg-current" />
                        {plugin.enabled ? "运行中" : "不可用"}
                      </span>
                      <ChevronDown className={cn("size-4 text-[var(--cp-text-faint)] transition-transform", expanded && "rotate-180")} />
                    </span>
                  </button>

                  {expanded ? (
                    <div id={`plugin-details-${plugin.manifest.name}`} className="grid gap-6 bg-[var(--cp-bg-subtle)] px-5 py-5 md:grid-cols-[minmax(0,1fr)_260px]">
                      <div>
                        <p className="m-0 text-sm leading-6 text-[var(--cp-text-soft)]">{plugin.manifest.description}</p>
                        <div className="mt-4 flex flex-wrap gap-x-3 gap-y-2 text-xs text-[var(--cp-text-muted)]">
                          {plugin.manifest.interface.capabilities.map((capability) => (
                            <span key={capability}>{capability}</span>
                          ))}
                        </div>
                        <div className="mt-5">
                          <div className="text-xs text-[var(--cp-text-faint)]">工具</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {plugin.manifest.components.tools.map((tool) => (
                              <code key={tool} className="rounded-[var(--cp-radius-xs)] bg-[var(--cp-bg-muted)] px-2 py-1 font-mono text-[11px] text-[var(--cp-text-soft)]">
                                {tool}
                              </code>
                            ))}
                          </div>
                        </div>
                      </div>
                      <dl className="m-0 space-y-3 text-xs">
                        <PluginDetail label="状态" value={plugin.statusLabel} />
                        <PluginDetail label="来源" value="应用托管" />
                        <PluginDetail label="网络" value={networkLabel(plugin.manifest.security.network)} />
                        <PluginDetail label="数据范围" value={dataAccessLabel(plugin.manifest.security.dataAccess)} />
                        <PluginDetail label="外部写入" value={plugin.manifest.security.writeEffects ? "允许，需审批" : "无"} />
                      </dl>
                      <div className="md:col-span-2 flex items-start gap-2 border-t border-[var(--cp-border)] pt-4 text-xs leading-5 text-[var(--cp-text-faint)]">
                        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.7} />
                        <span>{plugin.lockedReason}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className="border-t border-[var(--cp-border)] py-8" aria-labelledby="plugin-boundary-title">
        <div className="grid gap-4 md:grid-cols-[200px_minmax(0,1fr)] md:gap-10">
          <h2 id="plugin-boundary-title" className="m-0 flex items-center gap-2 text-sm font-semibold">
            <Plug className="size-4" strokeWidth={1.7} />
            运行边界
          </h2>
          <div className="space-y-3 text-sm leading-6 text-[var(--cp-text-muted)]">
            <p className="m-0">插件可以提供技能、MCP 工具和受控 UI，但不能替换 Codex App Server 的线程、turn、沙箱、审批或上下文压缩。</p>
            <p className="m-0">当前不接受浏览器上传的任意代码包，也不会执行插件自带的宿主命令。</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function PluginDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
      <dt className="text-[var(--cp-text-faint)]">{label}</dt>
      <dd className="m-0 break-words text-[var(--cp-text-soft)]">{value}</dd>
    </div>
  );
}

function PluginInventorySkeleton() {
  return (
    <div className="border-y border-[var(--cp-border)]" aria-label="正在读取插件">
      {[0, 1].map((item) => (
        <div key={item} className="flex items-center gap-3 border-b border-[var(--cp-border-subtle)] px-2 py-5 last:border-b-0">
          <div className="size-10 animate-pulse rounded-[var(--cp-radius-item)] bg-[var(--cp-bg-muted)]" />
          <div className="flex-1">
            <div className="h-3 w-28 animate-pulse rounded bg-[var(--cp-bg-muted)]" />
            <div className="mt-2 h-3 w-64 max-w-full animate-pulse rounded bg-[var(--cp-bg-muted)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

async function getPluginInventory(): Promise<PluginInventoryResponse> {
  const response = await fetch("/api/plugins", { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as PluginInventoryResponse | { error?: string } | null;
  if (!response.ok || !payload || !("plugins" in payload)) {
    throw new Error(payload && "error" in payload ? payload.error : "Plugin inventory unavailable.");
  }
  return payload;
}

function networkLabel(value: CommercePluginInventoryItem["manifest"]["security"]["network"]): string {
  if (value === "provider-only") return "仅应用 Provider";
  if (value === "managed-service") return "仅托管服务";
  return "无";
}

function dataAccessLabel(value: CommercePluginInventoryItem["manifest"]["security"]["dataAccess"]): string {
  if (value === "public-web") return "公开网页";
  if (value === "tenant-artifacts") return "租户制品";
  if (value === "commerce-records") return "电商业务记录";
  return "无";
}
