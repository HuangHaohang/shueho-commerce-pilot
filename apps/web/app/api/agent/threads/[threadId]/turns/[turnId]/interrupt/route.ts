import { NextResponse } from "next/server";

import { AGENT_ID_PATTERN, gatewayHeaders, gatewayUrl, proxyGatewayJson, requireAgentThreadOwner } from "@/lib/agent/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ threadId: string; turnId: string }> },
) {
  const { threadId, turnId } = await context.params;
  if (!AGENT_ID_PATTERN.test(threadId) || !AGENT_ID_PATTERN.test(turnId)) {
    return NextResponse.json({ error: "任务标识无效。" }, { status: 400 });
  }
  const unauthorized = await requireAgentThreadOwner(request, threadId);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const response = await fetch(
      gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/interrupt`),
      {
        method: "POST",
        headers: gatewayHeaders(),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    return proxyGatewayJson(response);
  } catch {
    return NextResponse.json({ error: "无法停止当前任务。" }, { status: 503 });
  }
}
