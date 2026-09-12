import { readFile, realpath, mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { validateScaleDatabase, validateScaleWeb } from './read-fixture-policy.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const privateRoot = resolve(root, '.runtime/scale-validation');
const RUNTIME_ROLE = 'commerce_pilot_app';
const SCOPE = 'Local production Web build: recovery after its disposable database loses idle runtime connections; not production-host disaster recovery or AI execution capacity.';

export class RecoveryScopeError extends Error {}
export class FaultOutcomeUnknownError extends Error {}

export function validateRecoveryFixtures(state, users, databaseName) {
  if (state?.schemaVersion !== 1 || state.databaseName !== databaseName ||
      !Array.isArray(state.users) || state.users.length !== 100 || !Array.isArray(users) || users.length !== 100 ||
      new Set(state.users.map(user => user.id)).size !== 100 || new Set(users.map(user => user.cookie)).size !== 100) {
    throw new RecoveryScopeError('The recovery drill requires the matching private 100-user scale fixture receipt.');
  }
  const matchedOwners = new Set();
  for (const user of users) {
    if (typeof user.cookie !== 'string' || !user.cookie) throw new RecoveryScopeError('Every recovery user needs its private authenticated fixture cookie.');
    const owner = state.users.find(candidate => candidate.cookie === user.cookie || candidate.secureCookie === user.cookie);
    if (!owner || !/^scale-read-[a-f0-9]{12}-\d+$/.test(owner.id ?? '') ||
        typeof user.threadId !== 'string' || !user.threadId || owner.threadId !== user.threadId) {
      throw new RecoveryScopeError('Every recovery user must match its existing authenticated native-thread fixture.');
    }
    matchedOwners.add(owner.id);
  }
  if (matchedOwners.size !== 100) throw new RecoveryScopeError('Recovery requires 100 distinct fixture identities, not multiple cookies for one identity.');
}

export async function verifyRecoveryDatabase(client, databaseName) {
  if (!/^[a-z0-9_]+_scale_[a-z0-9_]+$/.test(databaseName)) throw new RecoveryScopeError('Only an explicitly disposable _scale_ database is allowed.');
  const result = await client.query('SELECT current_database() AS database');
  if (result.rows[0]?.database !== databaseName) throw new RecoveryScopeError('Connected database does not match the exact fixture database; refusing fault injection.');
}

export async function terminateIdleFixtureConnections(client, databaseName) {
  await verifyRecoveryDatabase(client, databaseName);
  try {
    // The 5-second PostgreSQL timeout confirms backend termination, rather than
    // merely counting signal requests. No active or idle-in-transaction backend,
    // owner connection, other database or other application role is targeted.
    const result = await client.query(`
      WITH targets AS MATERIALIZED (
        SELECT pid FROM pg_stat_activity
        WHERE datname = current_database() AND datname = $1 AND usename = $2
          AND state = 'idle' AND pid <> pg_backend_pid()
      ), terminated AS MATERIALIZED (
        SELECT pg_terminate_backend(pid, 5000) AS stopped FROM targets
      )
      SELECT count(*)::int AS targeted, count(*) FILTER (WHERE stopped)::int AS terminated FROM terminated
    `, [databaseName, RUNTIME_ROLE]);
    const row = result.rows[0];
    if (!Number.isInteger(row?.targeted) || !Number.isInteger(row?.terminated) || row.terminated > row.targeted) throw new Error('Invalid termination receipt.');
    return { targetedConnections: row.targeted, terminatedConnections: row.terminated };
  } catch {
    // Never retry an uncertain fault injection automatically.
    throw new FaultOutcomeUnknownError('The fault dispatch result is unknown; no second termination was attempted.');
  }
}

function waveSummary(rows) {
  const sorted = rows.map(row => row.ms).sort((a, b) => a - b);
  const percentile = fraction => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
  const errors = rows.filter(row => !row.ok).length;
  return { users: rows.length, errors, errorRate: rows.length ? errors / rows.length : 1,
    p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: sorted.at(-1) ?? null,
    statuses: rows.reduce((counts, row) => { counts[row.status] = (counts[row.status] ?? 0) + 1; return counts; }, {}),
    errorKinds: rows.filter(row => row.error).reduce((counts, row) => { counts[row.error] = (counts[row.error] ?? 0) + 1; return counts; }, {}),
    allOriginalThreadsReadable: rows.length > 0 && errors === 0 };
}

export async function readOriginalThreadWave(users, baseUrl, timeoutMs, fetcher = fetch) {
  return waveSummary(await Promise.all(users.map(async user => {
    const started = performance.now();
    try {
      const response = await fetcher(`${baseUrl}/api/agent/threads`, {
        headers: { cookie: user.cookie }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      });
      const payload = await response.json().catch(() => null);
      const ok = response.status === 200 && response.headers.get('content-type')?.includes('application/json') &&
        Array.isArray(payload?.threads) && payload.threads.some(thread => thread?.threadId === user.threadId);
      return { status: response.status, ms: performance.now() - started, ok: !!ok, ...(!ok ? { error: 'original_thread_not_readable' } : {}) };
    } catch {
      return { status: 0, ms: performance.now() - started, ok: false, error: 'transport_or_timeout' };
    }
  })));
}

export async function runDatabaseConnectionRecovery({ client, databaseName, state, users,
  baseUrl = 'http://127.0.0.1:3100', requestTimeoutMs = 5000, maxRecoveryMs = 30000,
  pollIntervalMs = 500, fetcher = fetch, onProgress = async () => {} }) {
  validateRecoveryFixtures(state, users, databaseName);
  const target = validateScaleWeb(baseUrl);
  if (new URL(target).port !== '3100') throw new RecoveryScopeError('This drill targets only the isolated Web service on port 3100.');
  if (!Number.isInteger(maxRecoveryMs) || maxRecoveryMs < 1000 || maxRecoveryMs > 120000 ||
      !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 100 || requestTimeoutMs > 30000 ||
      !Number.isInteger(pollIntervalMs) || pollIntervalMs < 0 || pollIntervalMs > 5000) throw new Error('Invalid bounded recovery timings.');
  await verifyRecoveryDatabase(client, databaseName);
  const report = { scope: SCOPE, databaseName, users: users.length, phase: 'baseline', passed: false,
    faultOutcome: 'not_attempted', targetedConnections: 0, terminatedConnections: 0, recoveryWaves: [], recoveryMs: null,
    startedAt: new Date().toISOString(), baseline: await readOriginalThreadWave(users, target, requestTimeoutMs, fetcher) };
  await onProgress(report);
  if (!report.baseline.allOriginalThreadsReadable) {
    report.phase = 'baseline_failed';
    await onProgress(report);
    return report;
  }
  report.phase = 'fault_dispatching';
  await onProgress(report);
  const faultStarted = performance.now();
  try {
    Object.assign(report, await terminateIdleFixtureConnections(client, databaseName));
    report.faultOutcome = 'confirmed';
  } catch (error) {
    report.phase = 'fault_failed';
    report.faultOutcome = error instanceof RecoveryScopeError ? 'scope_rejected' : 'unknown';
    await onProgress(report);
    return report;
  }
  report.faultDispatchMs = performance.now() - faultStarted;
  if (report.terminatedConnections === 0 || report.terminatedConnections !== report.targetedConnections) {
    report.phase = 'fault_not_fully_observed';
    await onProgress(report);
    return report;
  }
  const recoveryStarted = performance.now();
  report.phase = 'recovering';
  while (performance.now() - recoveryStarted < maxRecoveryMs) {
    const remaining = Math.max(1, Math.floor(maxRecoveryMs - (performance.now() - recoveryStarted)));
    const wave = await readOriginalThreadWave(users, target, Math.min(requestTimeoutMs, remaining), fetcher);
    report.recoveryWaves.push(wave);
    if (wave.allOriginalThreadsReadable) {
      report.recoveryMs = performance.now() - recoveryStarted;
      report.passed = report.recoveryMs <= maxRecoveryMs;
      report.phase = report.passed ? 'recovered' : 'recovery_timed_out';
      break;
    }
    await onProgress(report);
    await delay(Math.min(pollIntervalMs, Math.max(0, maxRecoveryMs - (performance.now() - recoveryStarted))));
  }
  if (!report.passed) report.phase = 'recovery_timed_out';
  report.recoveryElapsedMs = performance.now() - recoveryStarted;
  await onProgress(report);
  return report;
}

function assertWithin(base, path) {
  const suffix = relative(base, path);
  if (isAbsolute(suffix) || suffix === '..' || suffix.startsWith(`..${sep}`)) throw new RecoveryScopeError('Recovery inputs and outputs must remain under private .runtime/scale-validation.');
}

async function main() {
  const database = validateScaleDatabase(process.env.RECOVERY_DATABASE_URL);
  const fixturePath = resolve(process.env.RECOVERY_USERS_FILE ?? join(privateRoot, 'users.json'));
  const outputPath = resolve(process.env.RECOVERY_OUTPUT_PATH ?? join(privateRoot, `database-connection-recovery-${Date.now()}.json`));
  const rootReal = await realpath(privateRoot);
  assertWithin(rootReal, await realpath(fixturePath));
  assertWithin(privateRoot, outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  assertWithin(rootReal, await realpath(dirname(outputPath)));
  const state = JSON.parse(await readFile(join(privateRoot, 'fixture-state.json'), 'utf8'));
  const users = JSON.parse(await readFile(fixturePath, 'utf8'));
  validateRecoveryFixtures(state, users, database.name);
  try { await access(outputPath); throw new RecoveryScopeError('Keep prior recovery evidence; choose a new output path.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let createdOutput = false;
  const onProgress = async report => {
    await writeFile(outputPath, JSON.stringify(report, null, 2), { mode: 0o600, flag: createdOutput ? 'w' : 'wx' });
    createdOutput = true;
  };
  const pool = new Pool({ connectionString: database.url.toString(), max: 1, connectionTimeoutMillis: 5000 });
  let client;
  try {
    client = await pool.connect();
    const report = await runDatabaseConnectionRecovery({ client, databaseName: database.name, state, users,
      baseUrl: process.env.RECOVERY_WEB_URL ?? 'http://127.0.0.1:3100', onProgress });
    console.log(JSON.stringify({ scope: report.scope, phase: report.phase, passed: report.passed,
      users: report.users, terminatedConnections: report.terminatedConnections, recoveryMs: report.recoveryMs, outputPath }));
    if (!report.passed) process.exitCode = 1;
  } finally { client?.release(); await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('The isolated database-connection recovery drill failed or rejected its scope; no automatic fault retry was attempted.'); process.exitCode = 1; });
}
