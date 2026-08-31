import { Client } from "pg";

import type {
  ConnectorTestAdapterResult,
  ProductConnectorAvailability,
} from "@/lib/product-catalog/connector-types";

const EMPTY_PROOF = { readOnly: false, selectAllowed: false, writePrivileges: false };

export function connectorRuntimeAvailability(
  adapterKey: string,
  secretConfigured = false,
): { availability: ProductConnectorAvailability; reason: string | null; testConnection: boolean; sync: false } {
  if (adapterKey === "file_upload_v1") {
    return { availability: "ready", reason: null, testConnection: false, sync: false };
  }
  if (adapterKey === "postgres_readonly_v1") {
    return secretConfigured
      ? { availability: "ready", reason: null, testConnection: true, sync: false }
      : {
          availability: "requires_operator_configuration",
          reason: "需要运维预置只读数据库 secret reference 后才能测试。",
          testConnection: true,
          sync: false,
        };
  }
  return {
    availability: "unavailable",
    reason: "该应用托管适配器尚未配置，当前不能测试或同步。",
    testConnection: false,
    sync: false,
  };
}

export async function testProductConnector(input: {
  adapterKey: string;
  resolvedSecret: string | null;
  publicConfig: Record<string, unknown>;
}): Promise<ConnectorTestAdapterResult> {
  if (input.adapterKey === "file_upload_v1") {
    return {
      status: "unavailable",
      code: "CONNECTION_TEST_NOT_REQUIRED",
      message: "文件导入无需连接测试。",
      proof: EMPTY_PROOF,
    };
  }
  if (input.adapterKey !== "postgres_readonly_v1") {
    return {
      status: "unavailable",
      code: "CONNECTOR_ADAPTER_NOT_CONFIGURED",
      message: "该连接器适配器尚未由运维配置。",
      proof: EMPTY_PROOF,
    };
  }
  if (!input.resolvedSecret) {
    return {
      status: "unavailable",
      code: "SECRET_REFERENCE_REQUIRED",
      message: "只读数据库连接缺少运维预置的 secret reference。",
      proof: EMPTY_PROOF,
    };
  }
  const connectionString = input.resolvedSecret;
  if (!isSafePostgresSecret(connectionString)) {
    return {
      status: "failed",
      code: "DATABASE_SECRET_INVALID",
      message: "运维预置的数据库 secret 不符合安全连接契约。",
      proof: EMPTY_PROOF,
    };
  }
  const schema = typeof input.publicConfig.schema === "string" ? input.publicConfig.schema : "";
  const table = typeof input.publicConfig.table === "string" ? input.publicConfig.table : "";
  if (!/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(schema) || !/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(table)) {
    return {
      status: "failed",
      code: "DATABASE_PUBLIC_CONFIG_INVALID",
      message: "只读数据库 schema/table 配置无效。",
      proof: EMPTY_PROOF,
    };
  }

  const client = new Client({
    connectionString,
    application_name: "commerce-pilot-product-source-test",
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
    statement_timeout: 5_000,
    options: "-c default_transaction_read_only=on -c lock_timeout=2000ms -c idle_in_transaction_session_timeout=5000ms",
  });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const qualifiedTable = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
    const proofResult = await client.query<{
      read_only: string;
      relation_id: string | null;
      select_allowed: boolean | null;
      insert_allowed: boolean | null;
      update_allowed: boolean | null;
      delete_allowed: boolean | null;
      truncate_allowed: boolean | null;
      rolsuper: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
      rolreplication: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT current_setting('transaction_read_only') AS read_only,
              to_regclass($1)::text AS relation_id,
              has_table_privilege(current_user,$1,'SELECT') AS select_allowed,
              has_table_privilege(current_user,$1,'INSERT') AS insert_allowed,
              has_table_privilege(current_user,$1,'UPDATE') AS update_allowed,
              has_table_privilege(current_user,$1,'DELETE') AS delete_allowed,
              has_table_privilege(current_user,$1,'TRUNCATE') AS truncate_allowed,
              role.rolsuper,role.rolcreaterole,role.rolcreatedb,
              role.rolreplication,role.rolbypassrls
       FROM pg_roles role WHERE role.rolname=current_user`,
      [qualifiedTable],
    );
    const row = proofResult.rows[0];
    const writePrivileges = Boolean(
      row?.insert_allowed || row?.update_allowed || row?.delete_allowed || row?.truncate_allowed ||
      row?.rolsuper || row?.rolcreaterole || row?.rolcreatedb || row?.rolreplication || row?.rolbypassrls,
    );
    const proof = {
      readOnly: row?.read_only === "on",
      selectAllowed: row?.select_allowed === true,
      writePrivileges,
    };
    if (!row?.relation_id) {
      return { status: "failed", code: "DATABASE_TABLE_NOT_FOUND", message: "配置的只读数据表不存在。", proof };
    }
    if (!proof.readOnly) {
      return { status: "failed", code: "DATABASE_SESSION_NOT_READ_ONLY", message: "数据库会话未能证明只读，连接已拒绝。", proof };
    }
    if (!proof.selectAllowed) {
      return { status: "failed", code: "DATABASE_SELECT_NOT_ALLOWED", message: "数据库角色无权读取配置的数据表。", proof };
    }
    if (proof.writePrivileges) {
      return { status: "failed", code: "DATABASE_ROLE_HAS_WRITE_PRIVILEGES", message: "数据库角色具有写入或管理权限，连接已拒绝。", proof };
    }
    return {
      status: "succeeded",
      code: "DATABASE_READ_ONLY_VERIFIED",
      message: "已验证只读会话、目标表 SELECT 权限和无写入权限。",
      proof,
    };
  } catch (error) {
    return databaseFailure(error);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

function isSafePostgresSecret(value: string): boolean {
  if (value.length < 12 || value.length > 4_096 || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1) ||
        url.searchParams.has("options") || url.searchParams.has("application_name")) return false;
    const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLocaleLowerCase("en-US"));
    const sslMode = url.searchParams.get("sslmode")?.toLocaleLowerCase("en-US") ?? null;
    return loopback || ["require", "verify-ca", "verify-full"].includes(sslMode ?? "");
  } catch {
    return false;
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function databaseFailure(error: unknown): ConnectorTestAdapterResult {
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
  if (code === "28P01" || code === "28000") {
    return { status: "failed", code: "DATABASE_AUTHENTICATION_FAILED", message: "数据库认证失败。", proof: EMPTY_PROOF };
  }
  if (code === "3D000") {
    return { status: "failed", code: "DATABASE_NOT_FOUND", message: "数据库不存在或不可访问。", proof: EMPTY_PROOF };
  }
  if (code === "ETIMEDOUT" || code === "ECONNREFUSED" || code === "ENOTFOUND") {
    return { status: "failed", code: "DATABASE_UNREACHABLE", message: "数据库连接不可达。", proof: EMPTY_PROOF };
  }
  return { status: "failed", code: "DATABASE_CONNECTION_FAILED", message: "数据库只读连接测试失败。", proof: EMPTY_PROOF };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
