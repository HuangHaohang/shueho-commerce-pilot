import { NextResponse } from "next/server";

import { gatewayHeaders, gatewayUrl, requireAgentContext } from "@/lib/agent/http";
import {
  deleteAgentThreadRecord,
  listAgentThreadsForUser,
  registerAgentThreadOwner,
  updateAgentThreadStatus,
  type AgentThreadRecord,
} from "@/lib/agent/thread-ownership";
import type { EnterpriseContext } from "@/lib/enterprise/types";
import { releaseAgentTurnLeaseForTurn } from "@/lib/enterprise/quota";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";

export async function POST(request: Request) {
  const access = await requireAgentContext(request, "thread.create");
  if (!access.ok) return access.response;
  const runnable = await requireAgentContext(request, "agent.run");
  if (!runnable.ok) return runnable.response;
  const context = access.context;
  const rateLimited = await enforceEnterpriseRateLimit(context, "thread.create", 20, 60);
  if (rateLimited) return rateLimited;

  const body = (await request.json().catch(() => null)) as { model?: unknown; recipeId?: unknown } | null;
  if (!body || typeof body.model !== "string" || body.model.length > 128) {
    return NextResponse.json({ error: "请选择有效模型。" }, { status: 400 });
  }
  const title = "新任务";
  const recipeId = body.recipeId === "copywriting" ? "copywriting" : null;
  if (body.recipeId !== undefined && body.recipeId !== null && !recipeId) {
    return NextResponse.json({ error: "任务类型无效。" }, { status: 400 });
  }

  try {
    const response = await fetch(gatewayUrl("/api/threads"), {
      method: "POST",
      headers: gatewayHeaders({ "Content-Type": "application/json" }, context),
      body: JSON.stringify({
        model: body.model,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !payload) {
      return NextResponse.json(payload ?? { error: "Agent Gateway 返回了无效响应。" }, { status: response.status });
    }
    const result = isRecord(payload.result) ? payload.result : null;
    const thread = result && isRecord(result.thread) ? result.thread : null;
    const threadId = thread && typeof thread.id === "string" ? thread.id : null;
    if (!threadId) {
      return NextResponse.json({ error: "Agent Gateway 未返回会话标识。" }, { status: 502 });
    }
    await registerAgentThreadOwner(threadId, context, title, recipeId);
    return NextResponse.json(
      { result: { thread: { id: threadId } } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Agent Gateway 暂时不可用。" }, { status: 503 });
  }
}

export async function GET(request: Request) {
  const access = await requireAgentContext(request, "thread.read.own");
  if (!access.ok) return access.response;
  const context = access.context;
  try {
    const threads = await listAgentThreadsForUser(context);
    await Promise.all(
      threads.filter((thread) => thread.status === "running").map((thread) => reconcileRunningThread(thread, context)),
    );
    return NextResponse.json(
      { threads: threads.filter((thread) => thread.status !== "idle" || thread.title !== "__deleted__") },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "无法读取对话记录。" }, { status: 503 });
  }
}

async function reconcileRunningThread(thread: AgentThreadRecord, context: EnterpriseContext): Promise<void> {
  try {
    const response = await fetch(gatewayUrl(`/api/threads/${encodeURIComponent(thread.threadId)}`), {
      headers: gatewayHeaders(undefined, context),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !payload) {
      const message = payload && typeof payload.error === "string" ? payload.error : "";
      if (/thread not found/i.test(message)) {
        await deleteAgentThreadRecord(thread.threadId, context);
        thread.title = "__deleted__";
        thread.status = "idle";
      }
      return;
    }
    const result = isRecord(payload.result) ? payload.result : null;
    const storedThread = result && isRecord(result.thread) ? result.thread : null;
    const turns = storedThread && Array.isArray(storedThread.turns) ? storedThread.turns.filter(isRecord) : [];
    const lastTurn = turns.at(-1);
    if (!lastTurn || typeof lastTurn.status !== "string") {
      return;
    }
    const status = normalizeRuntimeStatus(lastTurn.status);
    const durationMs = typeof lastTurn.durationMs === "number" ? lastTurn.durationMs : null;
    thread.status = status;
    thread.activeTurnId = status === "running" && typeof lastTurn.id === "string" ? lastTurn.id : null;
    thread.durationMs = durationMs;
    if (status !== "running") {
      await updateAgentThreadStatus(thread.threadId, context, status, durationMs);
      if (typeof lastTurn.id === "string") {
        await releaseAgentTurnLeaseForTurn(context, thread.threadId, lastTurn.id);
      }
    }
  } catch {
    // Keep the last known running state; the next list poll will retry.
  }
}

function normalizeRuntimeStatus(value: string): AgentThreadRecord["status"] {
  return value === "inProgress" || value === "running"
    ? "running"
    : value === "failed"
      ? "failed"
      : value === "interrupted"
        ? "interrupted"
        : "completed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
