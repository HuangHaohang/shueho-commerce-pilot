import { withEnterpriseDatabaseContext } from "@/lib/enterprise/database-context";
import type { EnterpriseScope } from "@/lib/enterprise/types";

export type EnterpriseRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export async function consumeEnterpriseRateLimit(
  scope: EnterpriseScope,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<EnterpriseRateLimitResult> {
  return withEnterpriseDatabaseContext(scope, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `rate:${scope.tenantId}:${scope.workspaceId}:${scope.userId}:${bucket}`,
    ]);
    const result = await client.query<{ request_count: number; retry_after: number }>(
      `
        INSERT INTO commerce_enterprise_rate_limit
          (tenant_id, workspace_id, user_id, bucket, window_started_at, request_count)
        VALUES (
          $1, $2, $3, $4,
          to_timestamp(floor(extract(epoch FROM CURRENT_TIMESTAMP) / $5) * $5),
          1
        )
        ON CONFLICT (tenant_id, workspace_id, user_id, bucket) DO UPDATE
        SET request_count = CASE
              WHEN commerce_enterprise_rate_limit.window_started_at
                   < CURRENT_TIMESTAMP - make_interval(secs => $5)
              THEN 1 ELSE commerce_enterprise_rate_limit.request_count + 1 END,
            window_started_at = CASE
              WHEN commerce_enterprise_rate_limit.window_started_at
                   < CURRENT_TIMESTAMP - make_interval(secs => $5)
              THEN to_timestamp(floor(extract(epoch FROM CURRENT_TIMESTAMP) / $5) * $5)
              ELSE commerce_enterprise_rate_limit.window_started_at END,
            updated_at = CURRENT_TIMESTAMP
        RETURNING request_count,
          GREATEST(1, ceil(extract(epoch FROM (window_started_at + make_interval(secs => $5) - CURRENT_TIMESTAMP))))::integer
            AS retry_after
      `,
      [scope.tenantId, scope.workspaceId, scope.userId, bucket, windowSeconds],
    );
    const row = result.rows[0];
    if (!row || row.request_count <= limit) return { allowed: true };
    await client.query(
      `
        INSERT INTO commerce_enterprise_audit_event
          (tenant_id, workspace_id, actor_user_id, action, target_type, outcome, metadata)
        VALUES ($1, $2, $3, 'api.rate_limit', 'api_bucket', 'denied',
                jsonb_build_object('bucket', $4::text, 'limit', $5::integer, 'windowSeconds', $6::integer))
      `,
      [scope.tenantId, scope.workspaceId, scope.userId, bucket, limit, windowSeconds],
    );
    return { allowed: false, retryAfterSeconds: row.retry_after };
  });
}

export async function enforceEnterpriseRateLimit(
  scope: EnterpriseScope,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<NextResponse | null> {
  try {
    const result = await consumeEnterpriseRateLimit(scope, bucket, limit, windowSeconds);
    if (result.allowed) return null;
    return NextResponse.json(
      { error: "请求过于频繁，请稍后重试。", code: "ENTERPRISE_RATE_LIMIT" },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(result.retryAfterSeconds),
        },
      },
    );
  } catch {
    return NextResponse.json({ error: "企业限流服务暂时不可用。" }, { status: 503 });
  }
}
import { NextResponse } from "next/server";
