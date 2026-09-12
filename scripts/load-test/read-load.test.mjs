import assert from 'node:assert/strict';
import test from 'node:test';
import { readLoadConfig, validateReadFixtures, percentile, summarizeReadLoad, validReadPayload, hasConnectedFrame, runReadLoad } from './read-load.mjs';

test('rejects unsafe targets, invalid duration, and fake user multiplicity', () => {
  assert.throws(() => readLoadConfig({ LOADTEST_BASE_URL: 'https://production.example' }), /loopback/);
  assert.throws(() => readLoadConfig({ LOADTEST_BASE_URL: 'http://secret@127.0.0.1:3100' }), /credentials/);
  assert.throws(() => readLoadConfig({ LOADTEST_BASE_URL: 'http://127.0.0.1:3000' }), /daily ports/);
  assert.throws(() => readLoadConfig({}, 'NaN'), /duration/);
  assert.throws(() => readLoadConfig({ LOADTEST_COUNTS: '100,Infinity' }), /counts/);
  assert.throws(() => validateReadFixtures([{ cookie: 'same', threadId: 'a' }, { cookie: 'same', threadId: 'b' }], [2]), /distinct/);
});

test('empty samples are not zero-latency passes and percentiles do not mutate observations', () => {
  const values = [30, 10, 20];
  assert.equal(percentile(values, 0.5), 20);
  assert.deepEqual(values, [30, 10, 20]);
  const result = summarizeReadLoad({ rows: [], count: 100, elapsedMs: 1000, streamCount: 100, streamErrors: 0, maxInFlight: 0 }, readLoadConfig({}));
  assert.equal(result.p95, null);
  assert.equal(result.passed, false);
});

test('HTTP errors, successful HTML login pages, stream failures, and latency misses fail the acceptance gate', () => {
  const config = readLoadConfig({ LOADTEST_MAX_P95_MS: '100' });
  const sample = { rows: [0, 1, 2, 3].map((kind) => ({ user: 0, kind, status: 200, ms: 50 })), count: 1, elapsedMs: 1000, streamCount: 1, streamReadyCount: 1, streamErrors: 0, maxInFlight: 1 };
  assert.equal(summarizeReadLoad(sample, config).passed, true);
  for (const changed of [
    { rows: [{ kind: 0, status: 503, ms: 10 }] },
    { rows: [{ kind: 0, status: 200, ms: 10, error: 'invalid_json' }] },
    { rows: [{ kind: 0, status: 200, ms: 101 }] },
    { streamErrors: 1 }, { streamCount: 0 }, { streamReadyCount: 0 },
    { count: 2, streamCount: 2, streamReadyCount: 2 },
    { rows: [{ user: 0, kind: 0, status: 200, ms: 50 }] },
  ]) assert.equal(summarizeReadLoad({ ...sample, ...changed }, config).passed, false);
});

test('valid JSON alone does not establish a successful business read', () => {
  for (const value of [{}, [], true, { error: 'unavailable' }]) {
    for (const kind of [0, 1, 2, 3]) assert.equal(validReadPayload(kind, value, 'thread-a'), false);
  }
  assert.equal(validReadPayload(0, { threads: [] }, 'thread-a'), true);
  assert.equal(validReadPayload(1, { thread: { id: 'thread-b', status: 'idle' } }, 'thread-a'), false);
  assert.equal(validReadPayload(1, { thread: { id: 'thread-a', status: 'idle' } }, 'thread-a'), true);
  assert.equal(validReadPayload(2, { threadId: 'thread-a', nodes: [], sourceHistoryComplete: true }, 'thread-a'), true);
  assert.equal(validReadPayload(2, { threadId: 'thread-b', nodes: [], sourceHistoryComplete: true }, 'thread-a'), false);
  assert.equal(validReadPayload(3, { sessions: [] }, 'thread-a'), true);
});

test('SSE readiness requires a complete connected frame rather than headers or heartbeats', () => {
  assert.equal(hasConnectedFrame(''), false);
  assert.equal(hasConnectedFrame(': keepalive\n\n'), false);
  assert.equal(hasConnectedFrame('event: gateway/connected\ndata: {}\n'), false);
  assert.equal(hasConnectedFrame('event: gateway/connected\r\ndata: {}\r\n\r\n'), true);
});

test('finishing concurrent SSE reads does not wait for stalled transport cancellation', async (t) => {
  let cancellations = 0;
  let releaseCancellation;
  const slowCleanup = new Promise((resolve) => { releaseCancellation = resolve; });
  t.mock.method(globalThis, 'fetch', async (input) => {
    const path = new URL(input).pathname;
    if (path.endsWith('/events')) return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('event: gateway/connected\ndata: {}\n\n')); },
      cancel() { cancellations++; return slowCleanup; },
    }), { headers: { 'content-type': 'text/event-stream' } });
    if (path.endsWith('/status')) return Response.json({ thread: { id: path.split('/').at(-2), status: 'idle' } });
    if (path.endsWith('/canvas')) return Response.json({ threadId: path.split('/').at(-2), nodes: [], sourceHistoryComplete: true });
    if (path.endsWith('/image-sessions')) return Response.json({ sessions: [] });
    return Response.json({ threads: [] });
  });
  const users = [0, 1].map((index) => ({ cookie: `fixture-${index}`, threadId: `thread-${index}` }));
  let deadline;
  try {
    const result = await Promise.race([
      runReadLoad(users, 2, { ...readLoadConfig({}), durationMs: 100, thinkMs: 1 }),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('SSE cleanup did not finish')), 1500); }),
    ]);
    // This short test exercises cancellation, not the four-endpoint workload
    // gate: under a busy CI worker its 100 ms may not cover every endpoint.
    assert.equal(result.summary.checks.streams, true);
    assert.equal(result.summary.streamReadyCount, 2);
    assert.equal(cancellations, 2);
  } finally {
    clearTimeout(deadline);
    releaseCancellation();
  }
});
