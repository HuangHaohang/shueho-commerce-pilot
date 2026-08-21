import { NextResponse } from "next/server";

import { gatewayHeaders, gatewayUrl } from "@/lib/agent/http";
import {
  deleteAgentThreadRecord,
  listAgentThreadsForUser,
  registerAgentThreadOwner,
  updateAgentThreadStatus,
  type AgentThreadRecord,
} from "@/lib/agent/thread-ownership";
import { getAuthenticatedUserId } from "@/lib/auth/require-session";

export async function POST(request: Request) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { model?: unknown; title?: unknown } | null;
  if (!body || typeof body.model !== "string" || body.model.length > 128) {
    return NextResponse.json({ error: "请选择有效模型。" }, { status: 400 });
  }
  const title = typeof body.title === "string" ? normalizeThreadTitle(body.title) : "新任务";

  try {
    const response = await fetch(gatewayUrl("/api/threads"), {
      method: "POST",
      headers: gatewayHeaders({ "Content-Type": "application/json" }),
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
    await registerAgentThreadOwner(threadId, userId, title);
    return NextResponse.json(
      { result: { thread: { id: threadId } } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Agent Gateway 暂时不可用。" }, { status: 503 });
  }
}

export async function GET(request: Request) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }
  try {
    const threads = await listAgentThreadsForUser(userId);
    await Promise.all(threads.filter((thread) => thread.status === "running").map((thread) => reconcileRunningThread(thread, userId)));
    return NextResponse.json(
      { threads: threads.filter((thread) => thread.status !== "idle" || thread.title !== "__deleted__") },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "无法读取对话记录。" }, { status: 503 });
  }
}

async function reconcileRunningThread(thread: AgentThreadRecord, userId: string): Promise<void> {
  try {
    const response = await fetch(gatewayUrl(`/api/threads/${encodeURIComponent(thread.threadId)}`), {
      headers: gatewayHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !payload) {
      const message = payload && typeof payload.error === "string" ? payload.error : "";
      if (/thread not found/i.test(message)) {
        await deleteAgentThreadRecord(thread.threadId, userId);
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
      await updateAgentThreadStatus(thread.threadId, userId, status, durationMs);
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

function normalizeThreadTitle(value: string): string {
  const title = value.replace(/\s+/g, " ").trim();
  if (!title) {
    return "新任务";
  }
  return title.length > 40 ? `${title.slice(0, 40)}…` : title;
}
