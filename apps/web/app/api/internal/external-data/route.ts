import { NextResponse } from "next/server";
import { z } from "zod";

import { isAuthorizedGatewayCallback } from "@/lib/agent/internal-auth";
import { ExternalDataArchiveError } from "@/lib/enterprise/external-data-archive";
import {
  approveExternalDataCall,
  authorizeExternalDataCatalog,
  cancelExternalDataCall,
  dispatchExternalDataCall,
  ExternalDataGovernanceError,
  reserveExternalDataCall,
  settleExternalDataCall,
} from "@/lib/enterprise/external-data";

const MAX_CONTROL_BODY_BYTES = 6 * 1024 * 1024 + 256 * 1024;

const scopeSchema = z.object({
  tenantId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  userId: z.string().min(1).max(255),
  rootThreadId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/).nullable().optional(),
  mcpAccessTokenId: z.string().uuid().nullable().optional(),
});

const reserveSchema = scopeSchema.extend({
  action: z.literal("reserve"),
  source: z.enum(["codex_harness", "external_mcp"]),
  threadId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/).nullable().optional(),
  turnId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/).nullable().optional(),
  callId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  endpointId: z.string().regex(/^[a-z0-9_]+\.[A-Za-z0-9_.-]+$/).max(180),
  platform: z.string().regex(/^[a-z0-9_]+$/).max(64),
  parameterHash: z.string().regex(/^[a-f0-9]{64}$/),
  parameterKeys: z.array(z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/)).max(64),
  requestedApprovalMode: z.enum(["always_ask", "task", "policy"]),
});

const catalogSchema = scopeSchema.extend({
  action: z.literal("catalog"),
});

const approveSchema = scopeSchema.extend({
  action: z.literal("approve"),
  reservationId: z.string().uuid(),
});

const dispatchSchema = scopeSchema.extend({
  action: z.literal("dispatch"),
  reservationId: z.string().uuid(),
  requestPayload: z.record(z.unknown()),
});

const cancelSchema = scopeSchema.extend({
  action: z.literal("cancel"),
  reservationId: z.string().uuid(),
  reason: z.enum(["user_denied", "approval_required", "upstream_unavailable"]),
});

const settleSchema = scopeSchema.extend({
  action: z.literal("settle"),
  reservationId: z.string().uuid(),
  state: z.enum(["succeeded", "business_failed", "unknown"]),
  upstreamCode: z.number().int().nullable(),
  upstreamMessage: z.string().max(500).nullable(),
  resultBytes: z.number().int().min(0).max(50_000_000).nullable(),
  responsePayload: z.record(z.unknown()).nullable(),
});

const bodySchema = z.discriminatedUnion("action", [
  reserveSchema,
  catalogSchema,
  approveSchema,
  dispatchSchema,
  cancelSchema,
  settleSchema,
]);

export async function POST(request: Request) {
  if (!isAuthorizedGatewayCallback(request)) {
    return NextResponse.json({ error: "Unauthorized external-data callback." }, { status: 401 });
  }
  const rawBody = await request.text().catch(() => "");
  if (Buffer.byteLength(rawBody, "utf8") > MAX_CONTROL_BODY_BYTES) {
    return NextResponse.json(
      { error: "External-data control request is too large.", code: "REQUEST_BODY_TOO_LARGE" },
      { status: 413 },
    );
  }
  const parsed = bodySchema.safeParse(parseJson(rawBody));
  if (!parsed.success) return NextResponse.json({ error: "Invalid external-data request." }, { status: 400 });
  const scope = {
    tenantId: parsed.data.tenantId,
    workspaceId: parsed.data.workspaceId,
    userId: parsed.data.userId,
    rootThreadId: parsed.data.rootThreadId,
    mcpAccessTokenId: parsed.data.mcpAccessTokenId,
  };
  try {
    if (parsed.data.action === "catalog") {
      const authorization = await authorizeExternalDataCatalog(scope);
      return NextResponse.json({ authorized: true, authorization }, { headers: { "Cache-Control": "no-store" } });
    }
    if (parsed.data.action === "reserve") {
      const reservation = await reserveExternalDataCall(scope, parsed.data);
      return NextResponse.json({ reserved: true, reservation }, { headers: { "Cache-Control": "no-store" } });
    }
    if (parsed.data.action === "approve") {
      await approveExternalDataCall(scope, parsed.data.reservationId);
      return NextResponse.json({ approved: true });
    }
    if (parsed.data.action === "dispatch") {
      await dispatchExternalDataCall(scope, parsed.data.reservationId, parsed.data.requestPayload);
      return NextResponse.json({ dispatched: true });
    }
    if (parsed.data.action === "cancel") {
      await cancelExternalDataCall(scope, parsed.data.reservationId, parsed.data.reason);
      return NextResponse.json({ cancelled: true });
    }
    await settleExternalDataCall(scope, parsed.data.reservationId, parsed.data);
    return NextResponse.json({ settled: true });
  } catch (error) {
    if (error instanceof ExternalDataArchiveError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof ExternalDataGovernanceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "External-data control request failed." }, { status: 503 });
  }
}

function parseJson(value: string): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
