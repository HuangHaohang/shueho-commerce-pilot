import type { PoolClient, QueryResultRow } from "pg";

import { withEnterpriseDatabaseContext } from "@/lib/enterprise/database-context";
import type { EnterpriseScope } from "@/lib/enterprise/types";
import {
  connectorRuntimeAvailability,
  testProductConnector,
} from "@/lib/product-catalog/connector-adapters";
import {
  redactSecretReference,
  validateConnectorPublicConfig,
  validateSecretReference,
} from "@/lib/product-catalog/connector-validation";
import type {
  CreateProductSourceInput,
  ProductConnectorKind,
  ProductConnectorPublicField,
  ProductConnectorSummary,
  ProductSourceConnectionState,
  ProductSourceOperationResult,
  ProductSourceOperationStatus,
  ProductSourceSummary,
  TestProductSourceInput,
} from "@/lib/product-catalog/connector-types";
import { ProductCatalogError } from "@/lib/product-catalog/types";
import { sha256Json } from "@/lib/product-catalog/import-parser";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ConnectorDefinitionRow = QueryResultRow & {
  id: string;
  connector_key: string;
  version: string;
  source_kind: ProductConnectorKind;
  adapter_key: string;
  display_name: string;
  description: string;
  public_config_schema: Record<string, unknown>;
  config_schema_hash: string;
  capabilities: string[];
  requires_secret: boolean;
  status: "active" | "unavailable" | "deprecated";
};

type SecretHandleRow = QueryResultRow & {
  handle: string;
  label: string;
  connector_key: string;
  connector_version: string;
};

type OperationReceiptRow = QueryResultRow & {
  id: string;
  state: ProductSourceOperationStatus;
  result_code: string | null;
  result_message: string | null;
  proof: Record<string, unknown>;
  reserved_at: Date;
  completed_at: Date | null;
};

type ProductSourceRow = QueryResultRow & {
  id: string;
  name: string;
  source_kind: ProductConnectorKind;
  status: ProductSourceSummary["status"];
  public_config: Record<string, unknown>;
  credential_ref: string | null;
  connector_definition_id: string;
  connector_key: string;
  connector_version: string;
  adapter_key: string;
  definition_status: "active" | "unavailable" | "deprecated";
  connection_state: string;
  creation_idempotency_key: string | null;
  updated_at: Date;
  last_test_id: string | null;
  last_test_state: ProductSourceOperationStatus | null;
  last_test_code: string | null;
  last_test_message: string | null;
  last_test_proof: Record<string, unknown> | null;
  last_test_reserved_at: Date | null;
  last_test_completed_at: Date | null;
  last_sync_id: string | null;
  last_sync_state: ProductSourceOperationStatus | null;
  last_sync_code: string | null;
  last_sync_message: string | null;
  last_sync_proof: Record<string, unknown> | null;
  last_sync_reserved_at: Date | null;
  last_sync_completed_at: Date | null;
};

export async function listProductConnectors(scope: EnterpriseScope): Promise<ProductConnectorSummary[]> {
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const [result, registeredHandles] = await Promise.all([
      client.query<ConnectorDefinitionRow>(
      `SELECT id,connector_key,version,source_kind,adapter_key,display_name,description,
              public_config_schema,config_schema_hash,capabilities,requires_secret,status
       FROM commerce_product_connector_definition
       ORDER BY display_name,connector_key,version DESC`,
      ),
      client.query<SecretHandleRow>(
        `SELECT handle,label,connector_key,connector_version
         FROM commerce_product_secret_handle
         WHERE tenant_id=$1 AND workspace_id=$2 AND status='active'
           AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
         ORDER BY label,handle`,
        [scope.tenantId, scope.workspaceId],
      ),
    ]);
    const configuredHandles: SecretHandleRow[] = [];
    for (const handle of registeredHandles.rows) {
      const environmentName = await resolveSecretHandleEnvironmentName(client, scope, {
        handle: handle.handle,
        connectorKey: handle.connector_key,
        connectorVersion: handle.connector_version,
      });
      if (process.env[environmentName]) configuredHandles.push(handle);
    }
    return result.rows.map((row) => toConnectorSummary(
      row,
      configuredHandles
        .filter((handle) => handle.connector_key === row.connector_key && handle.connector_version === row.version)
        .map((handle) => ({ handle: handle.handle, label: handle.label })),
    ));
  });
}

