import { NextResponse } from "next/server";

import {
  AGENT_ID_PATTERN,
  gatewayHeaders,
  gatewayUrl,
  requireAgentThreadOwner,
} from "@/lib/agent/http";
import { markAgentThreadRunning } from "@/lib/agent/thread-ownership";
import { getAuthenticatedUserId } from "@/lib/auth/require-session";

export async function POST(
  request: Request,
  context: { params: Promise<{ threadId: string; queuedSubmissionId: string }> },
) {
  const { threadId, queuedSubmissionId } = await context.params;
  if (!AGENT_ID_PATTERN.test(threadId) || !AGENT_ID_PATTERN.test(queuedSubmissionId)) {
    return NextResponse.json({ error: "会话或排队消息标识无效。" }, { status: 400 });
  }
  const unauthorized = await requireAgentThreadOwner(request, threadId);
  if (unauthorized) {
    return unauthorized;
  }
  const body = (await request.json().catch(() => null)) as {
    expectedTurnId?: unknown;
    clientUserMessageId?: unknown;
  } | null;
  const expectedTurnId = typeof body?.expectedTurnId === "string" ? body.expectedTurnId : "";
  const clientUserMessageId =
    typeof body?.clientUserMessageId === "string" ? body.clientUserMessageId : "";
  if (!AGENT_ID_PATTERN.test(expectedTurnId) || !AGENT_ID_PATTERN.test(clientUserMessageId)) {
    return NextResponse.json({ error: "当前任务或排队消息标识无效。" }, { status: 400 });
  }
  try {
    const response = await fetch(
      gatewayUrl(
        `/api/threads/${encodeURIComponent(threadId)}/queue/${encodeURIComponent(queuedSubmissionId)}/steer`,
      ),
      {
        method: "POST",
        headers: gatewayHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ expectedTurnId, clientUserMessageId }),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
    );
    const payload = (await response.json().catch(() => ({ error: "Agent Gateway 返回了无效响应。" }))) as Record<string, unknown>;
    if (response.ok && isRecord(payload.result)) {
      const startedTurnId = typeof payload.result.turnId === "string" ? payload.result.turnId : null;
      if (
        (payload.result.mode === "startedAfterTurnEnded" ||
          payload.result.mode === "alreadyStarted" ||
          payload.result.mode === "interruptedAndResubmitted") &&
        startedTurnId
      ) {
        const userId = await getAuthenticatedUserId(request);
        if (userId) {
          await markAgentThreadRunning(threadId, userId, startedTurnId);
        }
      }
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
    return NextResponse.json({ error: "无法调整当前任务方向。" }, { status: 503 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
