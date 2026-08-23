import type { Metadata } from "next";

import { EnterpriseAdminDashboard } from "@/components/enterprise/enterprise-admin-dashboard";

export const metadata: Metadata = {
  title: "Enterprise 管理 | Commerce Pilot",
  description: "管理企业工作区、成员与邀请，查看合同额度、Codex 用量和安全审计。",
};

export default function EnterpriseAdminPage() {
  return <EnterpriseAdminDashboard />;
}
