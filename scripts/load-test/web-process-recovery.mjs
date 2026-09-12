import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { copyFile, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { readEnvironmentPlan } from './run-read-environment.mjs';
import { readLoadConfig, runReadLoad } from './read-load.mjs';
import { readOriginalThreadWave, validateRecoveryFixtures } from './database-connection-recovery.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const privateRoot = join(root, '.runtime/scale-validation');
const PORT = 3300;
const BASE = `http://127.0.0.1:${PORT}`;

export async function forceStopOwnedWeb(child, ownedChildren) {
  if (!ownedChildren.has(child) || !Number.isInteger(child.pid) || child.pid <= 0) throw new Error('Refusing to stop a process not created by this Web drill.');
  if (child.exitCode !== null || child.signalCode) return;
  await new Promise((resolveStopped, reject) => {
    const timeout = setTimeout(() => reject(new Error('Owned Web process did not exit after its forced stop.')), 10000);
    child.once('exit', () => { clearTimeout(timeout); resolveStopped(); });
    child.once('error', () => { clearTimeout(timeout); reject(new Error('Owned Web process termination failed.')); });
    child.kill('SIGKILL');
  });
}

export async function runOwnedWebRecovery({ startWeb, waitReady, stopWeb, readUsers, runLoad, onProgress = async () => {}, maxRecoveryMs = 60000, probeIntervalMs = 250 }) {
  const report = { schemaVersion: 1, scope: 'Isolated local production Web process restart; not production-host disaster recovery or AI execution capacity.',
    port: PORT, gatewayRestarted: false, modelTurnsCreated: 0, phase: 'starting', startedAt: new Date().toISOString(),
    passed: false, recoveryWaves: [], killToPortReadyMs: null, killToAllUsersRecoveredMs: null };
  const children = [];
  let cancelProbes = false;
  let probes;
  try {
    const first = await startWeb(); children.push(first); report.originalPid = first.pid;
    await waitReady(first);
    report.baseline = await readUsers(15000);
    report.phase = 'read_load'; await onProgress(report);
    if (!report.baseline.allOriginalThreadsReadable) { report.phase = 'baseline_failed'; return report; }
    report.readLoad = (await runLoad()).summary;
    await onProgress(report);
    if (report.readLoad.errors !== 0 || !report.readLoad.checks.streams || !report.readLoad.checks.coverage) {
      report.phase = 'read_load_business_failure'; return report;
    }
    report.phase = 'forcing_owned_web_stop'; report.faultStartedAt = new Date().toISOString();
    await onProgress(report);
    const faultStarted = performance.now();
    let replacementReadyAt = null;
    const stopped = stopWeb(first);
    probes = (async () => {
      while (!cancelProbes && performance.now() - faultStarted < maxRecoveryMs) {
        const waveStarted = performance.now();
        const wave = await readUsers(2000);
        report.recoveryWaves.push({ ...wave, startedAfterReplacementReady: replacementReadyAt !== null && waveStarted >= replacementReadyAt,
          sinceFaultMs: performance.now() - faultStarted });
        await onProgress(report);
        if (replacementReadyAt !== null && waveStarted >= replacementReadyAt && wave.allOriginalThreadsReadable) {
          report.killToAllUsersRecoveredMs = performance.now() - faultStarted;
          return;
        }
        await delay(probeIntervalMs);
      }
    })();
    void probes.catch(() => undefined);
    await stopped;
    report.forcedStopConfirmedMs = performance.now() - faultStarted;
    const replacement = await startWeb(); children.push(replacement); report.replacementPid = replacement.pid;
    report.phase = 'restarting'; await onProgress(report);
    await waitReady(replacement);
    replacementReadyAt = performance.now();
    report.killToPortReadyMs = replacementReadyAt - faultStarted;
    await probes;
    report.observedRecoveryErrors = report.recoveryWaves.reduce((sum, wave) => sum + wave.errors, 0);
    report.observedRecoveryRequests = report.recoveryWaves.reduce((sum, wave) => sum + wave.users, 0);
    report.recoveryPassed = report.killToAllUsersRecoveredMs !== null && report.killToAllUsersRecoveredMs <= maxRecoveryMs;
    report.passed = report.recoveryPassed && report.readLoad.passed;
    report.phase = report.recoveryPassed ? 'recovered' : 'recovery_timed_out';
    return report;
  } catch {
    report.phase = 'failed'; report.failure = 'isolated_web_process_or_readback_failure';
    return report;
  } finally {
    cancelProbes = true;
    await probes?.catch(() => undefined);
    report.cleanupFailures = 0;
    for (const child of children.reverse()) {
      try { await stopWeb(child); } catch { report.cleanupFailures += 1; }
    }
    report.ownedWebProcessesStopped = report.cleanupFailures === 0;
    if (!report.ownedWebProcessesStopped) { report.passed = false; report.phase = 'cleanup_failed'; }
    report.finishedAt = new Date().toISOString();
    await onProgress(report);
  }
}

async function assertPortFree() {
  const probe = createServer();
  await new Promise((resolveFree, reject) => {
    probe.once('error', () => reject(new Error('Port 3300 is occupied; this drill never stops an existing process.')));
    probe.listen(PORT, '127.0.0.1', () => probe.close(resolveFree));
  });
}

async function createStage(plan) {
  const sourceWeb = join(root, 'apps/web');
  const sourceBuild = join(sourceWeb, '.next-scale-validation');
  const buildId = (await readFile(join(sourceBuild, 'BUILD_ID'), 'utf8')).trim();
  const stage = await mkdtemp(join(privateRoot, 'web-process-recovery-'));
  console.log(JSON.stringify({ phase: 'snapshot_build', port: PORT }));
  await cp(sourceBuild, join(stage, '.next-scale-validation'), { recursive: true });
  console.log(JSON.stringify({ phase: 'snapshot_public_and_workspace_dependencies', port: PORT }));
  for (const directory of ['public', 'node_modules']) await cp(join(sourceWeb, directory), join(stage, directory), { recursive: true });
  for (const file of ['package.json', 'next.config.ts', 'tsconfig.json']) await copyFile(join(sourceWeb, file), join(stage, file));
  if ((await readFile(join(sourceBuild, 'BUILD_ID'), 'utf8')).trim() !== buildId) throw new Error('The source build changed during snapshot; preserve this failed receipt and use a completed build.');
  const environment = { ...plan.webEnvironment, BETTER_AUTH_URL: BASE, AUTH_TRUSTED_ORIGINS: `${BASE},http://localhost:${PORT}`,
    DOTENV_CONFIG_PATH: join(stage, '.env') };
  await writeFile(join(stage, '.env'), Object.entries(environment).map(([key, value]) => `${key}='${value.replaceAll("'", '')}'`).join('\n') + '\n', { mode: 0o600 });
  return { stage, environment, buildId };
}

async function main() {
  if (process.argv[2] !== 'run') throw new Error('Explicit invocation required: web-process-recovery.mjs run');
  const state = JSON.parse(await readFile(join(privateRoot, 'fixture-state.json'), 'utf8'));
  const users = JSON.parse(await readFile(join(privateRoot, 'users.json'), 'utf8'));
  const plan = readEnvironmentPlan(state, { SystemRoot: process.env.SystemRoot });
  validateRecoveryFixtures(state, users, plan.databaseName);
  await assertPortFree();
  const snapshot = await createStage(plan);
  const owned = new Set();
  const requireWeb = createRequire(join(root, 'apps/web/package.json'));
  let serial = 0;
  const startWeb = async () => {
    const child = spawn(process.execPath, [requireWeb.resolve('next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(PORT)], {
      cwd: snapshot.stage, env: snapshot.environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    owned.add(child);
    const log = createWriteStream(join(snapshot.stage, `web-${++serial}.log`), { flags: 'wx', mode: 0o600 });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    child.once('close', () => log.end());
    child.on('error', () => {});
    console.log(JSON.stringify({ phase: 'spawned_owned_web', pid: child.pid, port: PORT }));
    return child;
  };
  const stopWeb = child => forceStopOwnedWeb(child, owned);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    for (const child of owned) await stopWeb(child).catch(() => undefined);
    process.exit(130);
  });
  const waitReady = async child => {
    const deadline = performance.now() + 60000;
    while (performance.now() < deadline) {
      if (child.exitCode !== null || child.signalCode) throw new Error('Owned Web process exited before readiness.');
      try {
        const response = await fetch(BASE, { redirect: 'error', signal: AbortSignal.timeout(2000) });
        await response.body?.cancel();
        if (response.status === 200) return;
      } catch { /* Read-only bounded port probe. */ }
      await delay(100);
    }
    throw new Error('Owned Web readiness timed out.');
  };
  let saveTail = Promise.resolve();
  let previousPhase;
  const onProgress = report => {
    const json = JSON.stringify({ ...report, buildId: snapshot.buildId }, null, 2);
    if (report.phase !== previousPhase) { previousPhase = report.phase; console.log(JSON.stringify({ phase: report.phase, port: PORT })); }
    saveTail = saveTail.then(() => writeFile(join(snapshot.stage, 'web-process-recovery.json'), json, { mode: 0o600 }));
    return saveTail;
  };
  const config = readLoadConfig({ LOADTEST_BASE_URL: BASE, LOADTEST_COUNTS: '100', LOADTEST_THINK_MS: '1000',
    LOADTEST_MAX_P95_MS: '1500', LOADTEST_MAX_ERROR_RATE: '0' }, 60000);
  const report = await runOwnedWebRecovery({ startWeb, waitReady, stopWeb,
    readUsers: timeout => readOriginalThreadWave(users, BASE, timeout), onProgress,
    runLoad: async () => {
      const started = performance.now();
      const progress = setInterval(() => console.log(JSON.stringify({ phase: '100_user_read_load', elapsedSeconds: Math.floor((performance.now() - started) / 1000) })), 10000);
      try {
        const result = await runReadLoad(users, 100, config);
        await writeFile(join(snapshot.stage, 'http-100-users-before-web-restart.json'), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
        console.log(JSON.stringify({ phase: 'read_load_complete', ...result.summary }));
        return result;
      } finally { clearInterval(progress); }
    },
  });
  console.log(JSON.stringify({ phase: report.phase, passed: report.passed, originalPid: report.originalPid,
    replacementPid: report.replacementPid, killToPortReadyMs: report.killToPortReadyMs,
    killToAllUsersRecoveredMs: report.killToAllUsersRecoveredMs, observedRecoveryErrors: report.observedRecoveryErrors,
    reportPath: join(snapshot.stage, 'web-process-recovery.json'), ownedWebProcessesStopped: report.ownedWebProcessesStopped }));
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('The isolated Web-process recovery drill failed. Existing services and business data were not selected for termination.'); process.exitCode = 1; });
}
