import { NextResponse } from "next/server";

import { AGENT_ID_PATTERN, gatewayHeaders, gatewayUrl, requireAgentThreadContext } from "@/lib/agent/http";
import {
  getAgentThreadForUser,
  isSupportedAgentToolContractVersion,
} from "@/lib/agent/thread-ownership";
import { isAgentWorkflowId, isWorkflowAllowedForRecipeId } from "@/lib/agent/task-category";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";
import {
  isInsightMethodAllowedForRecipeId,
  isProductInsightMethod,
} from "@/lib/research/product-insight-contract";

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  if (!AGENT_ID_PATTERN.test(threadId)) {
    return NextResponse.json({ error: "会话标识无效。" }, { status: 400 });
  }
  const access = await requireAgentThreadContext(request, threadId, "agent.run");
  if (!access.ok) return access.response;
  const body = (await request.json().catch(() => null)) as {
    message?: unknown;
    workflow?: unknown;
    insightMethod?: unknown;
    expectedTurnId?: unknown;
    clientRequestId?: unknown;
  } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 50_000) {
    return NextResponse.json({ error: "调整内容长度必须在 1 到 50000 个字符之间。" }, { status: 400 });
  }
  if (!isAgentWorkflowId(body?.workflow)) {
    return NextResponse.json({ error: "工作流标识无效。" }, { status: 400 });
  }
  const insightMethod = isProductInsightMethod(body?.insightMethod) ? body.insightMethod : undefined;
  if (body?.insightMethod !== undefined && !insightMethod) {
    return NextResponse.json({ error: "商品决策 Skill 标识无效。" }, { status: 400 });
  }
  if (body.workflow === "commerce-product-insight" && !insightMethod) {
    return NextResponse.json({ error: "商品决策任务必须携带固定 Skill。" }, { status: 400 });
  }
  if (body.workflow !== "commerce-product-insight" && insightMethod) {
    return NextResponse.json({ error: "商品决策 Skill 只能用于商品决策工作流。" }, { status: 400 });
  }
  const expectedTurnId = typeof body?.expectedTurnId === "string" ? body.expectedTurnId : "";
  if (!AGENT_ID_PATTERN.test(expectedTurnId)) {
    return NextResponse.json({ error: "当前任务标识无效。" }, { status: 400 });
  }
  const thread = await getAgentThreadForUser(threadId, access.context);
  if (!thread) {
    return NextResponse.json({ error: "会话不存在。" }, { status: 404 });
  }
  if (!isSupportedAgentToolContractVersion(thread.toolContractVersion)) {
    return NextResponse.json(
      { error: "该任务的工具契约已更新，请新建项目后继续。", code: "THREAD_TOOL_CONTRACT_STALE" },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!isWorkflowAllowedForRecipeId(thread.recipeId, body.workflow)) {
    return NextResponse.json(
      { error: "该任务只能使用其创建时绑定的工作流。", code: "THREAD_WORKFLOW_MISMATCH" },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (body.workflow === "commerce-product-insight" && !isInsightMethodAllowedForRecipeId(thread.recipeId, insightMethod)) {
    return NextResponse.json(
      { error: "该任务创建后不能切换到其他商品决策 Skill。", code: "THREAD_INSIGHT_METHOD_MISMATCH" },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  const rateLimited = await enforceEnterpriseRateLimit(access.context, "turn.steer", 120, 60);
  if (rateLimited) return rateLimited;
  const clientRequestId =
    typeof body.clientRequestId === "string" && /^[0-9a-f-]{36}$/i.test(body.clientRequestId)
      ? body.clientRequestId
      : crypto.randomUUID();
  try {
    const response = await fetch(gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}/steer`), {
      method: "POST",
      headers: gatewayHeaders({ "Content-Type": "application/json" }, access.context),
      body: JSON.stringify({
        message,
        workflow: body.workflow,
        insightMethod,
        expectedTurnId,
        clientRequestId,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => ({ error: "Agent Gateway 返回了无效响应。" }));
    return NextResponse.json(payload, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "无法调整当前任务方向。" }, { status: 503 });
  }
}
