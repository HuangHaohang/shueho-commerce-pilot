import { NextResponse } from "next/server";

import { resolveEnterpriseContext } from "@/lib/enterprise/context";

export async function GET(request: Request) {
  const result = await resolveEnterpriseContext(request, { requireActiveContract: false });
  if (!result.ok) return result.response;
  const { context } = result;
  return NextResponse.json(
    {
      organization: {
        id: context.organizationId,
        slug: context.organizationSlug,
        name: context.organizationName,
        status: context.organizationStatus,
      },
      tenant: {
        id: context.tenantId,
        slug: context.tenantSlug,
        name: context.tenantName,
        status: context.tenantStatus,
        edition: "enterprise",
      },
      workspace: {
        id: context.workspaceId,
        slug: context.workspaceSlug,
        name: context.workspaceName,
      },
      roleKeys: context.roleKeys,
      permissions: [...context.permissions].sort(),
      tenantPermissions: [...context.tenantPermissions].sort(),
      contract: context.contract,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
