import { NextResponse } from "next/server";

import { AGENT_ID_PATTERN, gatewayHeaders, gatewayUrl, requireAgentThreadOwner } from "@/lib/agent/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const threadId = new URL(request.url).searchParams.get("threadId") || "";
  if (!AGENT_ID_PATTERN.test(threadId)) {
    return NextResponse.json({ error: "会话标识无效。" }, { status: 400 });
  }
  const unauthorized = await requireAgentThreadOwner(request, threadId);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const upstream = await fetch(
      gatewayUrl(`/api/codex/events?threadId=${encodeURIComponent(threadId)}`),
      { headers: gatewayHeaders(), cache: "no-store", signal: request.signal },
    );
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "事件流不可用。" }, { status: 502 });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return NextResponse.json({ error: "无法连接 Agent 事件流。" }, { status: 503 });
  }
}
