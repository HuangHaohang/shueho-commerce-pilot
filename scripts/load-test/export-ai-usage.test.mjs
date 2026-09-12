import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createMixedPlan } from './mixed-ai-protocol.mjs';
import { exportAiUsage, normalizeUsageRow, usageExportScope, usageExportSummary, writeImmutableUsageReceipt } from './export-ai-usage.mjs';

const database = 'commerce_pilot_scale_usage';
const users = Array.from({ length: 100 }, (_, index) => ({ id: `scale-read-abcdefabcdef-${index}`, cookie: `fixture-${index}`, threadId: `root-thread-${index}` }));
const state = { schemaVersion: 1, databaseName: database, tenantId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002', users };
const mixed = createMixedPlan(users, 'gpt-5.6-luna');
mixed.entries[0].dispatchAttempted = true;
mixed.entries[1].dispatchAttempted = true;

function row(overrides = {}) {
  return { id: '1', rootThreadId: users[0].threadId, threadId: users[0].threadId, turnId: 'turn-main-1',
    responseId: 'response-1', providerId: 'fixture-provider', model: 'gpt-5.6-luna', source: 'codex_harness',
    usageStatus: 'reported', totalTokens: '20', inputTokens: '15', outputTokens: '5', ...overrides };
}

function clientFixture({ wrongDatabase = false, wrongOwner = false, rows = [row()] } = {}) {
  const queries = [];
  const client = { query: async (sql, values) => {
    queries.push({ sql, values });
    if (sql.includes('current_database')) return { rows: [{ database: wrongDatabase ? 'commerce_pilot' : database, captured_at: '2026-09-12T00:00:00Z' }] };
    if (sql.includes('FROM commerce_agent_thread')) return { rows: [0, 1].map(index => ({ threadId: users[index].threadId,
      userId: wrongOwner ? 'unrelated-user' : users[index].id, createdByUserId: users[index].id })) };
    if (sql.includes('FROM commerce_agent_usage_event')) {
      assert.deepEqual(values, [state.tenantId, state.workspaceId, users.slice(0, 2).map(user => user.threadId)]);
      assert.match(sql, /root_thread_id=ANY\(\$3::text\[\]\)/);
      assert.doesNotMatch(sql, /(?:AND|WHERE)\s+(?:source|turn_id|thread_id)\s*[=]/i);
      assert.doesNotMatch(sql, /LIMIT/i);
      return { rows };
    }
    return { rows: [] };
  } };
  return { client, queries };
}

test('usage scope rejects daily databases, mismatched fingerprints and non-fixture root bindings', () => {
  assert.throws(() => usageExportScope(state, mixed, 'commerce_pilot'));
  assert.throws(() => usageExportScope(state, { ...mixed, fixtureFingerprint: 'wrong' }, database));
  const changed = structuredClone(mixed); changed.entries[0].threadId = users[99].threadId;
  assert.throws(() => usageExportScope(state, changed, database));
  const untouched = createMixedPlan(users, 'gpt-5.6-luna');
  assert.throws(() => usageExportScope(state, untouched, database), /no dispatched/);
});

test('read-only snapshot includes root, title generation and descendant sources and preserves missing usage', async () => {
  const f = clientFixture({ rows: [row(), row({ id: '2', source: 'title_generation', responseId: 'response-title' }),
    row({ id: '3', threadId: 'descendant-thread', responseId: 'response-child' }),
    row({ id: '4', rootThreadId: users[1].threadId, threadId: users[1].threadId, usageStatus: 'missing', totalTokens: '0', inputTokens: '0', outputTokens: '0' })] });
  const receipt = await exportAiUsage(f.client, state, mixed, database);
  assert.equal(f.queries[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(f.queries.at(-1).sql, 'COMMIT');
  assert.equal(receipt.scope.includesAllSources, true);
  assert.equal(receipt.scope.includesDescendants, true);
  assert.equal(receipt.rows.length, 4);
  assert.equal(receipt.rows[3].totalTokens, null);
  assert.deepEqual(usageExportSummary(receipt), { rows: 4, roots: 2, rootsWithoutRows: 0, descendantResponses: 1,
    reportedUsageRows: 3, missingUsageRows: 1, knownReportedTotalTokens: '60', capturedRowsFullyReported: false });
  assert.equal(JSON.stringify(receipt).includes('fixture-0'), false);
  assert.equal(JSON.stringify(receipt).includes(users[0].id), false);
});

test('database identity and root ownership failures roll back without reading usage', async () => {
  for (const options of [{ wrongDatabase: true }, { wrongOwner: true }]) {
    const f = clientFixture(options);
    await assert.rejects(() => exportAiUsage(f.client, state, mixed, database));
    assert.equal(f.queries.at(-1).sql, 'ROLLBACK');
    assert.equal(f.queries.some(({ sql }) => sql.includes('FROM commerce_agent_usage_event')), false);
  }
});

test('missing values remain unknown and unsafe reported integer values are refused', () => {
  assert.equal(normalizeUsageRow(row({ usageStatus: 'missing', totalTokens: '0' })).totalTokens, null);
  assert.throws(() => normalizeUsageRow(row({ totalTokens: '9007199254740993' })), /exact JSON/);
  assert.throws(() => normalizeUsageRow(row({ totalTokens: null })), /Invalid/);
  assert.throws(() => normalizeUsageRow(row({ usageStatus: 'unknown' })), /Unknown/);
});

test('private usage receipts are created exclusively and cannot overwrite prior evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'commerce-scale-usage-'));
  const path = join(directory, 'usage.json');
  try {
    await writeImmutableUsageReceipt(path, { schemaVersion: 1, rows: [] });
    await assert.rejects(() => writeImmutableUsageReceipt(path, { schemaVersion: 2, rows: [] }));
    assert.equal(JSON.parse(await readFile(path, 'utf8')).schemaVersion, 1);
  } finally {
    await chmod(path, 0o600).catch(() => undefined);
    await unlink(path).catch(() => undefined);
    await rmdir(directory);
  }
});
