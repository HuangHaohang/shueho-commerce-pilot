import { NextResponse } from "next/server";

import { AGENT_ID_PATTERN, gatewayHeaders, gatewayUrl, requireAgentThreadContext } from "@/lib/agent/http";
import {
  isSupportedAgentToolContractVersion,
  getAgentThreadForUser,
  markAgentThreadRunning,
} from "@/lib/agent/thread-ownership";
import { isAgentWorkflowId, isWorkflowAllowedForRecipeId } from "@/lib/agent/task-category";
import {
  isAppOwnedManagedSkillName,
  isCreativeMethod,
} from "@/lib/creative/creative-method-contract";
import {
  activateAgentTurnLease,
  releaseAgentTurnLease,
  reserveAgentTurn,
} from "@/lib/enterprise/quota";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";
import {
  bindProductContextToTurn,
  createProductContextSet,
} from "@/lib/product-catalog/repository";
import { ProductCatalogError } from "@/lib/product-catalog/types";
import {
  isInsightMethodAllowedForRecipeId,
  isProductInsightMethod,
} from "@/lib/research/product-insight-contract";

const effortValues = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);
const externalDataApprovalModes = new Set(["always_ask", "task", "policy"]);
const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const attachmentIdPattern = /^[0-9a-f-]{36}$/i;
const productIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const productContextModes = new Set(["auto", "selected", "none"]);

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  if (!AGENT_ID_PATTERN.test(threadId)) {
    return NextResponse.json({ error: "会话标识无效。" }, { status: 400 });
  }
  const access = await requireAgentThreadContext(request, threadId, "agent.run");
  if (!access.ok) return access.response;
  const enterpriseContext = access.context;
  const thread = await getAgentThreadForUser(threadId, enterpriseContext);
  if (!thread) {
    return NextResponse.json({ error: "会话不存在。" }, { status: 404 });
  }
  if (!isSupportedAgentToolContractVersion(thread.toolContractVersion)) {
    return NextResponse.json(
      {
        error: "该任务的工具契约已更新，将自动创建新任务后继续。",
        code: "THREAD_TOOL_CONTRACT_STALE",
      },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    message?: unknown;
    model?: unknown;
    effort?: unknown;
    clientRequestId?: unknown;
    workflow?: unknown;
    creativeMethod?: unknown;
    insightMethod?: unknown;
    skillName?: unknown;
    attachmentIds?: unknown;
    externalDataApprovalMode?: unknown;
    productIds?: unknown;
    productContextMode?: unknown;
    productContextSetId?: unknown;
  } | null;
  if (body?.productContextSetId !== undefined) {
    return NextResponse.json(
      { error: "产品研究主体只能由服务器创建。", code: "PRODUCT_CONTEXT_SET_BROWSER_FORBIDDEN" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const attachmentIds = readAttachmentIds(body?.attachmentIds);
  if (!attachmentIds) {
    return NextResponse.json({ error: "附件标识无效。" }, { status: 400 });
  }
  if (!body || typeof body.message !== "string" || (!body.message.trim() && !attachmentIds.length) || body.message.length > 50_000) {
    return NextResponse.json({ error: "请输入内容或添加附件。" }, { status: 400 });
  }
  if (typeof body.model !== "string" || body.model.length > 128) {
    return NextResponse.json({ error: "请选择有效模型。" }, { status: 400 });
  }
  if (body.workflow !== undefined && !isAgentWorkflowId(body.workflow)) {
    return NextResponse.json({ error: "工作流标识无效。" }, { status: 400 });
  }
  if (body.skillName !== undefined && (typeof body.skillName !== "string" || !skillNamePattern.test(body.skillName))) {
    return NextResponse.json({ error: "技能标识无效。" }, { status: 400 });
  }

  const effort = typeof body.effort === "string" && effortValues.has(body.effort) ? body.effort : undefined;
  const workflow = isAgentWorkflowId(body.workflow) ? body.workflow : undefined;
  const creativeMethod = isCreativeMethod(body.creativeMethod) ? body.creativeMethod : undefined;
  const insightMethod = isProductInsightMethod(body.insightMethod) ? body.insightMethod : undefined;
  if (body.creativeMethod !== undefined && !creativeMethod) {
    return NextResponse.json({ error: "创作方式无效。" }, { status: 400 });
  }
  if (creativeMethod && workflow !== "commerce-creative-project") {
    return NextResponse.json({ error: "创作方式只能用于创作项目。" }, { status: 400 });
  }
  if (body.insightMethod !== undefined && !insightMethod) {
    return NextResponse.json({ error: "商品决策 Skill 标识无效。" }, { status: 400 });
  }
  if (workflow === "commerce-product-insight" && !insightMethod) {
    return NextResponse.json({ error: "商品决策任务必须选择固定 Skill。" }, { status: 400 });
  }
  if (workflow !== "commerce-product-insight" && insightMethod) {
    return NextResponse.json({ error: "商品决策 Skill 只能用于商品决策工作流。" }, { status: 400 });
  }
  const skillName = typeof body.skillName === "string" && skillNamePattern.test(body.skillName) ? body.skillName : undefined;
  if (skillName && isAppOwnedManagedSkillName(skillName)) {
    return NextResponse.json(
      { error: "应用托管 Skill 只能通过对应的业务入口调用。" },
      { status: 400 },
    );
  }
  if (!isWorkflowAllowedForRecipeId(thread.recipeId, workflow)) {
    return NextResponse.json(
      { error: "该任务只能使用其创建时绑定的工作流。", code: "THREAD_WORKFLOW_MISMATCH" },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (workflow === "commerce-product-insight" && !isInsightMethodAllowedForRecipeId(thread.recipeId, insightMethod)) {
    return NextResponse.json(
      { error: "该任务创建后不能切换到其他商品决策 Skill。", code: "THREAD_INSIGHT_METHOD_MISMATCH" },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  const productIds = readProductIds(body?.productIds);
  if (!productIds) {
    return NextResponse.json({ error: "产品标识无效。" }, { status: 400 });
  }
  const productContextMode = body?.productContextMode === undefined ? "none" : body.productContextMode;
  if (typeof productContextMode !== "string" || !productContextModes.has(productContextMode)) {
    return NextResponse.json({ error: "产品上下文模式无效。" }, { status: 400 });
  }
  if ((productContextMode === "selected") !== (productIds.length > 0)) {
    return NextResponse.json({ error: "仅选中产品模式可以携带产品，并且至少需要选择一个产品。" }, { status: 400 });
  }
  if (insightMethod === "product_retrospective" && productContextMode !== "selected") {
    return NextResponse.json({ error: "产品复盘必须选择至少一个产品。" }, { status: 400 });
  }
  if (productContextMode === "selected" && !enterpriseContext.permissions.has("product_catalog.read")) {
    return NextResponse.json({ error: "当前角色不能读取产品库。", code: "PRODUCT_CATALOG_FORBIDDEN" }, { status: 403 });
  }
  const externalDataApprovalMode =
    typeof body.externalDataApprovalMode === "string" && externalDataApprovalModes.has(body.externalDataApprovalMode)
      ? body.externalDataApprovalMode
      : "always_ask";
  if (body.externalDataApprovalMode !== undefined && !externalDataApprovalModes.has(String(body.externalDataApprovalMode))) {
    return NextResponse.json({ error: "外部数据授权模式无效。" }, { status: 400 });
  }
  if (
    externalDataApprovalMode !== "always_ask" &&
    !enterpriseContext.permissions.has("external_data.call")
  ) {
    return NextResponse.json({ error: "当前角色不能预先授权外部付费数据调用。" }, { status: 403 });
  }
  if (workflow && skillName) {
    return NextResponse.json({ error: "工作流与显式技能不能同时选择。" }, { status: 400 });
  }
  const clientRequestId =
    typeof body.clientRequestId === "string" && /^[0-9a-f-]{36}$/i.test(body.clientRequestId)
      ? body.clientRequestId
      : crypto.randomUUID();
  const rateLimited = await enforceEnterpriseRateLimit(enterpriseContext, "turn.start", 60, 60);
  if (rateLimited) return rateLimited;
  const reservation = await reserveAgentTurn(enterpriseContext, threadId, clientRequestId).catch(() => null);
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
      { error: "该请求已被接收，请勿重复提交。", code: "IDEMPOTENT_REQUEST_REPLAY" },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  let productContextSetId: string | null = null;
  if (productContextMode === "selected") {
    try {
      productContextSetId = await createProductContextSet(enterpriseContext, {
        threadId,
        clientRequestId,
        productIds,
      });
    } catch (error) {
      await releaseAgentTurnLease(enterpriseContext, reservation.leaseId);
      if (error instanceof ProductCatalogError) {
        return NextResponse.json(
          { error: error.message, code: error.code, issues: error.issues },
          { status: error.status, headers: { "Cache-Control": "no-store" } },
        );
      }
      return NextResponse.json({ error: "无法保存产品上下文。" }, { status: 503 });
    }
  }
  try {
    const response = await fetch(gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}/turns`), {
      method: "POST",
      headers: gatewayHeaders({ "Content-Type": "application/json" }, enterpriseContext),
      body: JSON.stringify({
        message: body.message.trim(),
        model: body.model,
        effort,
        workflow,
        creativeMethod,
        insightMethod,
        skillName,
        attachmentIds,
        externalDataApprovalMode,
        productIds,
        productContextMode,
        ...(productContextSetId ? { productContextSetId } : {}),
        clientRequestId,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !payload) {
      await releaseAgentTurnLease(enterpriseContext, reservation.leaseId);
      if (response.status === 409 && payload?.code === "THREAD_STARTING") {
        return NextResponse.json({ error: "当前任务正在启动，请稍后重试。" }, { status: 409 });
      }
      return NextResponse.json(payload ?? { error: "Agent Gateway 返回了无效响应。" }, { status: response.status });
    }
    if (response.status === 202 && payload.queued === true) {
      const activeTurnId = typeof payload.activeTurnId === "string" ? payload.activeTurnId : null;
      if (activeTurnId) {
        await markAgentThreadRunning(threadId, enterpriseContext, activeTurnId);
      }
      await releaseAgentTurnLease(enterpriseContext, reservation.leaseId);
      return NextResponse.json(payload, {
        status: 202,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const result = isRecord(payload.result) ? payload.result : null;
    const turn = result && isRecord(result.turn) ? result.turn : null;
    const turnId = turn && typeof turn.id === "string" ? turn.id : null;
    if (!turnId) {
      await releaseAgentTurnLease(enterpriseContext, reservation.leaseId);
      return NextResponse.json({ error: "Agent Gateway 未返回任务标识。" }, { status: 502 });
    }
    if (productContextSetId) {
      try {
        await bindProductContextToTurn(enterpriseContext, { contextSetId: productContextSetId, turnId });
      } catch {
        // The Harness Turn is already active. Keep the quota reservation until
        // terminal readback/expiry and do not claim the unbound context belongs
        // to this Turn.
        return NextResponse.json(
          { error: "产品上下文未能绑定到已启动的任务。", code: "PRODUCT_CONTEXT_BIND_FAILED" },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }
    }
    await activateAgentTurnLease(enterpriseContext, reservation.leaseId, turnId);
    await markAgentThreadRunning(threadId, enterpriseContext, turnId);
    return NextResponse.json(
      {
        result: {
          turn: {
            id: turnId,
            status: turn && typeof turn.status === "string" ? turn.status : "inProgress",
          },
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // The Gateway may have accepted the turn before the response connection
    // failed. Keep the short-lived reservation so an ambiguous retry cannot
    // over-admit concurrent work; terminal readback or expiry releases it.
    return NextResponse.json({ error: "无法启动 Agent 任务。" }, { status: 503 });
  }
}

function readAttachmentIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) return null;
  const ids = value.filter((item): item is string => typeof item === "string" && attachmentIdPattern.test(item));
  return ids.length === value.length && new Set(ids).size === ids.length ? ids : null;
}

function readProductIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) return null;
  const ids = value.filter((item): item is string => typeof item === "string" && productIdPattern.test(item));
  return ids.length === value.length && new Set(ids).size === ids.length ? ids : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
