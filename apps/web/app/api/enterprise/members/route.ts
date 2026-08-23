import { NextResponse } from "next/server";

import { requireAgentContext } from "@/lib/agent/http";
import { requireEnterpriseTenantPermission } from "@/lib/enterprise/context";
import { listEnterpriseMembers } from "@/lib/enterprise/members";

export async function GET(request: Request) {
  const access = await requireAgentContext(request, "members.read");
  if (!access.ok) return access.response;
  const tenantDenied = requireEnterpriseTenantPermission(access.context, "members.read");
  if (tenantDenied) return tenantDenied;
  try {
    const members = await listEnterpriseMembers(access.context);
    return NextResponse.json(
      { members, seatLimit: access.context.contract.seatLimit },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "无法读取企业成员。" }, { status: 503 });
  }
}
