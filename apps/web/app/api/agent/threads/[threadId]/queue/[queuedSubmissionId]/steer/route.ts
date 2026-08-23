import { NextResponse } from "next/server";

import {
  AGENT_ID_PATTERN,
  gatewayHeaders,
  gatewayUrl,
  requireAgentThreadContext,
} from "@/lib/agent/http";
import { markAgentThreadRunning } from "@/lib/agent/thread-ownership";
import {
  activateAgentTurnLease,
  releaseAgentTurnLease,
  reserveAgentTurn,
} from "@/lib/enterprise/quota";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  context: { params: Promise<{ threadId: string; queuedSubmissionId: string }> },
) {
  const { threadId, queuedSubmissionId } = await context.params;
  if (!AGENT_ID_PATTERN.test(threadId) || !AGENT_ID_PATTERN.test(queuedSubmissionId)) {
    return NextResponse.json({ error: "会话或排队消息标识无效。" }, { status: 400 });
  }
  const access = await requireAgentThreadContext(request, threadId, "queue.manage");
  if (!access.ok) return access.response;
  const body = (await request.json().catch(() => null)) as {
    expectedTurnId?: unknown;
    clientUserMessageId?: unknown;
  } | null;
  const expectedTurnId = typeof body?.expectedTurnId === "string" ? body.expectedTurnId : "";
  const clientUserMessageId =
    typeof body?.clientUserMessageId === "string" ? body.clientUserMessageId : "";
  if (!AGENT_ID_PATTERN.test(expectedTurnId) || !UUID_PATTERN.test(clientUserMessageId)) {
    return NextResponse.json({ error: "当前任务或排队消息标识无效。" }, { status: 400 });
  }
  const reservation = await reserveAgentTurn(
    access.context,
    threadId,
    clientUserMessageId,
    { allowReleasedRetry: true },
  ).catch(() => null);
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
      { error: "该排队请求正在处理，请勿重复提交。", code: "IDEMPOTENT_REQUEST_REPLAY" },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const response = await fetch(
      gatewayUrl(
        `/api/threads/${encodeURIComponent(threadId)}/queue/${encodeURIComponent(queuedSubmissionId)}/steer`,
      ),
      {
        method: "POST",
        headers: gatewayHeaders({ "Content-Type": "application/json" }, access.context),
        body: JSON.stringify({ expectedTurnId, clientUserMessageId }),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
    );
    const payload = (await response.json().catch(() => ({ error: "Agent Gateway 返回了无效响应。" }))) as Record<string, unknown>;
    if (response.ok) {
      if (!isRecord(payload.result)) {
        await releaseAgentTurnLease(access.context, reservation.leaseId);
        return NextResponse.json(
          { error: "Agent Gateway 未返回有效的队列执行结果。" },
          { status: 502, headers: { "Cache-Control": "no-store" } },
        );
      }
      const startedTurnId = typeof payload.result.turnId === "string" ? payload.result.turnId : null;
      if (
        (payload.result.mode === "startedAfterTurnEnded" ||
          payload.result.mode === "interruptedAndResubmitted") &&
        startedTurnId
      ) {
        await activateAgentTurnLease(access.context, reservation.leaseId, startedTurnId);
        await markAgentThreadRunning(threadId, access.context, startedTurnId);
      } else {
        await releaseAgentTurnLease(access.context, reservation.leaseId);
      }
    } else {
      await releaseAgentTurnLease(access.context, reservation.leaseId);
    }
    if (!response.ok && response.status === 409) {
      return NextResponse.json(
        { error: "任务方向刚刚发生变化，这条消息仍保留在队列中，请重新选择调整方向。" },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (!response.ok && response.status === 404) {
      return NextResponse.json(
        { error: "这条排队消息已经被处理，请刷新后重试。" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(payload, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    // Keep an ambiguous upstream reservation until its short expiry. Releasing
    // it could admit excess work after the Gateway accepted a turn but the
    // response connection failed.
    return NextResponse.json({ error: "无法调整当前任务方向。" }, { status: 503 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
