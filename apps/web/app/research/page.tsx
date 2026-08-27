import type { Metadata } from "next";

import { CommerceWorkbenchShell } from "@/components/shell/commerce-workbench-shell";

export const metadata: Metadata = {
  title: "市场调研 | Commerce Pilot",
  description: "使用公开网页和经企业授权的外部数据完成电商市场调研。",
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
