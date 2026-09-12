import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { validateScaleDatabase } from './read-fixture-policy.mjs';
import { percentile } from './read-load.mjs';
import { getAuthDatabase, assertApplicationDatabaseRoleSecurity } from '../../apps/web/lib/auth/database.ts';
import { withEnterpriseDatabaseContext } from '../../apps/web/lib/enterprise/database-context.ts';

const database = validateScaleDatabase(process.env.DATABASE_URL);
const directory = resolve('.runtime/scale-validation');
const state = JSON.parse(await readFile(resolve(directory, 'fixture-state.json'), 'utf8'));
if (state.databaseName !== database.name || state.users.length < 100) throw new Error('Prepare the matching 100-user disposable fixture.');
const pool = getAuthDatabase();
const results = [];
try {
  await assertApplicationDatabaseRoleSecurity();
  const identity = await pool.query('SELECT current_database() AS name');
  if (identity.rows[0]?.name !== database.name) throw new Error('Unexpected database.');
  // Warm the pool before alternating baseline and candidate to reduce ordering bias.
  await Promise.all(Array.from({ length: 20 }, () => pool.query('SELECT 1')));
  for (let round = 0; round < 3; round++) {
    for (const mode of round % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      const latencies = [];
      let errors = 0;
      const start = performance.now();
      await Promise.all(state.users.slice(0, 100).map(async (user) => {
        const scope = { tenantId: state.tenantId, workspaceId: state.workspaceId, userId: user.id };
        for (let iteration = 0; iteration < 20; iteration++) {
          const begin = performance.now();
          try {
            if (mode === 'candidate') await withEnterpriseDatabaseContext(scope, (client) => readOwnMembership(client, scope));
            else await baselineContext(scope);
          } catch { errors++; }
          latencies.push(performance.now() - begin);
        }
      }));
      const result = { mode, round: round + 1, users: 100, transactions: latencies.length, errors,
        elapsedMs: performance.now() - start, p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), p99: percentile(latencies, 0.99) };
      results.push(result);
      console.log(JSON.stringify(result));
    }
  }
  await writeFile(resolve(directory, 'database-context-results.json'), JSON.stringify({
    scope: 'Real PostgreSQL RLS transaction overhead with 100 synthetic users; excludes HTTP, SSE and AI execution.',
    connectionPoolMax: pool.options.max, results,
  }, null, 2));
  if (results.some((result) => result.errors)) process.exitCode = 1;
} finally { await pool.end(); }

async function readOwnMembership(client, scope) {
  const result = await client.query(`SELECT current_setting('commerce.tenant_id') AS tenant,
    current_setting('commerce.workspace_id') AS workspace, current_setting('commerce.user_id') AS actor,
    (SELECT count(*)::int FROM commerce_tenant_membership WHERE user_id=$1) AS memberships`, [scope.userId]);
  const row = result.rows[0];
  if (row.tenant !== scope.tenantId || row.workspace !== scope.workspaceId || row.actor !== scope.userId || row.memberships !== 1) {
    throw new Error('Transaction scope or membership verification failed.');
  }
}

async function baselineContext(scope) {
  const client = await pool.connect();
  let failed = false;
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('commerce.tenant_id', $1, true)", [scope.tenantId]);
    await client.query("SELECT set_config('commerce.workspace_id', $1, true)", [scope.workspaceId]);
    await client.query("SELECT set_config('commerce.user_id', $1, true)", [scope.userId]);
    await client.query("SELECT set_config('commerce.tenant_wide', $1, true)", ['off']);
    await readOwnMembership(client, scope);
    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { failed = true; }
    throw error;
  } finally { client.release(failed); }
}
