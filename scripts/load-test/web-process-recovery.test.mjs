import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { forceStopOwnedWeb, runOwnedWebRecovery } from './web-process-recovery.mjs';

test('forced termination requires a process handle created by this drill', async () => {
  const child = new EventEmitter(); child.pid = 123; child.exitCode = null; let kills = 0;
  child.kill = () => { kills++; child.exitCode = 1; child.emit('exit', 1, null); };
  await assert.rejects(() => forceStopOwnedWeb(child, new Set()), /not created/);
  assert.equal(kills, 0);
  await forceStopOwnedWeb(child, new Set([child]));
  await forceStopOwnedWeb(child, new Set([child]));
  assert.equal(kills, 1);
});

test('restart preserves 100-user readback and records downtime errors plus both RTO boundaries', async () => {
  let nextPid = 0, online = false;
  const children = [];
  const report = await runOwnedWebRecovery({
    startWeb: async () => { const child = { pid: ++nextPid }; children.push(child); return child; },
    waitReady: async () => { await delay(15); online = true; },
    stopWeb: async () => { online = false; },
    readUsers: async () => ({ users: 100, errors: online ? 0 : 100, allOriginalThreadsReadable: online }),
    runLoad: async () => ({ summary: { errors: 0, passed: true, checks: { streams: true, coverage: true } } }),
    probeIntervalMs: 5, maxRecoveryMs: 1000,
  });
  assert.equal(report.passed, true);
  assert.equal(report.originalPid, 1); assert.equal(report.replacementPid, 2);
  assert.ok(report.observedRecoveryErrors >= 100);
  assert.ok(report.killToAllUsersRecoveredMs >= report.killToPortReadyMs);
  assert.equal(children.length, 2);
});

test('a failed authenticated baseline stops only its own process and never injects a restart', async () => {
  let starts = 0, stops = 0;
  const report = await runOwnedWebRecovery({ startWeb: async () => ({ pid: ++starts }), waitReady: async () => {}, stopWeb: async () => { stops++; },
    readUsers: async () => ({ users: 100, errors: 1, allOriginalThreadsReadable: false }), runLoad: async () => { throw new Error('unreachable'); } });
  assert.equal(report.passed, false);
  assert.equal(report.phase, 'baseline_failed');
  assert.equal(starts, 1); assert.equal(stops, 1);
});
