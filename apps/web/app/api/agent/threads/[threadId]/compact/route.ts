import { NextResponse } from "next/server";

import {
  AGENT_ID_PATTERN,
  gatewayHeaders,
  gatewayUrl,
  requireAgentThreadOwner,
} from "@/lib/agent/http";

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  if (!AGENT_ID_PATTERN.test(threadId)) {
    return NextResponse.json({ error: "会话标识无效。" }, { status: 400 });
  }
  const unauthorized = await requireAgentThreadOwner(request, threadId);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const response = await fetch(
      gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}/compact`),
      {
        method: "POST",
        headers: gatewayHeaders(),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
    );
    const payload = await response.json().catch(() => ({ error: "Agent Gateway 返回了无效响应。" }));
    return NextResponse.json(payload, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "无法启动上下文整理。" }, { status: 503 });
  }
}
