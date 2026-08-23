import { NextResponse } from "next/server";

import { requireAgentContext } from "@/lib/agent/http";
import { requireEnterpriseTenantPermission } from "@/lib/enterprise/context";
import { withEnterpriseTenantDatabaseContext } from "@/lib/enterprise/database-context";

export async function GET(request: Request) {
  const access = await requireAgentContext(request, "audit.read");
  if (!access.ok) return access.response;
  const tenantDenied = requireEnterpriseTenantPermission(access.context, "audit.read");
  if (tenantDenied) return tenantDenied;
  const url = new URL(request.url);
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") || "100", 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(200, Math.max(1, requestedLimit)) : 100;
  const beforeValue = url.searchParams.get("before");
  const before = beforeValue && !Number.isNaN(Date.parse(beforeValue)) ? new Date(beforeValue) : null;
  try {
    const events = await withEnterpriseTenantDatabaseContext(access.context, async (client) => {
      const result = await client.query<{
        id: string;
        workspace_id: string | null;
        actor_user_id: string | null;
        action: string;
        target_type: string;
        target_id: string | null;
        outcome: string;
        metadata: Record<string, unknown>;
        created_at: Date;
      }>(
        `
          SELECT id::text, workspace_id, actor_user_id, action, target_type,
                 target_id, outcome, metadata, created_at
          FROM commerce_enterprise_audit_event
          WHERE tenant_id = $1 AND ($2::timestamptz IS NULL OR created_at < $2)
          ORDER BY created_at DESC, id DESC
          LIMIT $3
        `,
        [access.context.tenantId, before, limit],
      );
      return result.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        actorUserId: row.actor_user_id,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        outcome: row.outcome,
        metadata: row.metadata,
        createdAt: row.created_at.toISOString(),
      }));
    });
    return NextResponse.json({ events }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "无法读取企业审计事件。" }, { status: 503 });
  }
}
