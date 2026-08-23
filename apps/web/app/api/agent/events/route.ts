import { NextResponse } from "next/server";

import { AGENT_ID_PATTERN, gatewayHeaders, gatewayUrl, requireAgentThreadContext } from "@/lib/agent/http";
import { isAgentThreadOwner } from "@/lib/agent/thread-ownership";
import { requireEnterprisePermission, resolveEnterpriseContext } from "@/lib/enterprise/context";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";

export const dynamic = "force-dynamic";
const activeUserStreams = new Map<string, number>();
const activeTenantStreams = new Map<string, number>();
const MAX_STREAMS_PER_USER = 5;
const MAX_STREAMS_PER_TENANT = 300;
const MAX_STREAM_LIFETIME_MS = 30 * 60_000;

export async function GET(request: Request) {
  const threadId = new URL(request.url).searchParams.get("threadId") || "";
  if (!AGENT_ID_PATTERN.test(threadId)) {
    return NextResponse.json({ error: "会话标识无效。" }, { status: 400 });
  }
  const access = await requireAgentThreadContext(request, threadId);
  if (!access.ok) return access.response;
  const rateLimited = await enforceEnterpriseRateLimit(access.context, "sse.connect", 30, 60);
  if (rateLimited) return rateLimited;
  const userKey = `${access.context.tenantId}:${access.context.userId}`;
  const tenantKey = access.context.tenantId;
  if (
    (activeUserStreams.get(userKey) ?? 0) >= MAX_STREAMS_PER_USER ||
    (activeTenantStreams.get(tenantKey) ?? 0) >= MAX_STREAMS_PER_TENANT
  ) {
    return NextResponse.json(
      { error: "事件流连接数已达到上限。", code: "SSE_CONNECTION_LIMIT" },
      { status: 429, headers: { "Retry-After": "15" } },
    );
  }
  activeUserStreams.set(userKey, (activeUserStreams.get(userKey) ?? 0) + 1);
  activeTenantStreams.set(tenantKey, (activeTenantStreams.get(tenantKey) ?? 0) + 1);
  let connectionReleased = false;
  const releaseConnection = () => {
    if (connectionReleased) return;
    connectionReleased = true;
    decrement(activeUserStreams, userKey);
    decrement(activeTenantStreams, tenantKey);
  };

  try {
    const revocation = new AbortController();
    const upstream = await fetch(
      gatewayUrl(`/api/codex/events?threadId=${encodeURIComponent(threadId)}`),
      {
        headers: gatewayHeaders(undefined, access.context),
        cache: "no-store",
        signal: AbortSignal.any([request.signal, revocation.signal]),
      },
    );
    if (!upstream.ok || !upstream.body) {
      releaseConnection();
      return NextResponse.json({ error: "事件流不可用。" }, { status: 502 });
    }
    const reader = upstream.body.getReader();
    let checking = false;
    let closed = false;
    const interval = setInterval(() => {
      if (checking || closed) return;
      checking = true;
      void (async () => {
        try {
          const refreshed = await resolveEnterpriseContext(request);
          const denied = refreshed.ok
            ? requireEnterprisePermission(refreshed.context, "thread.read.own")
            : refreshed.response;
          if (
            !refreshed.ok ||
            denied ||
            !(await isAgentThreadOwner(threadId, refreshed.context))
          ) {
            revocation.abort();
          }
        } catch {
          revocation.abort();
        } finally {
          checking = false;
        }
      })();
    }, 15_000);
    interval.unref();
    const lifetime = setTimeout(() => revocation.abort(), MAX_STREAM_LIFETIME_MS);
    lifetime.unref();

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(interval);
      clearTimeout(lifetime);
      revocation.abort();
      releaseConnection();
    };
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            cleanup();
            controller.close();
          } else {
            controller.enqueue(chunk.value);
          }
        } catch {
          cleanup();
          controller.close();
        }
      },
      async cancel() {
        cleanup();
        await reader.cancel().catch(() => undefined);
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    releaseConnection();
    return NextResponse.json({ error: "无法连接 Agent 事件流。" }, { status: 503 });
  }
}

function decrement(map: Map<string, number>, key: string): void {
  const next = (map.get(key) ?? 1) - 1;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
}
