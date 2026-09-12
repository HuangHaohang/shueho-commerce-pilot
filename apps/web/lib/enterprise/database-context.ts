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
  let discardClient = false;
  try {
    await client.query("BEGIN");
    // Set every RLS scope value transaction-locally before invoking product code,
    // using one round trip rather than four while retaining the same boundary.
    await client.query(
      `SELECT set_config('commerce.tenant_id', $1, true),
              set_config('commerce.workspace_id', $2, true),
              set_config('commerce.user_id', $3, true),
              set_config('commerce.tenant_wide', $4, true)`,
      [scope.tenantId, scope.workspaceId, scope.userId, tenantWide ? "on" : "off"],
    );
    const result = await task(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Do not let another tenant borrow a connection whose transaction state
      // could not be reset, or replace the original operation's error.
      discardClient = true;
    }
    throw error;
  } finally {
    client.release(discardClient);
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
