import { NextResponse } from "next/server";

import {
  AGENT_ID_PATTERN,
  gatewayHeaders,
  gatewayUrl,
  requireAgentThreadOwner,
} from "@/lib/agent/http";

export async function GET(request: Request, context: { params: Promise<{ threadId: string }> }) {
  return proxyQueueRequest(request, context, "GET");
}

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  return proxyQueueRequest(request, context, "POST");
}

async function proxyQueueRequest(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
  method: "GET" | "POST",
) {
  const { threadId } = await context.params;
  if (!AGENT_ID_PATTERN.test(threadId)) {
    return NextResponse.json({ error: "会话标识无效。" }, { status: 400 });
  }
  const unauthorized = await requireAgentThreadOwner(request, threadId);
  if (unauthorized) {
    return unauthorized;
  }
  let body: string | undefined;
  if (method === "POST") {
    const payload = (await request.json().catch(() => null)) as { message?: unknown } | null;
    const message = typeof payload?.message === "string" ? payload.message.trim() : "";
    if (!message || message.length > 50_000) {
      return NextResponse.json({ error: "排队消息长度必须在 1 到 50000 个字符之间。" }, { status: 400 });
    }
    body = JSON.stringify({ message });
  }
  try {
    const response = await fetch(gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}/queue`), {
      method,
      headers: gatewayHeaders(body ? { "Content-Type": "application/json" } : undefined),
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => ({ error: "Agent Gateway 返回了无效响应。" }));
    return NextResponse.json(payload, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "无法读取或更新任务队列。" }, { status: 503 });
  }
}