export async function listProductSources(scope: EnterpriseScope): Promise<ProductSourceSummary[]> {
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query<ProductSourceRow>(sourceSelectSql(), [scope.tenantId, scope.workspaceId]);
    return Promise.all(result.rows.map(async (row) =>
      toSourceSummary(row, await sourceHasConfiguredSecret(client, scope, row))));
  });
}

export async function getProductSource(scope: EnterpriseScope, sourceId: string): Promise<ProductSourceSummary | null> {
  assertUuid(sourceId, "数据源标识");
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query<ProductSourceRow>(`${sourceSelectSql()} AND source.id=$3`, [
      scope.tenantId,
      scope.workspaceId,
      sourceId,
    ]);
    return result.rows[0]
      ? toSourceSummary(result.rows[0], await sourceHasConfiguredSecret(client, scope, result.rows[0]))
      : null;
  });
}

export async function createProductSource(
  scope: EnterpriseScope,
  input: CreateProductSourceInput,
): Promise<{ source: ProductSourceSummary; duplicate: boolean }> {
  assertUuid(input.idempotencyKey, "数据源幂等键");
  const name = normalizeSourceName(input.name);
  return withEnterpriseDatabaseContext(scope, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `product-source-create:${scope.tenantId}:${scope.workspaceId}:${input.idempotencyKey}`,
    ]);
    const existing = await client.query<ProductSourceRow>(
      `${sourceSelectSql()} AND source.creation_idempotency_key=$3`,
      [scope.tenantId, scope.workspaceId, input.idempotencyKey],
    );
    if (existing.rows[0]) {
      const existingSource = existing.rows[0];
      const proposedConfig = validateConnectorPublicConfig(existingSource.adapter_key, input.publicConfig);
      const proposedSecret = validateSecretReference(input.secretReference, existingSource.source_kind !== "file_upload");
      if (proposedSecret) {
        await requireConfiguredSecretHandle(client, scope, {
          handle: proposedSecret,
          connectorKey: existingSource.connector_key,
          connectorVersion: existingSource.connector_version,
        });
      }
      if (
        existingSource.name !== name ||
        existingSource.connector_key !== input.connectorKey ||
        existingSource.connector_version !== input.connectorVersion ||
        sha256Json(existingSource.public_config) !== sha256Json(proposedConfig) ||
        existingSource.credential_ref !== proposedSecret
      ) {
        throw new ProductCatalogError(
          "相同幂等键已用于不同的数据源配置。",
          "PRODUCT_SOURCE_IDEMPOTENCY_CONFLICT",
          409,
        );
      }
      return {
        source: toSourceSummary(
          existingSource,
          await sourceHasConfiguredSecret(client, scope, existingSource),
        ),
        duplicate: true,
      };
    }

    const definition = await requireConnectorDefinition(client, input.connectorKey, input.connectorVersion);
    if (definition.status !== "active") {
      throw new ProductCatalogError("该连接器定义已停用。", "PRODUCT_CONNECTOR_DISABLED", 409);
    }
    const publicConfig = validateConnectorPublicConfig(definition.adapter_key, input.publicConfig);
    const secretReference = validateSecretReference(input.secretReference, definition.requires_secret);
    const resolvedSecret = secretReference
      ? await requireConfiguredSecretHandle(client, scope, {
          handle: secretReference,
          connectorKey: definition.connector_key,
          connectorVersion: definition.version,
        })
      : null;
    const availability = connectorRuntimeAvailability(definition.adapter_key, Boolean(resolvedSecret));
    const connectionState = definition.source_kind === "file_upload"
      ? "ready"
      : definition.status !== "active" || availability.availability === "unavailable"
        ? "unavailable"
        : secretReference
          ? "untested"
          : "unconfigured";
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `product-source-name:${scope.tenantId}:${scope.workspaceId}:${name.toLocaleLowerCase("en-US")}`,
    ]);
    const sameName = await client.query<{ id: string }>(
      `SELECT id FROM commerce_product_source
       WHERE tenant_id=$1 AND workspace_id=$2 AND lower(name)=lower($3) AND status<>'archived' LIMIT 1`,
      [scope.tenantId, scope.workspaceId, name],
    );
    if (sameName.rows[0]) {
      throw new ProductCatalogError("当前工作区已有同名产品数据源。", "PRODUCT_SOURCE_NAME_CONFLICT", 409);
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO commerce_product_source (
         tenant_id,workspace_id,source_kind,name,connector_key,connector_version,
         credential_ref,public_config,status,created_by_user_id,connector_definition_id,
         config_schema_hash,connection_state,creation_idempotency_key
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'active',$9,$10,$11,$12,$13)
       RETURNING id`,
      [scope.tenantId, scope.workspaceId, definition.source_kind, name,
        definition.connector_key, definition.version, secretReference, JSON.stringify(publicConfig),
        scope.userId, definition.id, definition.config_schema_hash, connectionState, input.idempotencyKey],
    );
    const sourceId = inserted.rows[0]?.id;
    if (!sourceId) throw new ProductCatalogError("无法创建产品数据源。", "PRODUCT_SOURCE_CREATE_FAILED", 500);
    await client.query(
      `INSERT INTO commerce_enterprise_audit_event
        (tenant_id,workspace_id,actor_user_id,action,target_type,target_id,outcome,metadata)
       VALUES ($1,$2,$3,'product_catalog.source.create','product_source',$4,'succeeded',
               jsonb_build_object('connectorKey',$5::text,'connectorVersion',$6::text,'sourceKind',$7::text))`,
      [scope.tenantId, scope.workspaceId, scope.userId, sourceId,
        definition.connector_key, definition.version, definition.source_kind],
    );
    const source = await requireSourceRow(client, scope, sourceId);
    return { source: toSourceSummary(source, Boolean(resolvedSecret)), duplicate: false };
  });
}

export async function testProductSourceConnection(
  scope: EnterpriseScope,
  input: TestProductSourceInput,
): Promise<{ test: ProductSourceOperationResult; source: ProductSourceSummary; duplicate: boolean }> {
  assertUuid(input.sourceId, "数据源标识");
  assertUuid(input.idempotencyKey, "测试幂等键");
  const reservation = await withEnterpriseDatabaseContext(scope, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `product-source-test:${scope.tenantId}:${scope.workspaceId}:${input.sourceId}:${input.idempotencyKey}`,
    ]);
    const source = await requireSourceRow(client, scope, input.sourceId);
    if (source.status === "archived") {
      throw new ProductCatalogError("已归档数据源不能测试连接。", "PRODUCT_SOURCE_ARCHIVED", 409);
    }
    if (source.source_kind === "file_upload") {
      throw new ProductCatalogError("文件导入无需连接测试。", "PRODUCT_SOURCE_TEST_NOT_SUPPORTED", 409);
    }
    const existing = await client.query<OperationReceiptRow>(
      `SELECT id,state,result_code,result_message,proof,reserved_at,completed_at
       FROM commerce_product_source_operation_receipt
       WHERE tenant_id=$1 AND workspace_id=$2 AND source_id=$3
         AND operation='test' AND idempotency_key=$4`,
      [scope.tenantId, scope.workspaceId, input.sourceId, input.idempotencyKey],
    );
    if (existing.rows[0]) {
      const receipt = existing.rows[0].state === "running" && isStaleReceipt(existing.rows[0])
        ? await recoverStaleTestReceipt(client, scope, source.id, existing.rows[0])
        : existing.rows[0];
      return { source: await requireSourceRow(client, scope, source.id), receipt, execute: false as const };
    }
    const otherRunning = await client.query<OperationReceiptRow>(
      `SELECT id,state,result_code,result_message,proof,reserved_at,completed_at
       FROM commerce_product_source_operation_receipt
       WHERE tenant_id=$1 AND workspace_id=$2 AND source_id=$3
         AND operation='test' AND state='running'
       ORDER BY reserved_at DESC LIMIT 1`,
      [scope.tenantId, scope.workspaceId, input.sourceId],
    );
    if (otherRunning.rows[0]) {
      if (!isStaleReceipt(otherRunning.rows[0])) {
        throw new ProductCatalogError("该数据源已有连接测试正在运行。", "PRODUCT_SOURCE_TEST_IN_PROGRESS", 409);
      }
      await recoverStaleTestReceipt(client, scope, source.id, otherRunning.rows[0]);
    }
    const receipt = await client.query<OperationReceiptRow>(
      `INSERT INTO commerce_product_source_operation_receipt (
        tenant_id,workspace_id,source_id,connector_definition_id,operation,idempotency_key,
        state,proof,created_by_user_id
       ) VALUES ($1,$2,$3,$4,'test',$5,'running','{}'::jsonb,$6)
       RETURNING id,state,result_code,result_message,proof,reserved_at,completed_at`,
      [scope.tenantId, scope.workspaceId, input.sourceId, source.connector_definition_id,
        input.idempotencyKey, scope.userId],
    );
    const row = receipt.rows[0];
    if (!row) throw new ProductCatalogError("无法保留连接测试。", "PRODUCT_SOURCE_TEST_RESERVE_FAILED", 500);
    return { source, receipt: row, execute: true as const };
  });

  if (!reservation.execute) {
    const secretConfigured = await withEnterpriseDatabaseContext(scope, (client) =>
      sourceHasConfiguredSecret(client, scope, reservation.source));
    return {
      test: toOperationResult(reservation.receipt),
      source: toSourceSummary(reservation.source, secretConfigured),
      duplicate: true,
    };
  }

  const resolvedSecret = await withEnterpriseDatabaseContext(scope, (client) =>
    requireSourceSecret(client, scope, reservation.source));
  const adapterResult = await testProductConnector({
    adapterKey: reservation.source.adapter_key,
    resolvedSecret,
    publicConfig: reservation.source.public_config,
  });
  return withEnterpriseDatabaseContext(scope, async (client) => {
    await requireSourceRow(client, scope, input.sourceId);
    const state = adapterResult.status;
    const audit = await client.query<{ id: string }>(
      `INSERT INTO commerce_enterprise_audit_event
        (tenant_id,workspace_id,actor_user_id,action,target_type,target_id,outcome,metadata)
       VALUES ($1,$2,$3,'product_catalog.source.test','product_source',$4,$5,
               jsonb_build_object('receiptId',$6::uuid,'resultCode',$7::text,'readOnly',$8::boolean))
       RETURNING id`,
      [scope.tenantId, scope.workspaceId, scope.userId, input.sourceId,
        state === "succeeded" ? "succeeded" : "failed", reservation.receipt.id,
        adapterResult.code, adapterResult.proof.readOnly],
    );
    const auditEventId = audit.rows[0]?.id;
    if (!auditEventId) throw new ProductCatalogError("无法记录连接测试审计。", "PRODUCT_SOURCE_TEST_AUDIT_FAILED", 500);
    const updated = await client.query<OperationReceiptRow>(
      `UPDATE commerce_product_source_operation_receipt
       SET state=$5,result_code=$6,result_message=$7,proof=$8::jsonb,
           audit_event_id=$9,completed_at=CURRENT_TIMESTAMP
       WHERE tenant_id=$1 AND workspace_id=$2 AND source_id=$3 AND id=$4 AND state='running'
       RETURNING id,state,result_code,result_message,proof,reserved_at,completed_at`,
      [scope.tenantId, scope.workspaceId, input.sourceId, reservation.receipt.id,
        state, adapterResult.code, adapterResult.message, JSON.stringify(adapterResult.proof), auditEventId],
    );
    const receipt = updated.rows[0];
    if (!receipt) {
      throw new ProductCatalogError("连接测试状态已被其他请求处理。", "PRODUCT_SOURCE_TEST_STATE_CONFLICT", 409);
    }
    return {
      test: toOperationResult(receipt),
      source: await requireSourceRow(client, scope, input.sourceId).then(async (source) =>
        toSourceSummary(source, await sourceHasConfiguredSecret(client, scope, source))),
      duplicate: false,
    };
  });
}

async function requireConnectorDefinition(
  client: PoolClient,
  connectorKey: string,
  version: string,
): Promise<ConnectorDefinitionRow> {
  if (!/^[a-z0-9][a-z0-9_.-]{1,79}$/.test(connectorKey) || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new ProductCatalogError("连接器标识或版本无效。", "PRODUCT_CONNECTOR_ID_INVALID", 400);
  }
  const result = await client.query<ConnectorDefinitionRow>(
    `SELECT id,connector_key,version,source_kind,adapter_key,display_name,description,
            public_config_schema,config_schema_hash,capabilities,requires_secret,status
     FROM commerce_product_connector_definition WHERE connector_key=$1 AND version=$2`,
    [connectorKey, version],
  );
  const row = result.rows[0];
  if (!row) throw new ProductCatalogError("连接器定义不存在。", "PRODUCT_CONNECTOR_NOT_FOUND", 404);
  return row;
}

async function requireSourceRow(client: PoolClient, scope: EnterpriseScope, sourceId: string): Promise<ProductSourceRow> {
  const result = await client.query<ProductSourceRow>(`${sourceSelectSql()} AND source.id=$3`, [
    scope.tenantId,
    scope.workspaceId,
    sourceId,
  ]);
  const row = result.rows[0];
  if (!row) throw new ProductCatalogError("产品数据源不存在。", "PRODUCT_SOURCE_NOT_FOUND", 404);
  return row;
}

function sourceSelectSql(): string {
  return `
    SELECT source.id,source.name,source.source_kind,source.status,source.public_config,
           source.credential_ref,source.connector_definition_id,definition.connector_key,
           definition.version AS connector_version,definition.adapter_key,
           definition.status AS definition_status,source.connection_state,
           source.creation_idempotency_key,source.updated_at,
           test.id AS last_test_id,test.state AS last_test_state,test.result_code AS last_test_code,
           test.result_message AS last_test_message,test.proof AS last_test_proof,
           test.reserved_at AS last_test_reserved_at,test.completed_at AS last_test_completed_at,
           sync.id AS last_sync_id,sync.state AS last_sync_state,sync.result_code AS last_sync_code,
           sync.result_message AS last_sync_message,sync.proof AS last_sync_proof,
           sync.reserved_at AS last_sync_reserved_at,sync.completed_at AS last_sync_completed_at
    FROM commerce_product_source source
    JOIN commerce_product_connector_definition definition ON definition.id=source.connector_definition_id
    LEFT JOIN commerce_product_source_operation_receipt test
      ON test.tenant_id=source.tenant_id AND test.workspace_id=source.workspace_id
     AND test.source_id=source.id AND test.id=source.last_test_receipt_id AND test.operation='test'
    LEFT JOIN commerce_product_source_operation_receipt sync
      ON sync.tenant_id=source.tenant_id AND sync.workspace_id=source.workspace_id
     AND sync.source_id=source.id AND sync.id=source.last_sync_receipt_id AND sync.operation='sync'
    WHERE source.tenant_id=$1 AND source.workspace_id=$2
  `;
}

function toConnectorSummary(
  row: ConnectorDefinitionRow,
  handles: Array<{ handle: string; label: string }>,
): ProductConnectorSummary {
  const runtime = row.status === "active"
    ? connectorRuntimeAvailability(row.adapter_key, handles.length > 0)
    : { availability: "unavailable" as const, reason: "连接器定义已停用。", testConnection: false, sync: false as const };
  return {
    key: row.connector_key,
    version: row.version,
    displayName: row.display_name,
    description: row.description,
    kind: row.source_kind,
    adapterAvailability: runtime.availability,
    availabilityReason: runtime.reason,
    capabilities: { testConnection: runtime.testConnection, sync: false },
    publicConfigFields: publicFieldsForAdapter(row.adapter_key),
    secretReference: {
      required: row.requires_secret,
      allowedSchemes: row.requires_secret ? ["broker"] : [],
      handles,
    },
  };
}

function toSourceSummary(row: ProductSourceRow, secretConfigured: boolean): ProductSourceSummary {
  const runtime = row.definition_status === "active"
    ? connectorRuntimeAvailability(row.adapter_key, secretConfigured)
    : { availability: "unavailable" as const, reason: "连接器定义已停用。", testConnection: false, sync: false as const };
  return {
    id: row.id,
    name: row.name,
    connectorKey: row.connector_key,
    connectorVersion: row.connector_version,
    kind: row.source_kind,
    status: row.status,
    connectionState: publicConnectionState(row.connection_state),
    adapterAvailability: runtime.availability,
    publicConfig: row.public_config ?? {},
    secretReference: redactSecretReference(row.credential_ref),
    lastTest: operationFromSource(row, "test"),
    lastSync: operationFromSource(row, "sync"),
    sync: { available: false, reason: "首版多 Connector 仅开放配置与真实连接测试；同步尚未启用。" },
    updatedAt: row.updated_at.toISOString(),
  };
}

function operationFromSource(row: ProductSourceRow, operation: "test" | "sync"): ProductSourceOperationResult | null {
  const prefix = operation === "test" ? "last_test" : "last_sync";
  const id = row[`${prefix}_id` as keyof ProductSourceRow];
  if (typeof id !== "string") return null;
  const state = row[`${prefix}_state` as keyof ProductSourceRow] as ProductSourceOperationStatus | null;
  const code = row[`${prefix}_code` as keyof ProductSourceRow];
  const message = row[`${prefix}_message` as keyof ProductSourceRow];
  const proof = row[`${prefix}_proof` as keyof ProductSourceRow] as Record<string, unknown> | null;
  const at = row[`${prefix}_completed_at` as keyof ProductSourceRow] as Date | null ??
    row[`${prefix}_reserved_at` as keyof ProductSourceRow] as Date | null;
  return {
    id,
    status: state ?? "unknown",
    testedAt: at?.toISOString() ?? row.updated_at.toISOString(),
    code: typeof code === "string" ? code : "SOURCE_OPERATION_UNKNOWN",
    message: typeof message === "string" ? message : "连接器操作状态未知。",
    proof: readProof(proof),
  };
}

function toOperationResult(row: OperationReceiptRow): ProductSourceOperationResult {
  return {
    id: row.id,
    status: row.state,
    testedAt: (row.completed_at ?? row.reserved_at).toISOString(),
    code: row.result_code ?? (row.state === "running" ? "CONNECTION_TEST_RUNNING" : "SOURCE_OPERATION_UNKNOWN"),
    message: row.result_message ?? (row.state === "running" ? "连接测试正在运行。" : "连接器操作状态未知。"),
    proof: readProof(row.proof),
  };
}

function readProof(value: Record<string, unknown> | null): ProductSourceOperationResult["proof"] {
  return {
    readOnly: value?.readOnly === true,
    selectAllowed: value?.selectAllowed === true,
    writePrivileges: value?.writePrivileges === true,
  };
}

function publicFieldsForAdapter(adapterKey: string): ProductConnectorPublicField[] {
  if (adapterKey === "postgres_readonly_v1") {
    return [
      { key: "schema", label: "Schema", type: "text", required: true },
      { key: "table", label: "产品表", type: "text", required: true },
    ];
  }
  if (adapterKey === "managed_rest_v1") {
    return [
      { key: "connectionProfile", label: "运维连接配置", type: "text", required: true },
      { key: "resource", label: "产品资源", type: "text", required: true },
    ];
  }
  if (adapterKey === "managed_erp_v1" || adapterKey === "managed_pim_v1") {
    return [
      { key: "systemProfile", label: "运维系统配置", type: "text", required: true },
      { key: "entity", label: "产品实体", type: "text", required: true },
    ];
  }
  return [];
}

function normalizeSourceName(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > 160 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new ProductCatalogError("产品数据源名称无效。", "PRODUCT_SOURCE_NAME_INVALID", 422);
  }
  return normalized;
}

async function recoverStaleTestReceipt(
  client: PoolClient,
  scope: EnterpriseScope,
  sourceId: string,
  receipt: OperationReceiptRow,
): Promise<OperationReceiptRow> {
  const audit = await client.query<{ id: string }>(
    `INSERT INTO commerce_enterprise_audit_event
      (tenant_id,workspace_id,actor_user_id,action,target_type,target_id,outcome,metadata)
     VALUES ($1,$2,$3,'product_catalog.source.test.recover','product_source',$4,'failed',
             jsonb_build_object('receiptId',$5::uuid,'reason','stale_running_receipt'))
     RETURNING id`,
    [scope.tenantId, scope.workspaceId, scope.userId, sourceId, receipt.id],
  );
  const auditId = audit.rows[0]?.id;
  if (!auditId) throw new ProductCatalogError("无法记录连接测试恢复审计。", "PRODUCT_SOURCE_TEST_AUDIT_FAILED", 500);
  const updated = await client.query<OperationReceiptRow>(
    `UPDATE commerce_product_source_operation_receipt
     SET state='unknown',result_code='CONNECTION_TEST_ABANDONED',
         result_message='上一次连接测试未留下确定结果，系统不会自动重试。',
         audit_event_id=$5,completed_at=CURRENT_TIMESTAMP
     WHERE tenant_id=$1 AND workspace_id=$2 AND source_id=$3 AND id=$4 AND state='running'
     RETURNING id,state,result_code,result_message,proof,reserved_at,completed_at`,
    [scope.tenantId, scope.workspaceId, sourceId, receipt.id, auditId],
  );
  const row = updated.rows[0];
  if (!row) throw new ProductCatalogError("连接测试恢复发生状态冲突。", "PRODUCT_SOURCE_TEST_STATE_CONFLICT", 409);
  return row;
}

function isStaleReceipt(receipt: OperationReceiptRow): boolean {
  return Date.now() - receipt.reserved_at.getTime() > 2 * 60 * 1000;
}

function publicConnectionState(value: string): ProductSourceConnectionState {
  if (value === "ready" || value === "error" || value === "unavailable") return value;
  if (value === "unconfigured") return "unconfigured";
  if (value === "disabled") return "unavailable";
  return "untested";
}

function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) throw new ProductCatalogError(`${label}无效。`, "PRODUCT_SOURCE_ID_INVALID", 400);
}

async function sourceHasConfiguredSecret(
  client: PoolClient,
  scope: EnterpriseScope,
  source: ProductSourceRow,
): Promise<boolean> {
  if (source.source_kind === "file_upload") return true;
  if (!source.credential_ref) return false;
  try {
    const environmentName = await resolveSecretHandleEnvironmentName(client, scope, {
      handle: source.credential_ref,
      connectorKey: source.connector_key,
      connectorVersion: source.connector_version,
    });
    return Boolean(process.env[environmentName]);
  } catch {
    return false;
  }
}

async function requireSourceSecret(
  client: PoolClient,
  scope: EnterpriseScope,
  source: ProductSourceRow,
): Promise<string | null> {
  if (source.source_kind === "file_upload") return null;
  if (!source.credential_ref) {
    throw new ProductCatalogError("产品数据源没有绑定安全连接。", "PRODUCT_SOURCE_SECRET_HANDLE_REQUIRED", 409);
  }
  return requireConfiguredSecretHandle(client, scope, {
    handle: source.credential_ref,
    connectorKey: source.connector_key,
    connectorVersion: source.connector_version,
  });
}

async function requireConfiguredSecretHandle(
  client: PoolClient,
  scope: EnterpriseScope,
  input: { handle: string; connectorKey: string; connectorVersion: string },
): Promise<string> {
  let environmentName: string;
  try {
    environmentName = await resolveSecretHandleEnvironmentName(client, scope, input);
  } catch {
    throw new ProductCatalogError(
      "当前工作区没有可用的服务器签发连接句柄。",
      "PRODUCT_SOURCE_SECRET_HANDLE_UNAVAILABLE",
      409,
    );
  }
  const secret = process.env[environmentName];
  if (!secret) {
    throw new ProductCatalogError(
      "服务器尚未挂载该连接句柄对应的密钥。",
      "PRODUCT_SOURCE_SECRET_NOT_MOUNTED",
      409,
    );
  }
  return secret;
}

async function resolveSecretHandleEnvironmentName(
  client: PoolClient,
  scope: EnterpriseScope,
  input: { handle: string; connectorKey: string; connectorVersion: string },
): Promise<string> {
  const result = await client.query<{ env_name: string }>(
    `SELECT commerce_resolve_product_secret_handle($1,$2,$3,$4,$5) AS env_name`,
    [scope.tenantId, scope.workspaceId, input.handle, input.connectorKey, input.connectorVersion],
  );
  const environmentName = result.rows[0]?.env_name;
  if (!environmentName || !/^COMMERCE_PRODUCT_SOURCE_[A-Z0-9_]{1,64}$/.test(environmentName)) {
    throw new Error("Product secret handle resolution failed.");
  }
  return environmentName;
}
