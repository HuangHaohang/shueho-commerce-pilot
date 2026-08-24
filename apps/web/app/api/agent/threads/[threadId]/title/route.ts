import { NextResponse } from "next/server";

import { AGENT_ID_PATTERN, gatewayHeaders, gatewayUrl, requireAgentThreadContext } from "@/lib/agent/http";
import {
  getAgentThreadForUser,
  updateAgentThreadGeneratedTitle,
} from "@/lib/agent/thread-ownership";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  if (!AGENT_ID_PATTERN.test(threadId)) {
    return NextResponse.json({ error: "会话标识无效。" }, { status: 400 });
  }
  const access = await requireAgentThreadContext(request, threadId, "thread.read.own");
  if (!access.ok) return access.response;
  const record = await getAgentThreadForUser(threadId, access.context).catch(() => null);
  if (!record) return NextResponse.json({ error: "会话不存在。" }, { status: 404 });
  if (record.titleGeneratedAt && record.titleModel) {
    return NextResponse.json({ title: record.title, model: record.titleModel, generated: false });
  }
  const rateLimited = await enforceEnterpriseRateLimit(access.context, "thread.title.generate", 30, 60);
  if (rateLimited) return rateLimited;

  try {
    const response = await fetch(gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}/title`), {
      method: "POST",
      headers: gatewayHeaders({ "Content-Type": "application/json" }, access.context),
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !payload) {
      return NextResponse.json(payload ?? { error: "标题生成服务返回了无效响应。" }, { status: response.status });
    }
    const title = typeof payload.title === "string" ? normalizeGeneratedTitle(payload.title) : "";
    const model = typeof payload.model === "string" ? payload.model : "";
    if (!title || !model) {
      return NextResponse.json({ error: "标题生成服务没有返回有效标题。" }, { status: 502 });
    }
    await updateAgentThreadGeneratedTitle(threadId, access.context, title, model);
    return NextResponse.json(
      { title, model, generated: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "无法生成会话标题。" }, { status: 503 });
  }
}

function normalizeGeneratedTitle(value: string): string {
  const title = value.replace(/\s+/g, " ").trim();
  if (!title) return "";
  const characters = Array.from(title);
  return characters.length > 40 ? `${characters.slice(0, 40).join("")}…` : title;
}
