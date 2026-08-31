import nextEnv from "@next/env";
import { config as loadDotenv } from "dotenv";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";

nextEnv.loadEnvConfig(process.cwd());
loadDotenv({ path: resolve(process.cwd(), ".env.migration"), override: false, quiet: true });

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
if (!migrationUrl) throw new Error("MIGRATION_DATABASE_URL is required to provision a product secret handle.");

const input = readArguments(process.argv.slice(2));
const pool = new Pool({ connectionString: migrationUrl, max: 1 });
const handle = `broker:psh_${randomBytes(32).toString("base64url")}`;
try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scope = await client.query(
      `SELECT 1
       FROM commerce_workspace workspace
       INNER JOIN commerce_tenant tenant ON tenant.id=workspace.tenant_id AND tenant.status='active'
       INNER JOIN commerce_product_connector_definition definition
         ON definition.connector_key=$3 AND definition.version=$4 AND definition.status='active'
       WHERE workspace.tenant_id=$1 AND workspace.id=$2 AND workspace.status='active'`,
      [input.tenantId, input.workspaceId, input.connectorKey, input.connectorVersion],
    );
    if (scope.rowCount !== 1) throw new Error("Tenant, workspace, or connector is unavailable.");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO commerce_product_secret_handle
        (tenant_id,workspace_id,handle,label,connector_key,connector_version,env_name,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [input.tenantId, input.workspaceId, handle, input.label, input.connectorKey,
        input.connectorVersion, input.envName, input.expiresAt],
    );
    await client.query(
      `INSERT INTO commerce_enterprise_audit_event
        (tenant_id,workspace_id,actor_user_id,action,target_type,target_id,outcome,metadata)
       VALUES ($1,$2,NULL,'product_catalog.secret_handle.provision','product_secret_handle',$3,'succeeded',
               jsonb_build_object('connectorKey',$4::text,'connectorVersion',$5::text,'label',$6::text))`,
      [input.tenantId, input.workspaceId, inserted.rows[0]?.id ?? null,
        input.connectorKey, input.connectorVersion, input.label],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  console.log(JSON.stringify({
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    connectorKey: input.connectorKey,
    connectorVersion: input.connectorVersion,
    label: input.label,
    handle,
    secretValueStored: false,
  }));
} finally {
  await pool.end();
}

function readArguments(values: string[]) {
  const entries = new Map(values.map((value) => {
    const separator = value.indexOf("=");
    return separator > 2 ? [value.slice(2, separator), value.slice(separator + 1)] : [value.replace(/^--/, ""), ""];
  }));
  const tenantId = entries.get("tenant-id") ?? "";
  const workspaceId = entries.get("workspace-id") ?? "";
  const connectorKey = entries.get("connector-key") ?? "";
  const connectorVersion = entries.get("connector-version") ?? "";
  const envName = entries.get("env-name") ?? "";
  const label = (entries.get("label") ?? "").normalize("NFKC").trim();
  const expiresAtValue = entries.get("expires-at") ?? "";
  if (!isUuid(tenantId) || !isUuid(workspaceId) || !/^[a-z0-9][a-z0-9_.-]{1,79}$/.test(connectorKey) ||
      !/^\d+\.\d+\.\d+$/.test(connectorVersion) ||
      !/^COMMERCE_PRODUCT_SOURCE_[A-Z0-9_]{1,64}$/.test(envName) ||
      !label || label.length > 120) {
    throw new Error("Invalid product secret-handle provisioning arguments.");
  }
  const expiresAt = expiresAtValue ? new Date(expiresAtValue) : null;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) {
    throw new Error("--expires-at must be a future ISO timestamp.");
  }
  return {
    tenantId,
    workspaceId,
    connectorKey,
    connectorVersion,
    envName,
    label,
    expiresAt: expiresAt?.toISOString() ?? null,
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
