import { NextResponse } from "next/server";
import { z } from "zod";

import { isAuthorizedGatewayCallback } from "@/lib/agent/internal-auth";
import { authorizeRuntimeScope } from "@/lib/enterprise/runtime-authorization";

const bodySchema = z.object({
  tenantId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  userId: z.string().min(1).max(255),
  rootThreadId: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),
  runtimeMaxAgentThreads: z.number().int().min(1).max(16).optional(),
});

export async function POST(request: Request) {
  if (!isAuthorizedGatewayCallback(request)) {
    return NextResponse.json({ error: "Unauthorized Gateway callback." }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ authorized: false }, { status: 400 });
  try {
    const authorized = await authorizeRuntimeScope(parsed.data);
    return NextResponse.json(
      { authorized },
      { status: authorized ? 200 : 403, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ authorized: false }, { status: 503 });
  }
}
