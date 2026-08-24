import { NextResponse } from "next/server";

import { AGENT_ID_PATTERN, gatewayHeaders, gatewayUrl, requireAgentThreadContext } from "@/lib/agent/http";
import { generateAgentThreadTitleOnce } from "@/lib/agent/thread-ownership";
import { isTaskCategory, type TaskCategory } from "@/lib/agent/task-category";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  if (!AGENT_ID_PATTERN.test(threadId)) {
    return NextResponse.json({ error: "会话标识无效。" }, { status: 400 });
  }
  const access = await requireAgentThreadContext(request, threadId, "thread.read.own");
  if (!access.ok) return access.response;
  const rateLimited = await enforceEnterpriseRateLimit(access.context, "thread.title.generate", 30, 60);
  if (rateLimited) return rateLimited;

  try {
    const result = await generateAgentThreadTitleOnce(threadId, access.context, async (record) => {
      const response = await fetch(gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}/title`), {
        method: "POST",
        headers: gatewayHeaders({ "Content-Type": "application/json" }, access.context),
        body: "{}",
        cache: "no-store",
        signal: AbortSignal.timeout(45_000),
      });
      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok || !payload) throw new Error("标题生成服务返回了无效响应。");
      const title = typeof payload.title === "string" ? normalizeGeneratedTitle(payload.title) : "";
      const model = typeof payload.model === "string" ? payload.model : "";
      const generatedCategory = isTaskCategory(payload.category) ? payload.category : null;
      if (!title || !model || !generatedCategory) throw new Error("标题生成服务没有返回有效标题。");
      const category: TaskCategory = record.recipeId === "copywriting" ? "creative" : generatedCategory;
      return { title, model, category };
    });
    return NextResponse.json(
      result,
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
