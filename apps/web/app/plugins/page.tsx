import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { PluginDirectory } from "@/components/plugins/plugin-directory";

export const metadata: Metadata = {
  title: "插件 | Commerce Pilot",
  description: "查看 Commerce Pilot 当前工作区已安装的技能、MCP 与应用工具。",
};

export default function PluginsPage() {
  return (
    <div className="min-h-dvh bg-[var(--cp-bg)] text-[var(--cp-text)]">
      <header className="sticky top-0 z-20 border-b border-[var(--cp-border-subtle)] bg-[rgba(255,255,255,0.96)] backdrop-blur-md">
        <div className="mx-auto flex h-[var(--cp-topbar-height)] max-w-[960px] items-center justify-between px-4 md:px-8">
          <Link
            href="/"
            className="inline-flex h-9 items-center gap-2 rounded-[var(--cp-radius-item)] px-2 text-sm text-[var(--cp-text-soft)] hover:bg-[var(--cp-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
          >
            <ArrowLeft className="size-4" strokeWidth={1.8} />
            返回工作台
          </Link>
          <span className="text-sm font-semibold">Commerce Pilot</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[900px] px-5 pb-20 pt-10 md:px-8 md:pt-14">
        <PluginDirectory />
      </main>
    </div>
  );
}
