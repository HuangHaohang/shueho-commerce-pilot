import { NextResponse } from "next/server";

import { hasAuthenticatedSession } from "@/lib/auth/require-session";
import { gatewayHeaders } from "@/lib/agent/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await hasAuthenticatedSession(request))) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const gatewayUrl = process.env.COMMERCE_GATEWAY_URL ?? "http://127.0.0.1:8787";
  try {
    const response = await fetch(new URL("/api/models", gatewayUrl), {
      headers: gatewayHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({ error: "模型目录返回了无效响应。" }));
    return NextResponse.json(payload, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "模型服务暂时不可用。" }, { status: 503 });
  }
}
