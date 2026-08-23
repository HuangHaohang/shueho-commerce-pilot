import { NextResponse } from "next/server";
import { z } from "zod";

import { gatewayHeaders, gatewayUrl, requireAgentContext } from "@/lib/agent/http";
import { requireEnterpriseTenantPermission } from "@/lib/enterprise/context";
import {
  changeEnterpriseMemberStatus,
  EnterpriseMemberError,
} from "@/lib/enterprise/members";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";

const userIdSchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/);
const bodySchema = z.object({ status: z.enum(["active", "suspended", "removed"]) });

export async function PATCH(
  request: Request,
  routeContext: { params: Promise<{ userId: string }> },
) {
  const access = await requireAgentContext(request, "members.manage");
  if (!access.ok) return access.response;
  const tenantDenied = requireEnterpriseTenantPermission(access.context, "members.manage");
  if (tenantDenied) return tenantDenied;
  const rateLimited = await enforceEnterpriseRateLimit(access.context, "membership.status.change", 60, 3600);
  if (rateLimited) return rateLimited;
  const { userId } = await routeContext.params;
  const parsedUserId = userIdSchema.safeParse(userId);
  const parsedBody = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsedUserId.success || !parsedBody.success) {
    return NextResponse.json({ error: "成员状态请求格式不正确。" }, { status: 400 });
  }
  try {
    const changed = await changeEnterpriseMemberStatus(access.context, parsedUserId.data, parsedBody.data.status);
    if (parsedBody.data.status !== "active") {
      await Promise.allSettled(
        changed.threads.map((thread) =>
          fetch(
            gatewayUrl(
              `/api/threads/${encodeURIComponent(thread.threadId)}/turns/${encodeURIComponent(thread.turnId)}/interrupt`,
            ),
            {
              method: "POST",
              headers: gatewayHeaders(undefined, {
                tenantId: access.context.tenantId,
                workspaceId: thread.workspaceId,
                userId: thread.userId,
              }),
              signal: AbortSignal.timeout(10_000),
            },
          ),
        ),
      );
    }
    return NextResponse.json({ updated: true, previousStatus: changed.previousStatus });
  } catch (error) {
    if (error instanceof EnterpriseMemberError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "无法更新企业成员。" }, { status: 503 });
  }
}
