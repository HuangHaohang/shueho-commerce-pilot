import { NextResponse } from "next/server";

import { hasAuthenticatedSession } from "@/lib/auth/require-session";
import { gatewayHeaders } from "@/lib/agent/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await hasAuthenticatedSession(request))) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const gatewayUrl = process.env.COMMERCE_GATEWAY_URL ?? "http://127.0.0.1:8787";
  const body = await request.text();
  try {
    const response = await fetch(new URL("/api/images/generations", gatewayUrl), {
      method: "POST",
      headers: gatewayHeaders({ "Content-Type": "application/json" }),
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(125_000),
    });
    const payload = await response.json().catch(() => ({ error: "生图服务返回了无效响应。" }));
    return NextResponse.json(payload, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "生图服务暂时不可用。" }, { status: 503 });
  }
}
