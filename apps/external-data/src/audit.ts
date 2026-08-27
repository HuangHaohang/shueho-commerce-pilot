import type { PoolClient } from "pg";

import type { JsonObject } from "./types.js";

export async function recordServiceAudit(
  client: PoolClient,
  scope: { tenantId: string; workspaceId: string },
  input: {
    researchRequestId?: string | null;
    rawCallId?: string | null;
    action: string;
    outcome: "allowed" | "succeeded" | "failed" | "unknown";
    metadata?: JsonObject;
  },
): Promise<void> {
  assertServiceAuditMetadataSafe(input.metadata ?? {});
  await client.query(`
    INSERT INTO service_audit_event (
      tenant_id,workspace_id,research_request_id,raw_call_id,action,outcome,metadata
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
  `, [scope.tenantId, scope.workspaceId, input.researchRequestId ?? null,
    input.rawCallId ?? null, input.action, input.outcome,
    JSON.stringify(input.metadata ?? {})]);
}

export function assertServiceAuditMetadataSafe(value: unknown, depth = 0): void {
  if (depth > 8) throw new Error("Audit metadata is too deeply nested.");
  if (Array.isArray(value)) {
    value.forEach((entry) => assertServiceAuditMetadataSafe(entry, depth + 1));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/token|secret|password|authorization|cookie|prompt|request_text|response|params|content/i.test(key)) {
      throw new Error(`Audit metadata key ${key} is forbidden.`);
    }
    assertServiceAuditMetadataSafe(child, depth + 1);
  }
}
