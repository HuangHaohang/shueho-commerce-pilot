import { NextResponse } from "next/server";

import { gatewayHeaders, gatewayUrl, requireAgentContext } from "@/lib/agent/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await requireAgentContext(request, "agent.run");
  if (!access.ok) return access.response;

  try {
    const response = await fetch(gatewayUrl("/api/skills"), {
      headers: gatewayHeaders(undefined, access.context),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => null);
    return NextResponse.json(
      payload ?? { error: "Agent Gateway 返回了无效响应。" },
      { status: response.status, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "无法读取技能目录。" }, { status: 503 });
  }
}
