import type { PoolClient, QueryResultRow } from "pg";

import { assertApplicationDatabaseRoleSecurity, getAuthDatabase } from "@/lib/auth/database";
import type { EnterpriseScope } from "@/lib/enterprise/types";

export async function withEnterpriseDatabaseContext<T>(
  scope: EnterpriseScope,
  task: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withEnterpriseDatabaseAccess(scope, false, task);
}

/**
 * Tenant-wide access is reserved for admission-control aggregates that must see
 * every workspace while holding the tenant advisory lock. Product reads and
 * writes should use withEnterpriseDatabaseContext instead.
 */
export async function withEnterpriseTenantDatabaseContext<T>(
  scope: EnterpriseScope,
  task: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withEnterpriseDatabaseAccess(scope, true, task);
}

async function withEnterpriseDatabaseAccess<T>(
  scope: EnterpriseScope,
  tenantWide: boolean,
  task: (client: PoolClient) => Promise<T>,
): Promise<T> {
  await assertApplicationDatabaseRoleSecurity();
  const client = await getAuthDatabase().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('commerce.tenant_id', $1, true)", [scope.tenantId]);
    await client.query("SELECT set_config('commerce.workspace_id', $1, true)", [scope.workspaceId]);
    await client.query("SELECT set_config('commerce.user_id', $1, true)", [scope.userId]);
    await client.query("SELECT set_config('commerce.tenant_wide', $1, true)", [tenantWide ? "on" : "off"]);
    const result = await task(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function queryOne<Row extends QueryResultRow>(
  client: PoolClient,
  text: string,
  values: unknown[],
): Promise<Row | null> {
  const result = await client.query<Row>(text, values);
  return result.rows[0] ?? null;
}
