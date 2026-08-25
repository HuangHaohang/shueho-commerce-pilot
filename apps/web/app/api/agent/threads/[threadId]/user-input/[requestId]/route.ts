import { NextResponse } from "next/server";

import { AGENT_ID_PATTERN, gatewayHeaders, gatewayUrl, requireAgentThreadContext } from "@/lib/agent/http";
import { recordAgentUserInputAnswer } from "@/lib/agent/user-input-answers";
import { requireEnterpriseTenantPermission } from "@/lib/enterprise/context";

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
    const pendingResponse = await fetch(
      gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}/user-input`),
      {
        headers: gatewayHeaders(undefined, access.context),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    const pendingPayload = (await pendingResponse.json().catch(() => null)) as { requests?: unknown } | null;
    const pendingRequests = Array.isArray(pendingPayload?.requests) ? pendingPayload.requests : [];
    const pending = pendingRequests.find(
      (value): value is Record<string, unknown> =>
        Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).requestId === requestId),
    );
    if (!pendingResponse.ok || !pending) {
      return NextResponse.json({ error: "待确认请求不存在或已经结束。" }, { status: 404 });
    }
    if (pending.action === "skill.publish") {
      const tenantDenied = requireEnterpriseTenantPermission(access.context, "tenant.manage");
      if (tenantDenied) return tenantDenied;
    }
    const response = await fetch(
      gatewayUrl(
        `/api/threads/${encodeURIComponent(threadId)}/user-input/${encodeURIComponent(requestId)}`,
      ),
      {
        method: "POST",
        headers: gatewayHeaders({ "Content-Type": "application/json" }, access.context),
        body: JSON.stringify({ answers: body.answers }),
        cache: "no-store",
        signal: AbortSignal.timeout(40_000),
      },
    );
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    let answerIndexed = false;
    if (
      response.ok &&
      payload &&
      typeof payload.answerMessage === "string" &&
      typeof pending.turnId === "string" &&
      typeof pending.itemId === "string"
    ) {
      answerIndexed = await recordAgentUserInputAnswer(access.context, {
        requestId,
        threadId,
        turnId: pending.turnId,
        itemId: pending.itemId,
        answerMessage: payload.answerMessage,
      }).then(
        () => true,
        () => false,
      );
    }
    return NextResponse.json(
      payload ? { ...payload, answerIndexed } : { error: "Agent Gateway 返回了无效响应。" },
      { status: response.status },
    );
  } catch {
    return NextResponse.json({ error: "无法提交答案。" }, { status: 503 });
  }
}
