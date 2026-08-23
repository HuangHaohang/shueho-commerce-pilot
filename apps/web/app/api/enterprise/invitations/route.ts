import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAgentContext } from "@/lib/agent/http";
import { requireEnterpriseTenantPermission } from "@/lib/enterprise/context";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";
import {
  createEnterpriseInvitation,
  EnterpriseInvitationError,
  listEnterpriseInvitations,
} from "@/lib/enterprise/invitations";

const invitationSchema = z.object({
  email: z.string().trim().email().max(254),
  roleKeys: z
    .array(z.string().trim().min(1).max(64))
    .min(1)
    .max(8)
    .refine((keys) => new Set(keys).size === keys.length)
    .default(["tenant_member", "workspace_operator"]),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export async function GET(request: Request) {
  const access = await requireAgentContext(request, "members.read");
  if (!access.ok) return access.response;
  const tenantDenied = requireEnterpriseTenantPermission(access.context, "members.read");
  if (tenantDenied) return tenantDenied;
  try {
    const invitations = await listEnterpriseInvitations(access.context);
    return NextResponse.json({ invitations }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "无法读取企业邀请。" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const access = await requireAgentContext(request, "members.manage");
  if (!access.ok) return access.response;
  const tenantDenied = requireEnterpriseTenantPermission(access.context, "members.manage");
  if (tenantDenied) return tenantDenied;
  const rateLimited = await enforceEnterpriseRateLimit(access.context, "membership.invite", 20, 3600);
  if (rateLimited) return rateLimited;
  const parsed = invitationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "邀请信息格式不正确。" }, { status: 400 });
  try {
    const invitation = await createEnterpriseInvitation(access.context, parsed.data);
    const origin = new URL(request.url).origin;
    return NextResponse.json(
      {
        invitation: {
          id: invitation.id,
          expiresAt: invitation.expiresAt,
          // URL fragments never reach Next.js, reverse proxies, CDN access logs,
          // or referrer headers. The browser moves the bearer token into memory.
          inviteUrl: `${origin}/invite#token=${encodeURIComponent(invitation.token)}`,
        },
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof EnterpriseInvitationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "无法创建企业邀请。" }, { status: 503 });
  }
}
