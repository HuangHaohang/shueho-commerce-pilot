import { NextResponse } from "next/server";

import { AGENT_ID_PATTERN, gatewayHeaders, gatewayUrl, requireAgentThreadOwner } from "@/lib/agent/http";
import { getAuthenticatedUserId } from "@/lib/auth/require-session";
import { markAgentThreadRunning } from "@/lib/agent/thread-ownership";

const effortValues = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  if (!AGENT_ID_PATTERN.test(threadId)) {
    return NextResponse.json({ error: "会话标识无效。" }, { status: 400 });
  }
  const unauthorized = await requireAgentThreadOwner(request, threadId);
  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json().catch(() => null)) as {
    message?: unknown;
    model?: unknown;
    effort?: unknown;
  } | null;
  if (!body || typeof body.message !== "string" || !body.message.trim() || body.message.length > 50_000) {
    return NextResponse.json({ error: "请输入有效内容。" }, { status: 400 });
  }
  if (typeof body.model !== "string" || body.model.length > 128) {
    return NextResponse.json({ error: "请选择有效模型。" }, { status: 400 });
  }

  const effort = typeof body.effort === "string" && effortValues.has(body.effort) ? body.effort : undefined;
  try {
    const response = await fetch(gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}/turns`), {
      method: "POST",
      headers: gatewayHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        message: body.message.trim(),
        model: body.model,
        effort,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !payload) {
      return NextResponse.json(payload ?? { error: "Agent Gateway 返回了无效响应。" }, { status: response.status });
    }
    const result = isRecord(payload.result) ? payload.result : null;
    const turn = result && isRecord(result.turn) ? result.turn : null;
    const turnId = turn && typeof turn.id === "string" ? turn.id : null;
    if (!turnId) {
      return NextResponse.json({ error: "Agent Gateway 未返回任务标识。" }, { status: 502 });
    }
    const userId = await getAuthenticatedUserId(request);
    if (userId) {
      await markAgentThreadRunning(threadId, userId, turnId);
    }
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
    return NextResponse.json({ error: "无法启动 Agent 任务。" }, { status: 503 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
