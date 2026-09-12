import { setTimeout as delay } from 'node:timers/promises';

export function readLoadConfig(environment, durationArgument) {
  const baseUrl = new URL(environment.LOADTEST_BASE_URL ?? 'http://127.0.0.1:3100');
  if (baseUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(baseUrl.hostname) || baseUrl.username || baseUrl.password ||
      !baseUrl.port || ['3000', '8787'].includes(baseUrl.port) || baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash) {
    throw new Error('Read load tests require an isolated HTTP loopback URL without credentials; daily ports 3000/8787 are forbidden.');
  }
  const counts = (environment.LOADTEST_COUNTS ?? '20,30,100').split(',').map(Number);
  if (!counts.length || counts.some((value) => !Number.isInteger(value) || value < 1 || value > 200)) {
    throw new Error('LOADTEST_COUNTS must contain user counts between 1 and 200.');
  }
  return {
    baseUrl: baseUrl.origin,
    progress: environment.LOADTEST_PROGRESS === 'true',
    counts,
    durationMs: boundedNumber(durationArgument ?? 60_000, 1_000, 3_600_000, 'duration'),
    thinkMs: boundedNumber(environment.LOADTEST_THINK_MS ?? 1_000, 0, 60_000, 'think time'),
    requestTimeoutMs: boundedNumber(environment.LOADTEST_REQUEST_TIMEOUT_MS ?? 15_000, 100, 60_000, 'request timeout'),
    maxP95Ms: boundedNumber(environment.LOADTEST_MAX_P95_MS ?? 1_500, 1, 60_000, 'P95 target'),
    maxErrorRate: boundedNumber(environment.LOADTEST_MAX_ERROR_RATE ?? 0, 0, 1, 'error rate target'),
  };
}

export function validateReadFixtures(users, counts) {
  if (!Array.isArray(users) || users.length < Math.max(...counts) || users.some((user) =>
    typeof user.cookie !== 'string' || !user.cookie || typeof user.threadId !== 'string' || !user.threadId,
  ) || new Set(users.map((user) => user.cookie)).size !== users.length) {
    throw new Error('Provide enough distinct authenticated users and native threads for all concurrency levels.');
  }
}

export function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

export function summarizeReadLoad({ rows, count, elapsedMs, streamCount, streamReadyCount, streamErrors, maxInFlight }, config) {
  const errors = rows.filter((row) => row.status !== 200 || row.error).length;
  const p95 = percentile(rows.map((row) => row.ms), 0.95);
  const errorRate = rows.length ? errors / rows.length : 1;
  const checks = {
    requestsObserved: rows.length > 0,
    errorRate: errorRate <= config.maxErrorRate,
    p95: p95 !== null && p95 <= config.maxP95Ms,
    streams: streamCount === count && streamReadyCount === count && streamErrors === 0,
    coverage: Array.from({ length: count }, (_, user) => [0, 1, 2, 3].every((kind) =>
      rows.some((row) => row.user === user && row.kind === kind))).every(Boolean),
  };
  return {
    users: count, elapsedMs, requests: rows.length, errors, errorRate,
    rps: rows.length / (elapsedMs / 1_000), maxInFlight,
    p50: percentile(rows.map((row) => row.ms), 0.5), p95,
    p99: percentile(rows.map((row) => row.ms), 0.99),
    statuses: rows.reduce((result, row) => { result[row.status] = (result[row.status] ?? 0) + 1; return result; }, {}),
    streamCount, streamReadyCount, streamErrors,
    byEndpoint: [0, 1, 2, 3].map((kind) => {
      const selected = rows.filter((row) => row.kind === kind);
      return { kind, count: selected.length, errors: selected.filter((row) => row.status !== 200 || row.error).length,
        p95: percentile(selected.map((row) => row.ms), 0.95) };
    }),
    targets: { maxP95Ms: config.maxP95Ms, maxErrorRate: config.maxErrorRate },
    checks, passed: Object.values(checks).every(Boolean),
    scope: 'Authenticated HTTP reads and SSE connections; not AI execution capacity.',
  };
}

