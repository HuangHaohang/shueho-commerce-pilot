import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

import type { EnterpriseScope } from "@/lib/enterprise/types";

const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;
const FORBIDDEN_REQUEST_KEY = /^(?:authorization|cookie|password|secret|token|api[_-]?key)$/i;

export type ExternalDataArchiveCallIdentity = {
  externalCallId: string;
  source: "codex_harness" | "external_mcp";
  sourceCallId: string;
  endpointId: string;
  platform: string;
  rootThreadId: string | null;
  threadId: string | null;
  turnId: string | null;
  retentionDays: number | null;
};

export class ExternalDataArchiveError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ExternalDataArchiveError";
  }
}

export async function recordExternalDataArchiveDispatch(
  client: PoolClient,
  scope: EnterpriseScope,
  call: ExternalDataArchiveCallIdentity,
  requestPayload: Record<string, unknown>,
): Promise<string> {
  assertExternalDataArchiveRequestSafe(requestPayload);
  const prepared = preparePayload(requestPayload, MAX_REQUEST_BYTES, "请求");
  const result = await client.query<{ id: string; request_sha256: string }>(
    `INSERT INTO commerce_external_data_archive (
       tenant_id, workspace_id, user_id, provider, source, source_call_id,
       external_call_id, endpoint_id, platform, root_thread_id, thread_id, turn_id,
       state, request_payload, request_sha256, request_bytes, retention_until
     ) VALUES (
       $1, $2, $3, 'justoneapi', $4, $5, $6, $7, $8, $9, $10, $11,
       'dispatched', $12::jsonb, $13, $14,
       CASE WHEN $15::integer IS NULL THEN NULL
            ELSE CURRENT_TIMESTAMP + make_interval(days => $15::integer) END
     )
     ON CONFLICT (tenant_id, source, source_call_id) DO UPDATE
     SET external_call_id = COALESCE(commerce_external_data_archive.external_call_id, EXCLUDED.external_call_id),
         updated_at = CURRENT_TIMESTAMP
     WHERE commerce_external_data_archive.workspace_id = EXCLUDED.workspace_id
       AND commerce_external_data_archive.user_id = EXCLUDED.user_id
       AND commerce_external_data_archive.endpoint_id = EXCLUDED.endpoint_id
       AND commerce_external_data_archive.request_sha256 = EXCLUDED.request_sha256
     RETURNING id, request_sha256`,
    [
      scope.tenantId,
      scope.workspaceId,
      scope.userId,
      call.source,
      call.sourceCallId,
      call.externalCallId,
      call.endpointId,
      call.platform,
      call.rootThreadId,
      call.threadId,
      call.turnId,
      prepared.json,
      prepared.sha256,
      prepared.bytes,
      call.retentionDays,
    ],
  );
  const row = result.rows[0];
  if (!row || row.request_sha256 !== prepared.sha256) {
    throw new ExternalDataArchiveError(
      "外部数据请求归档发生调用标识冲突。",
      "EXTERNAL_DATA_ARCHIVE_CONFLICT",
      409,
    );
  }
  return row.id;
}

export async function recordExternalDataArchiveSettlement(
  client: PoolClient,
  scope: EnterpriseScope,
  externalCallId: string,
  input: {
    state: "succeeded" | "business_failed" | "unknown";
    upstreamCode: number | null;
    responsePayload: Record<string, unknown> | null;
  },
): Promise<string> {
  if (input.state === "unknown" && input.responsePayload !== null) {
    throw new ExternalDataArchiveError(
      "结果不确定的调用不能归档未经确认的响应。",
      "EXTERNAL_DATA_ARCHIVE_UNKNOWN_RESPONSE",
      400,
    );
  }
  if (input.state !== "unknown" && input.responsePayload === null) {
    throw new ExternalDataArchiveError(
      "终态外部数据调用缺少完整响应。",
      "EXTERNAL_DATA_ARCHIVE_RESPONSE_REQUIRED",
      400,
    );
  }
  const prepared = input.responsePayload
    ? preparePayload(input.responsePayload, MAX_RESPONSE_BYTES, "响应")
    : null;
  const rawResponse = isRecord(input.responsePayload?.raw) ? input.responsePayload.raw : null;
  const upstreamRequestId = readString(
    input.responsePayload?.requestId ?? rawResponse?.requestId,
    255,
  );
  const providerRecordedAt = readDate(
    input.responsePayload?.recordTime ?? rawResponse?.recordTime,
  );
  const warehouseResearchRequestId = readUuid(input.responsePayload?.research_request_id);
  const warehouseRawCallId = readUuid(input.responsePayload?.raw_archive_id);
  const warehouseQueryKey = readHash(input.responsePayload?.query_key);
  const result = await client.query<{ id: string }>(
    `UPDATE commerce_external_data_archive
     SET state = $5,
         response_payload = $6::jsonb,
         response_sha256 = $7,
         response_bytes = $8,
         upstream_code = $9,
         upstream_request_id = $10,
         provider_recorded_at = $11,
         warehouse_research_request_id = $12,
         warehouse_raw_call_id = $13,
         warehouse_query_key = $14,
         completed_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE external_call_id = $1 AND tenant_id = $2 AND workspace_id = $3 AND user_id = $4
       AND (
         state = 'dispatched'
         OR (
           state = $5
           AND response_sha256 IS NOT DISTINCT FROM $7
           AND upstream_code IS NOT DISTINCT FROM $9
         )
       )
     RETURNING id`,
    [
      externalCallId,
      scope.tenantId,
      scope.workspaceId,
      scope.userId,
      input.state,
      prepared?.json ?? null,
      prepared?.sha256 ?? null,
      prepared?.bytes ?? null,
      input.upstreamCode,
      upstreamRequestId,
      providerRecordedAt,
      warehouseResearchRequestId,
      warehouseRawCallId,
      warehouseQueryKey,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new ExternalDataArchiveError(
      "外部数据响应归档状态无效。",
      "EXTERNAL_DATA_ARCHIVE_SETTLEMENT_STALE",
      409,
    );
  }
  return id;
}

function preparePayload(
  payload: Record<string, unknown>,
  maximumBytes: number,
  label: string,
): { json: string; sha256: string; bytes: number } {
  const json = stableStringify(payload);
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes < 2 || bytes > maximumBytes) {
    throw new ExternalDataArchiveError(
      `外部数据${label}归档大小无效。`,
      "EXTERNAL_DATA_ARCHIVE_SIZE_INVALID",
      413,
    );
  }
  return {
    json,
    sha256: createHash("sha256").update(json).digest("hex"),
    bytes,
  };
}

export function assertExternalDataArchiveRequestSafe(value: unknown, depth = 0): void {
  if (depth > 16) {
    throw new ExternalDataArchiveError(
      "外部数据请求层级过深。",
      "EXTERNAL_DATA_ARCHIVE_DEPTH_INVALID",
      400,
    );
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => assertExternalDataArchiveRequestSafe(entry, depth + 1));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_REQUEST_KEY.test(key)) {
      throw new ExternalDataArchiveError(
        "外部数据请求归档不得包含凭证字段。",
        "EXTERNAL_DATA_ARCHIVE_SECRET_DENIED",
        400,
      );
    }
    assertExternalDataArchiveRequestSafe(entry, depth + 1);
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function readString(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, maximum)
    : null;
}

function readDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readUuid(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
    ? value
    : null;
}

function readHash(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
