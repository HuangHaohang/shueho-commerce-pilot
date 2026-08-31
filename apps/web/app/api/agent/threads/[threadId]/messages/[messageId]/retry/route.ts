import { NextResponse } from "next/server";

import { readRateableAgentMessageTarget } from "@/lib/agent/message-feedback-target";
import {
  AGENT_ID_PATTERN,
  gatewayHeaders,
  gatewayUrl,
  requireAgentThreadContext,
} from "@/lib/agent/http";
import {
  getAgentThreadForUser,
  isSupportedAgentToolContractVersion,
  markAgentThreadRunning,
} from "@/lib/agent/thread-ownership";
import {
  activateAgentTurnLease,
  releaseAgentTurnLease,
  reserveAgentTurn,
} from "@/lib/enterprise/quota";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";
import {
  bindProductContextToTurn,
  cloneProductContextSetForRetry,
  hasBoundProductContextForTurn,
} from "@/lib/product-catalog/repository";
import { ProductCatalogError } from "@/lib/product-catalog/types";

const MESSAGE_ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const CLIENT_REQUEST_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const effortValues = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);
const externalDataApprovalModes = new Set(["always_ask", "task", "policy"]);

export async function POST(
  request: Request,
  routeContext: { params: Promise<{ threadId: string; messageId: string }> },
) {
  const { threadId, messageId } = await routeContext.params;
  if (!AGENT_ID_PATTERN.test(threadId) || !MESSAGE_ITEM_ID_PATTERN.test(messageId)) {
    return NextResponse.json({ error: "回复标识无效。" }, { status: 400 });
  }
  const access = await requireAgentThreadContext(request, threadId, "agent.run");
  if (!access.ok) return access.response;
  const thread = await getAgentThreadForUser(threadId, access.context);
  if (!thread) return NextResponse.json({ error: "会话不存在。" }, { status: 404 });
  if (!isSupportedAgentToolContractVersion(thread.toolContractVersion)) {
    return NextResponse.json(
      { error: "该任务的工具契约已更新，不能直接重新尝试。", code: "THREAD_TOOL_CONTRACT_STALE" },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    model?: unknown;
    effort?: unknown;
    externalDataApprovalMode?: unknown;
    clientRequestId?: unknown;
  } | null;
  if (!body || typeof body.model !== "string" || !body.model || body.model.length > 128) {
    return NextResponse.json({ error: "请选择有效模型。" }, { status: 400 });
  }
  if (body.effort !== undefined && (typeof body.effort !== "string" || !effortValues.has(body.effort))) {
    return NextResponse.json({ error: "推理强度无效。" }, { status: 400 });
  }
  const externalDataApprovalMode = body.externalDataApprovalMode === undefined
    ? "always_ask"
    : typeof body.externalDataApprovalMode === "string" && externalDataApprovalModes.has(body.externalDataApprovalMode)
      ? body.externalDataApprovalMode
      : null;
  if (!externalDataApprovalMode) {
    return NextResponse.json({ error: "外部数据授权模式无效。" }, { status: 400 });
  }
  if (externalDataApprovalMode !== "always_ask" && !access.context.permissions.has("external_data.call")) {
    return NextResponse.json({ error: "当前角色不能预先授权外部付费数据调用。" }, { status: 403 });
  }
  const clientRequestId = typeof body.clientRequestId === "string" && CLIENT_REQUEST_ID_PATTERN.test(body.clientRequestId)
    ? body.clientRequestId
    : null;
  if (!clientRequestId) {
    return NextResponse.json({ error: "重试请求标识无效。" }, { status: 400 });
  }

  const rateLimited = await enforceEnterpriseRateLimit(access.context, "turn.retry", 30, 60);
  if (rateLimited) return rateLimited;

  let target: ReturnType<typeof readRateableAgentMessageTarget> = null;
  try {
    let cursor: string | null = null;
    for (let page = 0; page < 50 && !target; page += 1) {
      const response: Response = await fetch(
        gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
        {
          headers: gatewayHeaders(undefined, access.context),
          cache: "no-store",
          signal: AbortSignal.timeout(30_000),
        },
      );
      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok || !payload) {
        return NextResponse.json({ error: "暂时无法核验这条回复。" }, { status: 503 });
      }
      target = readRateableAgentMessageTarget(payload, messageId);
      cursor = typeof payload.nextCursor === "string" && payload.nextCursor ? payload.nextCursor : null;
      if (!cursor) break;
    }
  } catch {
    return NextResponse.json({ error: "暂时无法核验这条回复。" }, { status: 503 });
  }
  if (!target) {
    return NextResponse.json({ error: "该回复不存在或尚未完成。" }, { status: 404 });
  }

  let hasSelectedProductContext = false;
  try {
    hasSelectedProductContext = await hasBoundProductContextForTurn(access.context, {
      threadId,
      turnId: target.turnId,
    });
    if (hasSelectedProductContext && !access.context.permissions.has("product_catalog.read")) {
      return NextResponse.json({ error: "当前角色不能读取原 Turn 使用的产品。" }, { status: 403 });
    }
  } catch (error) {
    if (error instanceof ProductCatalogError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "无法恢复原 Turn 的产品上下文。" }, { status: 503 });
  }

  const reservation = await reserveAgentTurn(access.context, threadId, clientRequestId).catch(() => null);
  if (!reservation) {
    return NextResponse.json({ error: "企业额度服务暂时不可用。" }, { status: 503 });
  }
  if (!reservation.ok) {
    return NextResponse.json(
      { error: reservation.error, code: reservation.code },
      { status: reservation.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (reservation.duplicate) {
    return NextResponse.json(
      { error: "该重试请求已被接收，请勿重复提交。", code: "IDEMPOTENT_REQUEST_REPLAY" },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  let clonedProductContext: Awaited<ReturnType<typeof cloneProductContextSetForRetry>> = null;
  if (hasSelectedProductContext) {
    try {
      clonedProductContext = await cloneProductContextSetForRetry(access.context, {
        threadId,
        sourceTurnId: target.turnId,
        clientRequestId,
      });
      if (!clonedProductContext) throw new Error("Product context disappeared before retry.");
    } catch (error) {
      await releaseAgentTurnLease(access.context, reservation.leaseId);
      if (error instanceof ProductCatalogError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      }
      return NextResponse.json({ error: "无法恢复原 Turn 的产品上下文。" }, { status: 503 });
    }
  }

  try {
    const response = await fetch(
      gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/retry`),
      {
        method: "POST",
        headers: gatewayHeaders({ "Content-Type": "application/json" }, access.context),
        body: JSON.stringify({
          expectedTurnId: target.turnId,
          model: body.model,
          effort: body.effort,
          externalDataApprovalMode,
          productIds: clonedProductContext?.productIds ?? [],
          productContextMode: clonedProductContext ? "selected" : undefined,
          productContextSetId: clonedProductContext?.contextSetId ?? undefined,
          clientRequestId,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(45_000),
      },
    );
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !payload) {
      if (payload?.code !== "HARNESS_RETRY_START_UNCERTAIN") {
        await releaseAgentTurnLease(access.context, reservation.leaseId);
      }
      return NextResponse.json(payload ?? { error: "Agent Gateway 返回了无效响应。" }, { status: response.status });
    }
    const result = isRecord(payload.result) ? payload.result : null;
    const turn = result && isRecord(result.turn) ? result.turn : null;
    const turnId = turn && typeof turn.id === "string" ? turn.id : null;
    if (!turnId || payload.retriedFromTurnId !== target.turnId) {
      await releaseAgentTurnLease(access.context, reservation.leaseId);
      return NextResponse.json({ error: "Agent Gateway 未返回有效的重试 Turn。" }, { status: 502 });
    }
    if (clonedProductContext) {
      await bindProductContextToTurn(access.context, {
        contextSetId: clonedProductContext.contextSetId,
        turnId,
      });
    }
    await activateAgentTurnLease(access.context, reservation.leaseId, turnId);
    await markAgentThreadRunning(threadId, access.context, turnId);
    return NextResponse.json(
      {
        result: {
          turn: {
            id: turnId,
            status: turn && typeof turn.status === "string" ? turn.status : "inProgress",
          },
        },
        retriedFromTurnId: target.turnId,
        clientRequestId,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // The Harness may have accepted the replacement Turn before the private
    // Gateway response was lost. Preserve the short reservation for readback.
    return NextResponse.json({ error: "无法确认 Harness 是否已接收重新尝试。" }, { status: 503 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
