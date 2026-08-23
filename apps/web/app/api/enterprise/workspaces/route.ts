import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAgentContext } from "@/lib/agent/http";
import { requireEnterpriseTenantPermission } from "@/lib/enterprise/context";
import {
  createEnterpriseWorkspace,
  EnterpriseWorkspaceError,
  listEnterpriseWorkspaces,
} from "@/lib/enterprise/workspaces";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";

const createSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  name: z.string().trim().min(1).max(80),
});

export async function GET(request: Request) {
  const access = await requireAgentContext(request, "workspaces.read");
  if (!access.ok) return access.response;
  const tenantDenied = requireEnterpriseTenantPermission(access.context, "workspaces.read");
  if (tenantDenied) return tenantDenied;
  const workspaces = await listEnterpriseWorkspaces(access.context);
  return NextResponse.json(
    { workspaces, workspaceLimit: access.context.contract.workspaceLimit },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const access = await requireAgentContext(request, "workspaces.manage");
  if (!access.ok) return access.response;
  const tenantDenied = requireEnterpriseTenantPermission(access.context, "workspaces.manage");
  if (tenantDenied) return tenantDenied;
  const rateLimited = await enforceEnterpriseRateLimit(access.context, "workspace.create", 10, 3600);
  if (rateLimited) return rateLimited;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "工作区信息格式不正确。" }, { status: 400 });
  try {
    const workspace = await createEnterpriseWorkspace(access.context, parsed.data);
    return NextResponse.json({ workspace }, { status: 201 });
  } catch (error) {
    if (error instanceof EnterpriseWorkspaceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "无法创建工作区。" }, { status: 503 });
  }
}
