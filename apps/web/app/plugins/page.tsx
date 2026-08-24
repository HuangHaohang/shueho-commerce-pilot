import type { Metadata } from "next";

import { CommerceWorkbenchShell } from "@/components/shell/commerce-workbench-shell";

export const metadata: Metadata = {
  title: "插件 | Commerce Pilot",
  description: "查看 Commerce Pilot 当前工作区已安装的技能、MCP 与应用工具。",
};

export default function PluginsPage() {
  return (
    <CommerceWorkbenchShell
      initialView="plugins"
      allowPublicRegistration={
        process.env.NODE_ENV !== "production" && process.env.COMMERCE_ALLOW_PUBLIC_REGISTRATION === "true"
      }
    />
  );
}
