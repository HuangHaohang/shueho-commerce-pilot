import { Pool, type PoolClient, type QueryResultRow } from "pg";

import { config } from "./config.js";

export const database = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  application_name: "shueho-external-data-service",
});

export type DatabaseScope = { tenantId: string; workspaceId: string };

export async function withScope<T>(scope: DatabaseScope, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('external_data.tenant_id', $1, true)", [scope.tenantId]);
    await client.query("SELECT set_config('external_data.workspace_id', $1, true)", [scope.workspaceId]);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function queryOne<Row extends QueryResultRow>(
  client: PoolClient,
  sql: string,
  values: unknown[],
): Promise<Row> {
  const result = await client.query<Row>(sql, values);
  const row = result.rows[0];
  if (!row) throw new Error("Expected one database row.");
  return row;
}

export function vectorLiteral(values: number[]): string {
  if (values.length !== 1024 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("Expected one finite 1024-dimensional embedding.");
  }
  return `[${values.join(",")}]`;
}
