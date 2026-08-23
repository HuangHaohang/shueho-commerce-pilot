import { NextResponse } from "next/server";

import {
  AGENT_ID_PATTERN,
  gatewayHeaders,
  gatewayUrl,
  requireAgentThreadContext,
} from "@/lib/agent/http";
import { releaseAgentTurnLease, reserveAgentTurn } from "@/lib/enterprise/quota";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  if (!AGENT_ID_PATTERN.test(threadId)) {
    return NextResponse.json({ error: "会话标识无效。" }, { status: 400 });
  }
  const access = await requireAgentThreadContext(request, threadId, "thread.compact");
  if (!access.ok) return access.response;
  const rateLimited = await enforceEnterpriseRateLimit(access.context, "thread.compact", 20, 60);
  if (rateLimited) return rateLimited;
  const body = (await request.json().catch(() => null)) as { clientRequestId?: unknown } | null;
  const clientRequestId =
    typeof body?.clientRequestId === "string" && /^[0-9a-f-]{36}$/i.test(body.clientRequestId)
      ? body.clientRequestId
      : crypto.randomUUID();
  const reservation = await reserveAgentTurn(access.context, threadId, clientRequestId).catch(() => null);
  if (!reservation) return NextResponse.json({ error: "企业额度服务暂时不可用。" }, { status: 503 });
  if (!reservation.ok) {
    return NextResponse.json(
      { error: reservation.error, code: reservation.code },
      { status: reservation.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (reservation.duplicate) {
    return NextResponse.json(
      { error: "该上下文整理请求已被接收。", code: "IDEMPOTENT_REQUEST_REPLAY" },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const response = await fetch(
      gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}/compact`),
      {
        method: "POST",
        headers: gatewayHeaders({ "Content-Type": "application/json" }, access.context),
        body: JSON.stringify({ clientRequestId }),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
    );
    const payload = (await response.json().catch(() => ({ error: "Agent Gateway 返回了无效响应。" }))) as {
      accepted?: unknown;
      alreadyRunning?: unknown;
      error?: unknown;
    };
    if (!response.ok || payload.accepted !== true || payload.alreadyRunning === true) {
      await releaseAgentTurnLease(access.context, reservation.leaseId);
    }
    return NextResponse.json(payload, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "无法启动上下文整理。" }, { status: 503 });
  }
}