export async function runReadLoad(users, count, config) {
  validateReadFixtures(users, [count]);
  const rows = [];
  const start = performance.now();
  const stop = new AbortController();
  let streamCount = 0, streamReadyCount = 0, streamErrors = 0, inFlight = 0, maxInFlight = 0;
  const streams = users.slice(0, count).map(async (user) => {
    try {
      const response = await fetch(`${config.baseUrl}/api/agent/events?threadId=${encodeURIComponent(user.threadId)}`, {
        headers: { cookie: user.cookie }, signal: stop.signal, redirect: 'error',
      });
      if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
        streamErrors++;
        await response.body?.cancel();
        return;
      }
      streamCount++;
      const reader = response.body.getReader();
      // Explicitly cancel readers; iterator return() can otherwise wait for a
      // streaming transport's asynchronous cleanup after the test has finished.
      const cancelReader = () => { void reader.cancel().catch(() => undefined); };
      stop.signal.addEventListener('abort', cancelReader, { once: true });
      if (stop.signal.aborted) cancelReader();
      const decoder = new TextDecoder();
      let initial = '', ready = false;
      try {
        while (!stop.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!ready) {
            initial += decoder.decode(value, { stream: true });
            if (hasConnectedFrame(initial)) {
              streamReadyCount++;
              ready = true;
              initial = '';
            } else if (initial.length > 64 * 1024) {
              streamErrors++;
              cancelReader();
              break;
            }
          }
          // Later frames are drained without persisting user data.
        }
      } finally {
        stop.signal.removeEventListener('abort', cancelReader);
        reader.releaseLock();
      }
      if (!stop.signal.aborted) streamErrors++;
    } catch {
      if (!stop.signal.aborted) streamErrors++;
    }
  });
  const progress = setInterval(() => {
    if (config.progress) console.log(JSON.stringify({ phase: 'reading', users: count, requests: rows.length, streamCount, streamReadyCount, inFlight }));
  }, 15_000);
  progress.unref();
  try {
    await Promise.all(users.slice(0, count).map(async (user, index) => {
      // Keep a simultaneous SSE connection burst, but spread periodic reads so
      // a steady workload is distinct from a synchronized retry storm.
      if (config.thinkMs) await delay(Math.floor(index * config.thinkMs / count));
      let iteration = 0;
      while (performance.now() - start < config.durationMs) {
        const thread = encodeURIComponent(user.threadId);
        const kind = iteration++ % 4;
        const path = ['/api/agent/threads', `/api/agent/threads/${thread}/status`,
          `/api/agent/threads/${thread}/canvas`, `/api/agent/threads/${thread}/image-sessions`][kind];
        const requestStart = performance.now();
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          const response = await fetch(config.baseUrl + path, {
            headers: { cookie: user.cookie }, redirect: 'error', signal: AbortSignal.timeout(config.requestTimeoutMs),
          });
          const body = await response.text();
          let error;
          try {
            const payload = JSON.parse(body);
            if (!response.headers.get('content-type')?.includes('application/json') || !validReadPayload(kind, payload, user.threadId)) error = 'invalid_business_response';
          } catch { error = 'invalid_json'; }
          rows.push({ user: index, kind, status: response.status, ms: performance.now() - requestStart, bytes: Buffer.byteLength(body), ...(error ? { error } : {}) });
        } catch (error) {
          rows.push({ user: index, kind, status: 0, ms: performance.now() - requestStart, error: error.name });
        } finally { inFlight--; }
        const remaining = config.durationMs - (performance.now() - start);
        if (config.thinkMs && remaining > 0) await delay(Math.min(config.thinkMs, remaining));
      }
    }));
  } finally {
    clearInterval(progress);
    stop.abort();
    await Promise.all(streams);
  }
  return { summary: summarizeReadLoad({ rows, count, elapsedMs: performance.now() - start, streamCount, streamReadyCount, streamErrors, maxInFlight }, config), rows };
}

export function validReadPayload(kind, payload, threadId) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.error) return false;
  if (kind === 0) return Array.isArray(payload.threads);
  if (kind === 1) return payload.thread?.id === threadId && ['idle', 'running', 'completed', 'interrupted', 'failed'].includes(payload.thread?.status);
  if (kind === 2) return payload.threadId === threadId && Array.isArray(payload.nodes) && typeof payload.sourceHistoryComplete === 'boolean';
  if (kind === 3) return Array.isArray(payload.sessions);
  return false;
}

export function hasConnectedFrame(value) {
  const normalized = value.replaceAll('\r\n', '\n');
  return normalized.split('\n\n').slice(0, -1).some((frame) =>
    /^event: gateway\/connected$/m.test(frame) && /^data: /m.test(frame));
}

function boundedNumber(value, minimum, maximum, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`Invalid ${name}.`);
  return number;
}
