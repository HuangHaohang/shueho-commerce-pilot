import { chmod, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { fixtureFingerprint, PAID_AUTHORIZATION } from './mixed-ai-protocol.mjs';
import { validateScaleDatabase } from './read-fixture-policy.mjs';

const privateRoot = fileURLToPath(new URL('../../.runtime/scale-validation/', import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const THREAD_ID = /^[A-Za-z0-9_-]{8,200}$/;

export function usageExportScope(state, receipt, databaseName) {
  if (!/^[a-z0-9_]+_scale_[a-z0-9_]+$/.test(databaseName) || state?.schemaVersion !== 1 || state.databaseName !== databaseName ||
      !UUID.test(state.tenantId ?? '') || !UUID.test(state.workspaceId ?? '') ||
      !Array.isArray(state.users) || state.users.length !== 100 ||
      state.users.some(user => !/^scale-read-[a-f0-9]{12}-\d+$/.test(user.id ?? '') || !THREAD_ID.test(user.threadId ?? '')) ||
      new Set(state.users.map(user => user.id)).size !== 100 || new Set(state.users.map(user => user.threadId)).size !== 100) {
    throw new Error('Usage export requires the exact disposable database and complete private 100-user native-thread fixture.');
  }
  if (receipt?.schemaVersion !== 1 || receipt.authorization !== PAID_AUTHORIZATION || !UUID.test(receipt.runId ?? '') ||
      receipt.fixtureFingerprint !== fixtureFingerprint(state.users) || !Array.isArray(receipt.entries) || receipt.entries.length !== 32 ||
      new Set(receipt.entries.map(entry => entry.user)).size !== 32 || receipt.entries.some(entry =>
        !Number.isInteger(entry.user) || entry.user < 0 || entry.user >= 32 || typeof entry.dispatchAttempted !== 'boolean' ||
        entry.threadId !== state.users[entry.user]?.threadId)) {
    throw new Error('The mixed AI receipt does not match the private fixture identity and thread order.');
  }
  const owners = receipt.entries.filter(entry => entry.dispatchAttempted).map(entry => ({
    rootThreadId: entry.threadId, userId: state.users[entry.user].id,
  }));
  if (!owners.length) throw new Error('The mixed AI receipt contains no dispatched roots to audit.');
  return { tenantId: state.tenantId, workspaceId: state.workspaceId, runId: receipt.runId,
    rootThreadIds: owners.map(owner => owner.rootThreadId), owners };
}

function tokenCount(value) {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value))) throw new Error('Invalid reported token count in the source ledger.');
  const count = Number(value);
  if (!Number.isSafeInteger(count)) throw new Error('Reported token count exceeds the exact JSON integer range.');
  return count;
}

export function normalizeUsageRow(row) {
  if (!/^[1-9][0-9]*$/.test(String(row.id)) || !THREAD_ID.test(row.rootThreadId ?? '') || !THREAD_ID.test(row.threadId ?? '') ||
      ![row.turnId, row.responseId, row.providerId, row.source].every(value => typeof value === 'string' && value.length > 0) ||
      !(row.model === null || typeof row.model === 'string')) throw new Error('The source ledger contains an invalid usage identity.');
  if (!['reported', 'missing'].includes(row.usageStatus)) throw new Error('Unknown source usage status; refusing to assume zero consumption.');
  return { id: String(row.id), rootThreadId: row.rootThreadId, threadId: row.threadId, turnId: row.turnId,
    responseId: row.responseId, providerId: row.providerId, model: row.model, source: row.source,
    usageStatus: row.usageStatus,
    totalTokens: row.usageStatus === 'reported' ? tokenCount(row.totalTokens) : null,
    inputTokens: row.usageStatus === 'reported' ? tokenCount(row.inputTokens) : null,
    outputTokens: row.usageStatus === 'reported' ? tokenCount(row.outputTokens) : null };
}

