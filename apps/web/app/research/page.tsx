import type { Metadata } from "next";

import { CommerceWorkbenchShell } from "@/components/shell/commerce-workbench-shell";

export const metadata: Metadata = {
  title: "商品决策 | Commerce Pilot",
  description: "通过 Codex Harness Skills 完成市场调研、新品开发和产品复盘。",
};

export default function ResearchPage() {
  return (
    <CommerceWorkbenchShell
      initialView="research"
      allowPublicRegistration={
        process.env.NODE_ENV !== "production" && process.env.COMMERCE_ALLOW_PUBLIC_REGISTRATION === "true"
      }
    />
  );
}
