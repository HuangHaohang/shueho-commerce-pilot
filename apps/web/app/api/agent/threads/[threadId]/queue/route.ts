import { NextResponse } from "next/server";

import {
  AGENT_ID_PATTERN,
  gatewayHeaders,
  gatewayUrl,
  requireAgentThreadContext,
} from "@/lib/agent/http";
import { getAgentThreadForUser } from "@/lib/agent/thread-ownership";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";

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
  const access = await requireAgentThreadContext(request, threadId, "queue.manage");
  if (!access.ok) return access.response;
  let body: string | undefined;
  if (method === "POST") {
    const rateLimited = await enforceEnterpriseRateLimit(access.context, "queue.add", 120, 60);
    if (rateLimited) return rateLimited;
    const payload = (await request.json().catch(() => null)) as {
      message?: unknown;
      clientRequestId?: unknown;
      workflow?: unknown;
    } | null;
    const message = typeof payload?.message === "string" ? payload.message.trim() : "";
    if (!message || message.length > 50_000) {
      return NextResponse.json({ error: "排队消息长度必须在 1 到 50000 个字符之间。" }, { status: 400 });
    }
    if (payload?.workflow !== undefined) {
      return NextResponse.json(
        { error: "托管工作流运行中必须通过 Harness Turn steering 调整方向。" },
        { status: 400 },
      );
    }
    const thread = await getAgentThreadForUser(threadId, access.context);
    if (!thread) {
      return NextResponse.json({ error: "会话不存在。" }, { status: 404 });
    }
    if (thread.recipeId) {
      return NextResponse.json(
        { error: "托管工作流运行中必须通过 Harness Turn steering 调整方向。" },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    const clientRequestId =
      typeof payload?.clientRequestId === "string" && /^[0-9a-f-]{36}$/i.test(payload.clientRequestId)
        ? payload.clientRequestId
        : crypto.randomUUID();
    body = JSON.stringify({ message, clientRequestId });
  }
  try {
    const response = await fetch(gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}/queue`), {
      method,
      headers: gatewayHeaders(body ? { "Content-Type": "application/json" } : undefined, access.context),
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
