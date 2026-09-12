import assert from 'node:assert/strict';
import test from 'node:test';
import { runDatabaseConnectionRecovery, terminateIdleFixtureConnections, validateRecoveryFixtures } from './database-connection-recovery.mjs';

const databaseName = 'commerce_pilot_scale_recovery';
const users = Array.from({ length: 100 }, (_, index) => ({ cookie: `private-fixture-cookie-${index}`, threadId: `synthetic-thread-${index}` }));
const state = { schemaVersion: 1, databaseName, users: users.map((user, index) => ({ ...user, id: `scale-read-abcdefabcdef-${index}` })) };

function fixture({ connectedDatabase = databaseName, baselineFailure = false, terminationError = false, terminated = 3 } = {}) {
  let faultCalls = 0, recovering = false, recoveryReads = 0;
  const client = { query: async (sql, values) => {
    if (!sql.includes('pg_terminate_backend')) return { rows: [{ database: connectedDatabase }] };
    faultCalls += 1;
    assert.deepEqual(values, [databaseName, 'commerce_pilot_app']);
    assert.match(sql, /datname = current_database\(\) AND datname = \$1 AND usename = \$2/);
    assert.match(sql, /state = 'idle' AND pid <> pg_backend_pid\(\)/);
    assert.match(sql, /pg_terminate_backend\(pid, 5000\)/);
    if (terminationError) throw new Error('deliberately private database error');
    recovering = true;
    return { rows: [{ targeted: terminated, terminated }] };
  } };
  const fetcher = async (_url, request) => {
    const user = users.find(candidate => candidate.cookie === request.headers.cookie);
    if ((!recovering && baselineFailure) || (recovering && recoveryReads++ < 100)) return Response.json({ error: 'private response body' }, { status: 503 });
    return Response.json({ threads: [{ threadId: user.threadId, title: 'private thread title' }] });
  };
  return { client, fetcher, faults: () => faultCalls };
}

test('daily and mismatched database scopes cannot dispatch any termination', async () => {
  const f = fixture({ connectedDatabase: 'commerce_pilot' });
  await assert.rejects(() => terminateIdleFixtureConnections(f.client, 'commerce_pilot'), /disposable/);
  await assert.rejects(() => terminateIdleFixtureConnections(f.client, databaseName), /exact fixture database/);
  assert.equal(f.faults(), 0);
  assert.throws(() => validateRecoveryFixtures(state, users.map((user, index) => index ? user : { ...user, cookie: 'foreign' }), databaseName), /match/);
  assert.throws(() => validateRecoveryFixtures(state, users.map((user, index) => index ? user : { ...user, cookie: undefined }), databaseName), /cookie/);
  const alternateState = { ...state, users: state.users.map((user, index) => index ? user : { ...user, secureCookie: 'second-cookie-for-first-user' }) };
  const repeatedOwner = users.map((user, index) => index === 1 ? { ...users[0], cookie: 'second-cookie-for-first-user' } : user);
  assert.throws(() => validateRecoveryFixtures(alternateState, repeatedOwner, databaseName), /distinct fixture identities/);
});

test('failed baseline preserves evidence and never injects a fault', async () => {
  const f = fixture({ baselineFailure: true });
  const report = await runDatabaseConnectionRecovery({ ...f, databaseName, state, users });
  assert.equal(report.phase, 'baseline_failed');
  assert.equal(report.baseline.errors, 100);
  assert.equal(f.faults(), 0);
});

test('recovery requires all original users and threads and persists aggregate metrics only', async () => {
  const f = fixture();
  const receipts = [];
  const report = await runDatabaseConnectionRecovery({ ...f, databaseName, state, users, pollIntervalMs: 0,
    onProgress: async value => receipts.push(JSON.stringify(value)) });
  assert.equal(report.passed, true);
  assert.equal(report.terminatedConnections, 3);
  assert.equal(report.recoveryWaves.length, 2);
  assert.equal(report.recoveryWaves[0].errors, 100);
  assert.equal(report.recoveryWaves[1].errors, 0);
  assert.equal(f.faults(), 1);
  assert.equal(receipts.some(value => value.includes('fault_dispatching')), true);
  for (const value of receipts) {
    assert.equal(value.includes('private-fixture-cookie'), false);
    assert.equal(value.includes('private thread title'), false);
    assert.equal(value.includes('private response body'), false);
    assert.equal(value.includes('synthetic-thread-'), false);
  }
});

test('zero terminated connections cannot be reported as a successful fault drill', async () => {
  const f = fixture({ terminated: 0 });
  const report = await runDatabaseConnectionRecovery({ ...f, databaseName, state, users });
  assert.equal(report.passed, false);
  assert.equal(report.phase, 'fault_not_fully_observed');
  assert.equal(report.recoveryWaves.length, 0);
});

test('uncertain termination is recorded without a second dispatch or false recovery success', async () => {
  const f = fixture({ terminationError: true });
  const report = await runDatabaseConnectionRecovery({ ...f, databaseName, state, users });
  assert.equal(report.passed, false);
  assert.equal(report.faultOutcome, 'unknown');
  assert.equal(report.recoveryWaves.length, 0);
  assert.equal(f.faults(), 1);
});
