import { NextResponse } from "next/server";

import { AGENT_ID_PATTERN, gatewayHeaders, gatewayUrl, requireAgentThreadContext } from "@/lib/agent/http";

export async function GET(request: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  if (!AGENT_ID_PATTERN.test(threadId)) {
    return NextResponse.json({ error: "会话标识无效。" }, { status: 400 });
  }
  const access = await requireAgentThreadContext(request, threadId);
  if (!access.ok) return access.response;

  try {
    const response = await fetch(
      gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}/user-input`),
      {
        headers: gatewayHeaders(undefined, access.context),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    const payload = await response.json().catch(() => null);
    return NextResponse.json(payload ?? { error: "Agent Gateway 返回了无效响应。" }, { status: response.status });
  } catch {
    return NextResponse.json({ error: "无法读取待回答问题。" }, { status: 503 });
  }
}
