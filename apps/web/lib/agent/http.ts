import { NextResponse } from "next/server";

import { isAgentThreadOwner } from "@/lib/agent/thread-ownership";
import {
  requireEnterprisePermission,
  resolveEnterpriseContext,
  type EnterpriseContextResult,
} from "@/lib/enterprise/context";
import type { EnterprisePermission } from "@/lib/enterprise/permissions";
import type { EnterpriseContext, EnterpriseScope } from "@/lib/enterprise/types";

export const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

const requestContexts = new WeakMap<Request, EnterpriseContext>();

export async function requireAgentSession(request: Request): Promise<NextResponse | null> {
  const result = await requireAgentContext(request);
  return result.ok ? null : result.response;
}

export async function requireAgentContext(
  request: Request,
  permission?: EnterprisePermission,
): Promise<EnterpriseContextResult> {
  const cached = requestContexts.get(request);
  if (cached) {
    const denied = permission ? requireEnterprisePermission(cached, permission) : null;
    return denied ? { ok: false, response: denied } : { ok: true, context: cached };
  }
  const result = await resolveEnterpriseContext(request);
  if (!result.ok) return result;
  const denied = permission ? requireEnterprisePermission(result.context, permission) : null;
  if (denied) return { ok: false, response: denied };
  requestContexts.set(request, result.context);
  return result;
}

export async function requireAgentThreadContext(
  request: Request,
  threadId: string,
  permission: EnterprisePermission = "thread.read.own",
): Promise<EnterpriseContextResult> {
  const result = await requireAgentContext(request, permission);
  if (!result.ok) return result;
  if (!(await isAgentThreadOwner(threadId, result.context))) {
    return { ok: false, response: NextResponse.json({ error: "会话不存在。" }, { status: 404 }) };
  }
  return result;
}

export async function requireAgentThreadOwner(request: Request, threadId: string): Promise<NextResponse | null> {
  const result = await requireAgentThreadContext(request, threadId);
  return result.ok ? null : result.response;
}

export function gatewayUrl(path: string): URL {
  return new URL(path, process.env.COMMERCE_GATEWAY_URL ?? "http://127.0.0.1:8787");
}

export function gatewayHeaders(initial?: HeadersInit, context?: EnterpriseScope): Headers {
  const headers = new Headers(initial);
  const token = process.env.COMMERCE_GATEWAY_INTERNAL_TOKEN;
  if (process.env.NODE_ENV === "production" && (!token || token.length < 32)) {
    throw new Error("COMMERCE_GATEWAY_INTERNAL_TOKEN must contain at least 32 characters in production.");
  }
  if (token) headers.set("X-Commerce-Gateway-Token", token);
  if (context) {
    headers.set("X-Commerce-Tenant-Id", context.tenantId);
    headers.set("X-Commerce-Workspace-Id", context.workspaceId);
    headers.set("X-Commerce-User-Id", context.userId);
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
