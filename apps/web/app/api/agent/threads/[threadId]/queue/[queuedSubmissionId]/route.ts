import { NextResponse } from "next/server";

import {
  AGENT_ID_PATTERN,
  gatewayHeaders,
  gatewayUrl,
  requireAgentThreadContext,
} from "@/lib/agent/http";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ threadId: string; queuedSubmissionId: string }> },
) {
  return proxyQueueItemRequest(request, context, "PATCH");
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ threadId: string; queuedSubmissionId: string }> },
) {
  return proxyQueueItemRequest(request, context, "DELETE");
}

async function proxyQueueItemRequest(
  request: Request,
  context: { params: Promise<{ threadId: string; queuedSubmissionId: string }> },
  method: "PATCH" | "DELETE",
) {
  const { threadId, queuedSubmissionId } = await context.params;
  if (!AGENT_ID_PATTERN.test(threadId) || !AGENT_ID_PATTERN.test(queuedSubmissionId)) {
    return NextResponse.json({ error: "会话或排队消息标识无效。" }, { status: 400 });
  }
  const access = await requireAgentThreadContext(request, threadId, "queue.manage");
  if (!access.ok) return access.response;
  let body: string | undefined;
  if (method === "PATCH") {
    const payload = (await request.json().catch(() => null)) as { message?: unknown } | null;
    const message = typeof payload?.message === "string" ? payload.message.trim() : "";
    if (!message || message.length > 50_000) {
      return NextResponse.json({ error: "排队消息长度必须在 1 到 50000 个字符之间。" }, { status: 400 });
    }
    body = JSON.stringify({ message });
  }
  try {
    const response = await fetch(
      gatewayUrl(
        `/api/threads/${encodeURIComponent(threadId)}/queue/${encodeURIComponent(queuedSubmissionId)}`,
      ),
      {
        method,
        headers: gatewayHeaders(body ? { "Content-Type": "application/json" } : undefined, access.context),
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      },
    );
    const payload = await response.json().catch(() => ({ error: "Agent Gateway 返回了无效响应。" }));
    return NextResponse.json(payload, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "无法更新排队消息。" }, { status: 503 });
  }
}
