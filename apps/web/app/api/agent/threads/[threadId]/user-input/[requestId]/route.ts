import { NextResponse } from "next/server";

import { AGENT_ID_PATTERN, gatewayHeaders, gatewayUrl, requireAgentThreadContext } from "@/lib/agent/http";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export async function POST(
  request: Request,
  context: { params: Promise<{ threadId: string; requestId: string }> },
) {
  const { threadId, requestId } = await context.params;
  if (!AGENT_ID_PATTERN.test(threadId) || !REQUEST_ID_PATTERN.test(requestId)) {
    return NextResponse.json({ error: "问题请求标识无效。" }, { status: 400 });
  }
  const access = await requireAgentThreadContext(request, threadId, "agent.run");
  if (!access.ok) return access.response;
  const body = (await request.json().catch(() => null)) as { answers?: unknown } | null;
  if (!body || !body.answers || typeof body.answers !== "object" || Array.isArray(body.answers)) {
    return NextResponse.json({ error: "请选择或填写答案。" }, { status: 400 });
  }

  try {
    const response = await fetch(
      gatewayUrl(
        `/api/threads/${encodeURIComponent(threadId)}/user-input/${encodeURIComponent(requestId)}`,
      ),
      {
        method: "POST",
        headers: gatewayHeaders({ "Content-Type": "application/json" }, access.context),
        body: JSON.stringify({ answers: body.answers }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    const payload = await response.json().catch(() => null);
    return NextResponse.json(payload ?? { error: "Agent Gateway 返回了无效响应。" }, { status: response.status });
  } catch {
    return NextResponse.json({ error: "无法提交答案。" }, { status: 503 });
  }
}
