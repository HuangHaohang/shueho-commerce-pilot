import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedUserId } from "@/lib/auth/require-session";
import {
  acceptEnterpriseInvitation,
  EnterpriseInvitationError,
} from "@/lib/enterprise/invitations";

const bodySchema = z.object({ token: z.string().min(32).max(512) });

export async function POST(request: Request) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) return NextResponse.json({ error: "请先登录后接受企业邀请。" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "邀请 token 无效。" }, { status: 400 });
  try {
    const accepted = await acceptEnterpriseInvitation(userId, parsed.data.token);
    return NextResponse.json(
      { accepted: true, tenantId: accepted.tenantId, workspaceId: accepted.workspaceId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof EnterpriseInvitationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "无法接受企业邀请。" }, { status: 503 });
  }
}
