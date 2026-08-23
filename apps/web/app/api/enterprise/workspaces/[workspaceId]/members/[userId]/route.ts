import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAgentContext } from "@/lib/agent/http";
import { requireEnterpriseTenantPermission } from "@/lib/enterprise/context";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";
import {
  EnterpriseWorkspaceError,
  removeEnterpriseWorkspaceMember,
} from "@/lib/enterprise/workspaces";

export async function DELETE(
  request: Request,
  routeContext: { params: Promise<{ workspaceId: string; userId: string }> },
) {
  const access = await requireAgentContext(request, "workspaces.manage");
  if (!access.ok) return access.response;
  const deniedWorkspace = requireEnterpriseTenantPermission(access.context, "workspaces.manage");
  const deniedMembers = requireEnterpriseTenantPermission(access.context, "members.manage");
  if (deniedWorkspace) return deniedWorkspace;
  if (deniedMembers) return deniedMembers;
  const { workspaceId, userId } = await routeContext.params;
  const parsedWorkspace = z.string().uuid().safeParse(workspaceId);
  const parsedUser = z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/).safeParse(userId);
  if (!parsedWorkspace.success || !parsedUser.success) {
    return NextResponse.json({ error: "工作区或成员标识无效。" }, { status: 400 });
  }
  const rateLimited = await enforceEnterpriseRateLimit(access.context, "workspace.member.remove", 60, 3600);
  if (rateLimited) return rateLimited;
  try {
    await removeEnterpriseWorkspaceMember(access.context, parsedWorkspace.data, parsedUser.data);
    return NextResponse.json({ removed: true });
  } catch (error) {
    if (error instanceof EnterpriseWorkspaceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "无法移除工作区成员。" }, { status: 503 });
  }
}
