import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAgentContext } from "@/lib/agent/http";
import { withEnterpriseTenantDatabaseContext } from "@/lib/enterprise/database-context";

const bodySchema = z.object({ workspaceId: z.string().uuid() });

export async function POST(request: Request) {
  const access = await requireAgentContext(request, "workspaces.read");
  if (!access.ok) return access.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "工作区标识无效。" }, { status: 400 });
  const allowed = await withEnterpriseTenantDatabaseContext(access.context, async (client) => {
    const result = await client.query(
      `
        SELECT 1 FROM commerce_workspace_membership member
        INNER JOIN commerce_workspace workspace
          ON workspace.tenant_id = member.tenant_id AND workspace.id = member.workspace_id
        WHERE member.tenant_id = $1 AND member.workspace_id = $2 AND member.user_id = $3
          AND member.status = 'active' AND workspace.status = 'active'
        LIMIT 1
      `,
      [access.context.tenantId, parsed.data.workspaceId, access.context.userId],
    );
    return result.rowCount === 1;
  });
  if (!allowed) return NextResponse.json({ error: "您没有该工作区的访问权限。" }, { status: 403 });
  const response = NextResponse.json({ selected: true, workspaceId: parsed.data.workspaceId });
  response.cookies.set("commerce_workspace", parsed.data.workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
