"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ImageIcon,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react";
import Image from "next/image";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  filterCommercePlugins,
  type CommercePluginInventoryItem,
} from "@/lib/plugins/catalog";
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
  const [query, setQuery] = useState("");
  const [selectedPluginName, setSelectedPluginName] = useState<string | null>(null);
  const inventoryQuery = useQuery({
    queryKey: ["commerce-plugin-inventory"],
    queryFn: getPluginInventory,
    retry: 1,
    staleTime: 10_000,
  });
  const plugins = inventoryQuery.data?.plugins ?? [];
  const filteredPlugins = useMemo(() => filterCommercePlugins(plugins, query), [plugins, query]);
  const selectedPlugin = plugins.find((plugin) => plugin.manifest.name === selectedPluginName) ?? null;

  if (selectedPlugin) {
    return <PluginDetail plugin={selectedPlugin} onBack={() => setSelectedPluginName(null)} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--cp-bg)]">
      <PluginSectionSwitch />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-[960px] px-5 pb-20 pt-10 md:px-8 md:pt-14">
          <div className="flex flex-col gap-7 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="m-0 text-[28px] font-semibold leading-tight">插件</h1>
              <p className="mb-0 mt-2 text-sm leading-6 text-[var(--cp-text-muted)]">
                为电商任务启用由 Commerce Pilot 托管的能力。
              </p>
            </div>
            <label className="flex h-10 w-full items-center gap-2 rounded-[var(--cp-radius-segment)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-4 md:w-[260px]">
              <Search className="size-4 shrink-0 text-[var(--cp-text-faint)]" strokeWidth={1.8} />
              <span className="sr-only">搜索插件</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[var(--cp-text)] outline-none placeholder:text-[var(--cp-text-faint)]"
                placeholder="搜索插件"
              />
            </label>
          </div>

          {inventoryQuery.isLoading ? <PluginInventorySkeleton /> : null}
          {inventoryQuery.isError ? (
            <div className="mt-10 border-y border-[var(--cp-border)] py-8 text-sm text-[var(--cp-danger)]">
              无法读取插件运行状态。
            </div>
          ) : null}
          {inventoryQuery.data ? (
            <>
              <section className="mt-10" aria-labelledby="installed-plugins-title">
                <div className="mb-4 flex items-center gap-2">
                  <h2 id="installed-plugins-title" className="m-0 text-sm font-semibold">
                    已安装
                  </h2>
                  <span className="text-xs text-[var(--cp-text-faint)]">{plugins.length}</span>
                </div>
                <div className="flex min-h-12 flex-wrap items-center gap-2">
                  {plugins.map((plugin) => (
                    <Tooltip key={plugin.manifest.name}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="rounded-[var(--cp-radius-item)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
                          aria-label={`查看${plugin.manifest.interface.displayName}详情`}
                          onClick={() => setSelectedPluginName(plugin.manifest.name)}
                        >
                          <PluginIcon plugin={plugin} size="large" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{plugin.manifest.interface.displayName}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </section>

              <section className="mt-10" aria-labelledby="managed-plugins-title">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <h2 id="managed-plugins-title" className="m-0 text-sm font-semibold">
                    应用托管
                  </h2>
                  <span className="text-xs text-[var(--cp-text-faint)]">
                    {plugins.filter((plugin) => plugin.enabled).length} 个运行中
                  </span>
                </div>

                {filteredPlugins.length ? (
                  <div className="grid gap-x-10 gap-y-1 md:grid-cols-2">
                    {filteredPlugins.map((plugin) => (
                      <PluginListItem
                        key={plugin.manifest.name}
                        plugin={plugin}
                        onOpen={() => setSelectedPluginName(plugin.manifest.name)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="border-y border-[var(--cp-border)] py-10 text-sm text-[var(--cp-text-muted)]">
                    没有匹配的插件。
                  </div>
                )}
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PluginSectionSwitch() {
  return (
    <div className="hidden h-[var(--cp-topbar-height)] shrink-0 items-center justify-center border-b border-transparent md:flex">
      <span className="text-sm font-medium">插件</span>
    </div>
  );
}

function PluginListItem({ plugin, onOpen }: { plugin: CommercePluginInventoryItem; onOpen: () => void }) {
  return (
    <div className="grid min-h-[74px] grid-cols-[44px_minmax(0,1fr)_36px] items-center gap-3 border-b border-[var(--cp-border-subtle)] py-3">
      <PluginIcon plugin={plugin} size="medium" />
      <button
        type="button"
        className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
        onClick={onOpen}
      >
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-[var(--cp-text)]">
            {plugin.manifest.interface.displayName}
          </span>
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              plugin.health === "ready"
                ? "bg-[var(--cp-success)]"
                : plugin.health === "degraded"
                  ? "bg-[var(--cp-warning)]"
                  : "bg-[var(--cp-danger)]",
            )}
            aria-label={plugin.enabled ? "运行中" : "不可用"}
          />
        </span>
        <span className="mt-1 block truncate text-xs leading-5 text-[var(--cp-text-muted)]">
          {plugin.manifest.interface.shortDescription}
        </span>
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 rounded-full"
            aria-label={`查看${plugin.manifest.interface.displayName}详情`}
            onClick={onOpen}
          >
            <Plus className="size-[18px]" strokeWidth={1.8} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>查看详情</TooltipContent>
      </Tooltip>
    </div>
  );
}

function PluginDetail({ plugin, onBack }: { plugin: CommercePluginInventoryItem; onBack: () => void }) {
  const components = [
    ...plugin.manifest.components.skills.map((value) => ({ label: "Skill", value })),
    ...plugin.manifest.components.mcpServers.map((value) => ({ label: "MCP", value })),
    ...plugin.manifest.components.tools.map((value) => ({ label: "Tool", value })),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--cp-bg)]">
      <div className="hidden h-[var(--cp-topbar-height)] shrink-0 items-center border-b border-transparent px-6 md:flex">
        <button
          type="button"
          className="inline-flex h-9 items-center gap-2 rounded-[var(--cp-radius-item)] px-2 text-sm text-[var(--cp-text-soft)] hover:bg-[var(--cp-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" strokeWidth={1.8} />
          插件
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <article className="mx-auto w-full max-w-[840px] px-5 pb-20 pt-8 md:px-8 md:pt-12">
          <button
            type="button"
            className="mb-8 inline-flex h-9 items-center gap-2 rounded-[var(--cp-radius-item)] px-2 text-sm text-[var(--cp-text-soft)] hover:bg-[var(--cp-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)] md:hidden"
            onClick={onBack}
          >
            <ArrowLeft className="size-4" strokeWidth={1.8} />
            插件
          </button>

          <header className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <PluginIcon plugin={plugin} size="large" />
              <div>
                <h1 className="m-0 text-[28px] font-semibold leading-tight">
                  {plugin.manifest.interface.displayName}
                </h1>
                <p className="mb-0 mt-1 text-sm text-[var(--cp-text-muted)]">
                  {plugin.manifest.interface.shortDescription}
                </p>
              </div>
            </div>
            <span className="inline-flex h-9 w-fit items-center gap-2 rounded-[var(--cp-radius-segment)] bg-[var(--cp-text)] px-4 text-sm font-medium text-white">
              <Check className="size-4" strokeWidth={2} />
              已安装
            </span>
          </header>

          <div className="relative mt-8 aspect-[3/1] min-h-[180px] overflow-hidden rounded-[8px] bg-[var(--cp-bg-subtle)]">
            <Image
              src={plugin.manifest.interface.coverImage}
              alt={`${plugin.manifest.interface.displayName}功能视觉`}
              fill
              priority
              sizes="(min-width: 1024px) 776px, calc(100vw - 40px)"
              className="object-cover"
            />
          </div>

          <p className="mb-0 mt-7 text-sm leading-7 text-[var(--cp-text-soft)]">
            {plugin.manifest.description}
          </p>

          <section className="mt-9" aria-labelledby="plugin-components-title">
            <h2 id="plugin-components-title" className="m-0 text-base font-semibold">组件</h2>
            <div className="mt-4 border-y border-[var(--cp-border)]">
              {components.map((component) => (
                <div
                  key={`${component.label}-${component.value}`}
                  className="grid min-h-12 grid-cols-[68px_minmax(0,1fr)] items-center gap-4 border-b border-[var(--cp-border-subtle)] py-2 text-sm last:border-b-0"
                >
                  <span className="text-xs text-[var(--cp-text-faint)]">{component.label}</span>
                  <code className="break-all font-mono text-xs text-[var(--cp-text-soft)]">{component.value}</code>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-9" aria-labelledby="plugin-info-title">
            <h2 id="plugin-info-title" className="m-0 text-base font-semibold">信息</h2>
            <dl className="mb-0 mt-4 border-y border-[var(--cp-border)]">
              <PluginInfoRow label="功能" value={plugin.manifest.interface.capabilities.join("、")} />
              <PluginInfoRow label="开发方" value="Commerce Pilot" />
              <PluginInfoRow label="类别" value={plugin.manifest.interface.category} />
              <PluginInfoRow label="版本" value={plugin.manifest.version} />
              <PluginInfoRow label="状态" value={plugin.statusLabel} />
              <PluginInfoRow label="网络" value={networkLabel(plugin.manifest.security.network)} />
              <PluginInfoRow label="数据范围" value={dataAccessLabel(plugin.manifest.security.dataAccess)} />
              <PluginInfoRow
                label="外部写入"
                value={plugin.manifest.security.writeEffects ? "允许，需审批" : "无"}
                last
              />
            </dl>
          </section>

          <div className="mt-7 flex items-start gap-2 text-xs leading-5 text-[var(--cp-text-faint)]">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" strokeWidth={1.7} />
            <span>{plugin.lockedReason} 插件不能扩大宿主机权限或替换 Codex App Server 的线程与审批边界。</span>
          </div>
        </article>
      </div>
    </div>
  );
}

function PluginIcon({ plugin, size }: { plugin: CommercePluginInventoryItem; size: "medium" | "large" }) {
  const Icon = plugin.manifest.interface.icon === "search" ? Search : ImageIcon;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[var(--cp-radius-item)] border border-[var(--cp-border-subtle)]",
        size === "large" ? "size-12" : "size-11",
        plugin.manifest.interface.icon === "search"
          ? "bg-[#e9f6f2] text-[#176c5a]"
          : "bg-[#fff0eb] text-[#a74736]",
      )}
      aria-hidden="true"
    >
      <Icon className={size === "large" ? "size-6" : "size-5"} strokeWidth={1.8} />
    </span>
  );
}

function PluginInfoRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      className={cn(
        "grid min-h-12 grid-cols-[100px_minmax(0,1fr)] items-center gap-5 border-b border-[var(--cp-border-subtle)] py-2 text-sm",
        last && "border-b-0",
      )}
    >
      <dt className="text-[var(--cp-text-faint)]">{label}</dt>
      <dd className="m-0 break-words text-[var(--cp-text-soft)]">{value}</dd>
    </div>
  );
}

function PluginInventorySkeleton() {
  return (
    <div className="mt-10" aria-label="正在读取插件">
      <div className="h-3 w-16 animate-pulse rounded bg-[var(--cp-bg-muted)]" />
      <div className="mt-4 flex gap-2">
        {[0, 1].map((item) => (
          <div key={item} className="size-12 animate-pulse rounded-[var(--cp-radius-item)] bg-[var(--cp-bg-muted)]" />
        ))}
      </div>
      <div className="mt-10 grid gap-x-10 md:grid-cols-2">
        {[0, 1].map((item) => (
          <div key={item} className="flex min-h-[74px] items-center gap-3 border-b border-[var(--cp-border-subtle)] py-3">
            <div className="size-11 animate-pulse rounded-[var(--cp-radius-item)] bg-[var(--cp-bg-muted)]" />
            <div className="flex-1">
              <div className="h-3 w-28 animate-pulse rounded bg-[var(--cp-bg-muted)]" />
              <div className="mt-2 h-3 w-52 max-w-full animate-pulse rounded bg-[var(--cp-bg-muted)]" />
            </div>
          </div>
        ))}
      </div>
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
