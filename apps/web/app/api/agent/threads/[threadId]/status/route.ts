import { NextResponse } from "next/server";

import { AGENT_ID_PATTERN, gatewayHeaders, gatewayUrl, requireAgentThreadContext } from "@/lib/agent/http";

export async function GET(request: Request, routeContext: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await routeContext.params;
  if (!AGENT_ID_PATTERN.test(threadId)) {
    return NextResponse.json({ error: "会话标识无效。" }, { status: 400 });
  }
  const access = await requireAgentThreadContext(request, threadId);
  if (!access.ok) return access.response;

  try {
    const response = await fetch(gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}/status`), {
      headers: gatewayHeaders(undefined, access.context),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !payload) {
      return NextResponse.json(payload ?? { error: "Agent Gateway 返回了无效响应。" }, { status: response.status });
    }
    const result = isRecord(payload.result) ? payload.result : null;
    const thread = result && isRecord(result.thread) ? result.thread : null;
    const lastTurn = isRecord(payload.lastTurn) ? payload.lastTurn : null;
    const threadStatus = thread && isRecord(thread.status) && typeof thread.status.type === "string"
      ? thread.status.type
      : "idle";
    const turnStatus = lastTurn && typeof lastTurn.status === "string" ? lastTurn.status : null;
    return NextResponse.json(
      {
        thread: {
          id: threadId,
          lastTurnId: lastTurn && typeof lastTurn.id === "string" ? lastTurn.id : null,
          status: normalizeStatus(turnStatus, threadStatus),
          durationMs: lastTurn && typeof lastTurn.durationMs === "number" ? lastTurn.durationMs : null,
          startedAt:
            lastTurn && typeof lastTurn.startedAt === "number"
              ? new Date(lastTurn.startedAt * 1_000).toISOString()
              : null,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Agent Gateway 暂时不可用。" }, { status: 503 });
  }
}

function normalizeStatus(
  turnStatus: string | null,
  threadStatus: string,
): "idle" | "running" | "completed" | "interrupted" | "failed" {
  if (threadStatus === "active" || turnStatus === "inProgress" || turnStatus === "running") return "running";
  if (turnStatus === "failed") return "failed";
  if (turnStatus === "interrupted") return "interrupted";
  return turnStatus ? "completed" : "idle";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
