import { NextResponse } from "next/server";

import { hasAuthenticatedSession } from "@/lib/auth/require-session";
import { getAuthenticatedUserId } from "@/lib/auth/require-session";
import { isAgentThreadOwner } from "@/lib/agent/thread-ownership";

export const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export async function requireAgentSession(request: Request): Promise<NextResponse | null> {
  if (!(await hasAuthenticatedSession(request))) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }
  return null;
}

export async function requireAgentThreadOwner(request: Request, threadId: string): Promise<NextResponse | null> {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }
  if (!(await isAgentThreadOwner(threadId, userId))) {
    return NextResponse.json({ error: "会话不存在。" }, { status: 404 });
  }
  return null;
}

export function gatewayUrl(path: string): URL {
  return new URL(path, process.env.COMMERCE_GATEWAY_URL ?? "http://127.0.0.1:8787");
}

export function gatewayHeaders(initial?: HeadersInit): Headers {
  const headers = new Headers(initial);
  const token = process.env.COMMERCE_GATEWAY_INTERNAL_TOKEN;
  if (process.env.NODE_ENV === "production" && (!token || token.length < 32)) {
    throw new Error("COMMERCE_GATEWAY_INTERNAL_TOKEN must contain at least 32 characters in production.");
  }
  if (token) {
    headers.set("X-Commerce-Gateway-Token", token);
  }
  return headers;
}

export async function proxyGatewayJson(response: Response): Promise<NextResponse> {
  const payload = await response.json().catch(() => ({ error: "Agent Gateway 返回了无效响应。" }));
  return NextResponse.json(payload, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}
