import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAgentContext } from "@/lib/agent/http";
import { requireEnterpriseTenantPermission } from "@/lib/enterprise/context";
import {
  EnterpriseInvitationError,
  revokeEnterpriseInvitation,
} from "@/lib/enterprise/invitations";

export async function DELETE(
  request: Request,
  routeContext: { params: Promise<{ invitationId: string }> },
) {
  const access = await requireAgentContext(request, "members.manage");
  if (!access.ok) return access.response;
  const tenantDenied = requireEnterpriseTenantPermission(access.context, "members.manage");
  if (tenantDenied) return tenantDenied;
  const { invitationId } = await routeContext.params;
  const parsed = z.string().uuid().safeParse(invitationId);
  if (!parsed.success) return NextResponse.json({ error: "邀请标识无效。" }, { status: 400 });
  try {
    await revokeEnterpriseInvitation(access.context, parsed.data);
    return NextResponse.json({ revoked: true });
  } catch (error) {
    if (error instanceof EnterpriseInvitationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "无法撤销企业邀请。" }, { status: 503 });
  }
}
