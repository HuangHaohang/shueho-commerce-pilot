import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAgentContext } from "@/lib/agent/http";
import { requireEnterpriseTenantPermission } from "@/lib/enterprise/context";
import {
  changeEnterpriseWorkspaceStatus,
  EnterpriseWorkspaceError,
} from "@/lib/enterprise/workspaces";

const bodySchema = z.object({ status: z.enum(["active", "archived"]) });

export async function PATCH(
  request: Request,
  routeContext: { params: Promise<{ workspaceId: string }> },
) {
  const access = await requireAgentContext(request, "workspaces.manage");
  if (!access.ok) return access.response;
  const tenantDenied = requireEnterpriseTenantPermission(access.context, "workspaces.manage");
  if (tenantDenied) return tenantDenied;
  const { workspaceId } = await routeContext.params;
  const parsedId = z.string().uuid().safeParse(workspaceId);
  const parsedBody = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsedId.success || !parsedBody.success) {
    return NextResponse.json({ error: "工作区状态请求格式不正确。" }, { status: 400 });
  }
  try {
    await changeEnterpriseWorkspaceStatus(access.context, parsedId.data, parsedBody.data.status);
    return NextResponse.json({ updated: true });
  } catch (error) {
    if (error instanceof EnterpriseWorkspaceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "无法更新工作区。" }, { status: 503 });
  }
}