export async function exportAiUsage(client, state, receipt, databaseName) {
  const scope = usageExportScope(state, receipt, databaseName);
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const identity = (await client.query('SELECT current_database() AS database, transaction_timestamp() AS captured_at')).rows[0];
    if (identity?.database !== databaseName) throw new Error('Connected database does not match the exact disposable fixture database.');
    await client.query(`SELECT set_config('commerce.tenant_id',$1,true), set_config('commerce.workspace_id',$2,true),
      set_config('commerce.tenant_wide','off',true), set_config('statement_timeout','30000',true)`, [scope.tenantId, scope.workspaceId]);
    const roots = await client.query(`SELECT thread_id AS "threadId", user_id AS "userId", created_by_user_id AS "createdByUserId"
      FROM commerce_agent_thread WHERE tenant_id=$1 AND workspace_id=$2 AND thread_id=ANY($3::text[])`,
    [scope.tenantId, scope.workspaceId, scope.rootThreadIds]);
    const expectedOwners = new Map(scope.owners.map(owner => [owner.rootThreadId, owner.userId]));
    if (roots.rows.length !== scope.rootThreadIds.length || new Set(roots.rows.map(row => row.threadId)).size !== scope.rootThreadIds.length || roots.rows.some(row =>
      !expectedOwners.has(row.threadId) || row.userId !== expectedOwners.get(row.threadId) || row.createdByUserId !== expectedOwners.get(row.threadId))) {
      throw new Error('A batch root is missing or belongs to a different tenant, workspace or fixture identity.');
    }
    const result = await client.query(`SELECT id::text AS id, root_thread_id AS "rootThreadId", thread_id AS "threadId",
      turn_id AS "turnId", response_id AS "responseId", provider_id AS "providerId", model, source,
      usage_status AS "usageStatus", total_tokens::text AS "totalTokens", input_tokens::text AS "inputTokens", output_tokens::text AS "outputTokens"
      FROM commerce_agent_usage_event
      WHERE tenant_id=$1 AND workspace_id=$2 AND root_thread_id=ANY($3::text[])
      ORDER BY commerce_agent_usage_event.id`, [scope.tenantId, scope.workspaceId, scope.rootThreadIds]);
    const rows = result.rows.map(normalizeUsageRow);
    if (rows.some(row => !expectedOwners.has(row.rootThreadId))) throw new Error('The source ledger returned an out-of-scope root.');
    await client.query('COMMIT');
    return { schemaVersion: 1, source: 'commerce_agent_usage_event', runId: scope.runId,
      capturedAt: new Date(identity.captured_at).toISOString(),
      scope: { rootThreadIds: scope.rootThreadIds, includesDescendants: true, includesAllSources: true }, rows };
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
}

export function usageExportSummary(receipt) {
  const reported = receipt.rows.filter(row => row.usageStatus === 'reported');
  const missingUsageRows = receipt.rows.length - reported.length;
  const knownTotalTokens = reported.reduce((sum, row) => sum + BigInt(row.totalTokens), 0n);
  const rootsWithRows = new Set(receipt.rows.map(row => row.rootThreadId));
  return { rows: receipt.rows.length, roots: receipt.scope.rootThreadIds.length,
    rootsWithoutRows: receipt.scope.rootThreadIds.filter(root => !rootsWithRows.has(root)).length,
    descendantResponses: receipt.rows.filter(row => row.threadId !== row.rootThreadId).length,
    reportedUsageRows: reported.length, missingUsageRows, knownReportedTotalTokens: knownTotalTokens.toString(),
    capturedRowsFullyReported: receipt.rows.length > 0 && missingUsageRows === 0 };
}

export async function writeImmutableUsageReceipt(path, receipt) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(receipt, null, 2)); await file.sync(); }
  finally { await file.close(); }
  await chmod(path, 0o400);
}

function assertPrivate(base, path) {
  const suffix = relative(base, path);
  if (!suffix || isAbsolute(suffix) || suffix === '..' || suffix.startsWith(`..${sep}`)) throw new Error('Usage receipts must stay inside private .runtime/scale-validation.');
}

async function readPrivateJson(path, rootReal) {
  assertPrivate(rootReal, await realpath(path));
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const database = validateScaleDatabase(process.env.USAGE_DATABASE_URL);
  if (!process.env.USAGE_MIXED_RECEIPT) throw new Error('Set USAGE_MIXED_RECEIPT to the private mixed AI driver receipt.');
  const rootReal = await realpath(privateRoot);
  const state = await readPrivateJson(resolve(process.env.USAGE_FIXTURE_STATE_PATH ?? join(privateRoot, 'fixture-state.json')), rootReal);
  const mixed = await readPrivateJson(resolve(process.env.USAGE_MIXED_RECEIPT), rootReal);
  const scope = usageExportScope(state, mixed, database.name);
  const outputPath = resolve(process.env.USAGE_OUTPUT_PATH ?? join(privateRoot, `ai-usage-${scope.runId}-${Date.now()}.json`));
  assertPrivate(resolve(privateRoot), outputPath);
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  assertPrivate(rootReal, join(await realpath(dirname(outputPath)), 'receipt.json'));
  const pool = new Pool({ connectionString: database.url.toString(), max: 1, connectionTimeoutMillis: 5000 });
  let client;
  try {
    client = await pool.connect();
    const receipt = await exportAiUsage(client, state, mixed, database.name);
    await writeImmutableUsageReceipt(outputPath, receipt);
    console.log(JSON.stringify({ ...usageExportSummary(receipt), outputPath }));
  } finally { client?.release(); await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Usage export failed scope/integrity checks or could not create a new immutable private receipt. No model call or database mutation was attempted.'); process.exitCode = 1; });
}
