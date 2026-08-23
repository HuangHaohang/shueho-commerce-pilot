import { NextResponse } from "next/server";

import { AGENT_ID_PATTERN, gatewayHeaders, gatewayUrl, requireAgentThreadContext } from "@/lib/agent/http";
import { markAgentThreadRunning } from "@/lib/agent/thread-ownership";
import {
  activateAgentTurnLease,
  releaseAgentTurnLease,
  reserveAgentTurn,
} from "@/lib/enterprise/quota";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";

const effortValues = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  if (!AGENT_ID_PATTERN.test(threadId)) {
    return NextResponse.json({ error: "会话标识无效。" }, { status: 400 });
  }
  const access = await requireAgentThreadContext(request, threadId, "agent.run");
  if (!access.ok) return access.response;
  const enterpriseContext = access.context;

  const body = (await request.json().catch(() => null)) as {
    message?: unknown;
    model?: unknown;
    effort?: unknown;
    clientRequestId?: unknown;
  } | null;
  if (!body || typeof body.message !== "string" || !body.message.trim() || body.message.length > 50_000) {
    return NextResponse.json({ error: "请输入有效内容。" }, { status: 400 });
  }
  if (typeof body.model !== "string" || body.model.length > 128) {
    return NextResponse.json({ error: "请选择有效模型。" }, { status: 400 });
  }

  const effort = typeof body.effort === "string" && effortValues.has(body.effort) ? body.effort : undefined;
  const clientRequestId =
    typeof body.clientRequestId === "string" && /^[0-9a-f-]{36}$/i.test(body.clientRequestId)
      ? body.clientRequestId
      : crypto.randomUUID();
  const rateLimited = await enforceEnterpriseRateLimit(enterpriseContext, "turn.start", 60, 60);
  if (rateLimited) return rateLimited;
  const reservation = await reserveAgentTurn(enterpriseContext, threadId, clientRequestId).catch(() => null);
  if (!reservation) {
    return NextResponse.json({ error: "企业额度服务暂时不可用。" }, { status: 503 });
  }
  if (!reservation.ok) {
    return NextResponse.json(
      { error: reservation.error, code: reservation.code },
      { status: reservation.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (reservation.duplicate) {
    return NextResponse.json(
      { error: "该请求已被接收，请勿重复提交。", code: "IDEMPOTENT_REQUEST_REPLAY" },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const response = await fetch(gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}/turns`), {
      method: "POST",
      headers: gatewayHeaders({ "Content-Type": "application/json" }, enterpriseContext),
      body: JSON.stringify({
        message: body.message.trim(),
        model: body.model,
        effort,
        clientRequestId,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !payload) {
      await releaseAgentTurnLease(enterpriseContext, reservation.leaseId);
      if (response.status === 409 && payload?.code === "THREAD_STARTING") {
        return NextResponse.json({ error: "当前任务正在启动，请稍后重试。" }, { status: 409 });
      }
      return NextResponse.json(payload ?? { error: "Agent Gateway 返回了无效响应。" }, { status: response.status });
    }
    if (response.status === 202 && payload.queued === true) {
      const activeTurnId = typeof payload.activeTurnId === "string" ? payload.activeTurnId : null;
      if (activeTurnId) {
        await markAgentThreadRunning(threadId, enterpriseContext, activeTurnId);
      }
      await releaseAgentTurnLease(enterpriseContext, reservation.leaseId);
      return NextResponse.json(payload, {
        status: 202,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const result = isRecord(payload.result) ? payload.result : null;
    const turn = result && isRecord(result.turn) ? result.turn : null;
    const turnId = turn && typeof turn.id === "string" ? turn.id : null;
    if (!turnId) {
      await releaseAgentTurnLease(enterpriseContext, reservation.leaseId);
      return NextResponse.json({ error: "Agent Gateway 未返回任务标识。" }, { status: 502 });
    }
    await activateAgentTurnLease(enterpriseContext, reservation.leaseId, turnId);
    await markAgentThreadRunning(threadId, enterpriseContext, turnId);
    return NextResponse.json(
      {
        result: {
          turn: {
            id: turnId,
            status: turn && typeof turn.status === "string" ? turn.status : "inProgress",
          },
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // The Gateway may have accepted the turn before the response connection
    // failed. Keep the short-lived reservation so an ambiguous retry cannot
    // over-admit concurrent work; terminal readback or expiry releases it.
    return NextResponse.json({ error: "无法启动 Agent 任务。" }, { status: 503 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
