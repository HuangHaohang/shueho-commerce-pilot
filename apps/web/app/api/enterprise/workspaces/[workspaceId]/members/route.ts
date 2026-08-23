import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAgentContext } from "@/lib/agent/http";
import { requireEnterpriseTenantPermission } from "@/lib/enterprise/context";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";
import {
  EnterpriseWorkspaceError,
  upsertEnterpriseWorkspaceMember,
} from "@/lib/enterprise/workspaces";

const bodySchema = z.object({
  userId: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),
  roleKeys: z.array(z.string().min(1).max(64)).min(1).max(8).refine((keys) => new Set(keys).size === keys.length),
});

export async function POST(
  request: Request,
  routeContext: { params: Promise<{ workspaceId: string }> },
) {
  const access = await requireAgentContext(request, "workspaces.manage");
  if (!access.ok) return access.response;
  const deniedWorkspace = requireEnterpriseTenantPermission(access.context, "workspaces.manage");
  const deniedMembers = requireEnterpriseTenantPermission(access.context, "members.manage");
  if (deniedWorkspace) return deniedWorkspace;
  if (deniedMembers) return deniedMembers;
  const { workspaceId } = await routeContext.params;
  const parsedWorkspace = z.string().uuid().safeParse(workspaceId);
  const parsedBody = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsedWorkspace.success || !parsedBody.success) {
    return NextResponse.json({ error: "工作区成员授权格式不正确。" }, { status: 400 });
  }
  const rateLimited = await enforceEnterpriseRateLimit(access.context, "workspace.member.roles.set", 60, 3600);
  if (rateLimited) return rateLimited;
  try {
    await upsertEnterpriseWorkspaceMember(
      access.context,
      parsedWorkspace.data,
      parsedBody.data.userId,
      parsedBody.data.roleKeys,
    );
    return NextResponse.json({ updated: true });
  } catch (error) {
    if (error instanceof EnterpriseWorkspaceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "无法更新工作区成员授权。" }, { status: 503 });
  }
}
