import { NextResponse } from "next/server";
import { z } from "zod";

import { isAuthorizedGatewayCallback } from "@/lib/agent/internal-auth";
import {
  attachExistingAgentTurnLease,
  releaseAgentTurnLeaseForRequest,
  reserveAgentTurn,
} from "@/lib/enterprise/quota";
import { authorizeRuntimeScope } from "@/lib/enterprise/runtime-authorization";

const bodySchema = z.object({
  tenantId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  userId: z.string().min(1).max(255),
  rootThreadId: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),
  runtimeMaxAgentThreads: z.number().int().min(1).max(16).optional(),
  requestId: z.string().uuid(),
  kind: z.literal("context_compaction"),
  action: z.enum(["reserve", "release", "attach_or_reserve"]).default("reserve"),
  turnId: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/).optional(),
});

export async function POST(request: Request) {
  if (!isAuthorizedGatewayCallback(request)) {
    return NextResponse.json({ error: "Unauthorized Gateway callback." }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ admitted: false }, { status: 400 });
  const scope = {
    tenantId: parsed.data.tenantId,
    workspaceId: parsed.data.workspaceId,
    userId: parsed.data.userId,
    rootThreadId: parsed.data.rootThreadId,
    runtimeMaxAgentThreads: parsed.data.runtimeMaxAgentThreads,
  };
  try {
    if (parsed.data.action === "release") {
      await releaseAgentTurnLeaseForRequest(scope, parsed.data.rootThreadId, parsed.data.requestId);
      return NextResponse.json({ released: true });
    }
    if (!(await authorizeRuntimeScope(scope))) {
      return NextResponse.json({ admitted: false, code: "ENTERPRISE_AUTHORIZATION_REVOKED" }, { status: 403 });
    }
    if (
      parsed.data.action === "attach_or_reserve" &&
      parsed.data.turnId &&
      (await attachExistingAgentTurnLease(scope, parsed.data.rootThreadId, parsed.data.turnId))
    ) {
      return NextResponse.json({ admitted: true, attached: true });
    }
    const reservation = await reserveAgentTurn(scope, parsed.data.rootThreadId, parsed.data.requestId);
    if (!reservation.ok) {
      return NextResponse.json(
        { admitted: false, code: reservation.code, error: reservation.error },
        { status: reservation.status },
      );
    }
    if (reservation.duplicate) {
      return NextResponse.json({ admitted: false, code: "IDEMPOTENT_REQUEST_REPLAY" }, { status: 409 });
    }
    return NextResponse.json({ admitted: true, leaseId: reservation.leaseId });
  } catch {
    return NextResponse.json({ admitted: false }, { status: 503 });
  }
}
