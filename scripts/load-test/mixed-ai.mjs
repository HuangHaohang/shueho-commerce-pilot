import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { runReadLoad, readLoadConfig, percentile } from './read-load.mjs';
import { mixedConfig, validateMixedUsers, fixtureFingerprint, createMixedPlan, assertPhaseCanDispatch, syntheticPrompt,
  createSseParser, drainAbortableBody, stopSubscription, safeError, assessReadback, matchUsage, summarizeRunUsage, TERMINAL } from './mixed-ai-protocol.mjs';
const requireWeb = createRequire(new URL('../../apps/web/package.json', import.meta.url));

async function boundedBytes(response, maximumBytes) {
  if (!response.body) throw new Error('Missing response body.');
  const chunks = []; let bytes = 0;
  try {
    for await (const part of response.body) {
      bytes += part.length;
      if (bytes > maximumBytes) throw new Error('Response exceeded the safe bound.');
      chunks.push(part);
    }
  } catch (error) { throw error; }
  return Buffer.concat(chunks, bytes);
}
async function json(config, user, path, body) {
  const response = await fetch(config.baseUrl + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
    headers: { cookie: user.cookie, Origin: config.baseUrl, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(config.requestTimeoutMs) });
  const bytes = await boundedBytes(response, 4 * 1024 * 1024);
  let payload;
  try { payload = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Invalid JSON response.'); }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Unexpected response type.');
  return { status: response.status, payload };
}
function threadPath(entry, suffix = '') { return `/api/agent/threads/${encodeURIComponent(entry.threadId)}${suffix}`; }
async function historyRead(config, user, entry) {
  let history, cursor = null;
  for (let page = 0; page < 8; page++) {
    const result = await json(config, user, threadPath(entry) + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''));
    if (result.status !== 200 || result.payload.thread?.id !== entry.threadId || !Array.isArray(result.payload.messages) || !Array.isArray(result.payload.activities)) throw new Error('Native history read failed.');
    if (!history) history = { thread: result.payload.thread, messages: [], activities: [] };
    history.messages.push(...result.payload.messages); history.activities.push(...result.payload.activities);
    cursor = result.payload.nextCursor;
    if (!cursor || history.messages.some(item => item.clientId === entry.clientRequestId)) return history;
  }
  throw new Error('Native history exceeded the bounded lookup window.');
}
async function readImage(config, user, filename) {
  if (!/^[0-9]+-[0-9a-f-]+\.(png|jpg|webp)$/i.test(filename)) throw new Error('Invalid artifact identity.');
  const response = await fetch(config.baseUrl + `/api/provider/generated-images/${encodeURIComponent(filename)}`, {
    headers: { cookie: user.cookie }, redirect: 'error', signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  if (response.status !== 200) { await response.body?.cancel(); throw new Error('Artifact read failed.'); }
  const mime = response.headers.get('content-type')?.split(';')[0];
  const bytes = await boundedBytes(response, 64 * 1024 * 1024);
  const signatureValid = (mime === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    (mime === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP');
  if (!signatureValid) throw new Error('Artifact is not an image response.');
  const sharp = requireWeb('sharp');
  const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 16_777_216 });
  const metadata = await image.metadata();
  await image.stats(); // Decode all pixels to reject truncated/corrupt downloads.
  if (!metadata.width || !metadata.height) throw new Error('Artifact has no decoded image dimensions.');
  return { filename, mime, bytes: bytes.length, width: metadata.width, height: metadata.height,
    sha256: createHash('sha256').update(bytes).digest('hex'), status: 200 };
}

async function readback(config, user, entry) {
  const [state, inventory, history] = await Promise.all([
    json(config, user, threadPath(entry, '/status')), json(config, user, threadPath(entry, '/images')), historyRead(config, user, entry),
  ]);
  if (state.status !== 200 || inventory.status !== 200 || !Array.isArray(inventory.payload.images)) throw new Error('Readback unavailable.');
  const proof = assessReadback(entry, state.payload.thread, history, inventory.payload.images);
  entry.turnId = proof.turnId; entry.readback = proof;
  entry.unexpectedToolCount = history.activities.filter(item => item.turnId === proof.turnId && !['image', 'compact'].includes(item.kind)).length;
  if (proof.verified && entry.unexpectedToolCount === 0) {
    entry.artifacts = await Promise.all(proof.filenames.map(filename => readImage(config, user, filename)));
    entry.outcome = 'completed_verified';
  } else if (proof.terminal && proof.terminal !== 'completed') entry.outcome = proof.terminal;
  else if (proof.terminal === 'completed') entry.outcome = 'quality_or_readback_failed';
  else entry.outcome = 'uncertain';
  return proof;
}

function subscribe(config, user, entry, startedAt) {
  const stop = new AbortController();
  let connected = false, resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Prevent an early readiness rejection becoming unhandled before the caller awaits it.
  void ready.catch(() => {});
  const timeout = setTimeout(() => { rejectReady(new Error('SSE readiness timed out.')); stop.abort(); }, config.requestTimeoutMs);
  const done = (async () => {
    try {
      const response = await fetch(`${config.baseUrl}/api/agent/events?threadId=${encodeURIComponent(entry.threadId)}`, {
        headers: { cookie: user.cookie }, redirect: 'error', signal: stop.signal,
      });
      if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
        void response.body?.cancel().catch(() => undefined); throw new Error('SSE connection refused.');
      }
      const parser = createSseParser(frame => {
        if (frame.event === 'gateway/connected') { connected = true; clearTimeout(timeout); entry.sseConnected = true; resolveReady(); return; }
        let event; try { event = JSON.parse(frame.data); } catch { entry.invalidSseFrames = (entry.invalidSseFrames ?? 0) + 1; return; }
        if (event.params?.threadId && event.params.threadId !== entry.threadId) { entry.foreignSseEvents = (entry.foreignSseEvents ?? 0) + 1; return; }
        const method = event.method;
        if (['turn/started', 'turn/completed', 'item/agentMessage/delta', 'commerce/imageGeneration/completed', 'error'].includes(method)) {
          entry.events ??= {}; entry.events[method] = (entry.events[method] ?? 0) + 1;
        }
        if (event.type === 'server_request') entry.requiresHumanInput = true;
        if (method === 'item/agentMessage/delta') entry.firstTextMs ??= Date.now() - startedAt;
        if (method === 'commerce/imageGeneration/completed') entry.firstImageMs ??= Date.now() - startedAt;
        if (method === 'turn/completed' && event.params?.turn?.id) {
          entry.nativeTerminal = { turnId: event.params.turn.id, status: event.params.turn.status, ms: Date.now() - startedAt };
        }
      });
      const fullyRead = await drainAbortableBody(response.body, stop.signal, part => parser.push(part));
      if (fullyRead) parser.finish();
      if (!stop.signal.aborted) entry.streamError = 'stream_closed';
    } catch (error) {
      if (!connected) rejectReady(error);
      if (!stop.signal.aborted) entry.streamError = safeError(error);
    } finally { clearTimeout(timeout); if (!connected) rejectReady(new Error('SSE ended before readiness.')); }
  })();
  return { ready, done, stop };
}

async function executeEntry(config, user, entry, save) {
  const startedAt = Date.now(); let subscription;
  entry.startedAt = new Date().toISOString();
  try {
    const baseline = await historyRead(config, user, entry);
    const inventory = await json(config, user, threadPath(entry, '/images'));
    if (baseline.thread.status === 'running' || baseline.messages.length || inventory.status !== 200 || inventory.payload.images?.length !== 0) throw new Error('Paid tests require empty owned fixture threads.');
    subscription = subscribe(config, user, entry, startedAt);
    await subscription.ready;
    entry.dispatchAttempted = true; entry.outcome = 'uncertain';
    // Durable possible-dispatch marker precedes the only POST. A crashed process
    // may reconcile this request but cannot submit it or a replacement again.
    await save();
    try {
      const submitted = await json(config, user, threadPath(entry, '/turns'), {
        model: config.model, effort: 'low', workflow: 'commerce-creative-project', productContextMode: 'none',
        clientRequestId: entry.clientRequestId, message: syntheticPrompt(entry),
      });
      entry.submitStatus = submitted.status; entry.acceptMs = Date.now() - startedAt;
      if (submitted.status === 200 && typeof submitted.payload.result?.turn?.id === 'string') entry.turnId = submitted.payload.result.turn.id;
      else if ([400, 401, 403, 404, 409, 422, 429].includes(submitted.status)) entry.outcome = 'rejected';
      if (/^[A-Z0-9_]{1,100}$/.test(submitted.payload.code ?? '')) entry.rejectCode = submitted.payload.code;
    } catch (error) { entry.submitError = safeError(error); }
    await save();
    while (entry.outcome !== 'rejected' && Date.now() - startedAt < config.turnTimeoutMs) {
      await delay(config.pollMs);
      try {
        const status = await json(config, user, threadPath(entry, '/status'));
        if (status.status === 200 && entry.turnId && status.payload.thread?.lastTurnId === entry.turnId && TERMINAL.has(status.payload.thread.status)) break;
        if (!entry.turnId) {
          const history = await historyRead(config, user, entry);
          const matching = history.messages.filter(message => message.clientId === entry.clientRequestId);
          const ids = [...new Set(matching.map(message => message.turnId).filter(Boolean))];
          if (ids.length === 1) entry.turnId = ids[0];
        }
      } catch { entry.readErrors = (entry.readErrors ?? 0) + 1; }
    }
    if (entry.outcome !== 'rejected') {
      if (Date.now() - startedAt >= config.turnTimeoutMs) entry.deadlineExceeded = true;
      await readback(config, user, entry);
      // Artifact persistence/readback may trail the native terminal event.
      // Retry these owned GETs only; never issue another generation request.
      for (let attempt = 0; attempt < 6 && entry.outcome === 'quality_or_readback_failed' &&
        entry.readback?.terminal === 'completed' && !entry.readback.duplicate; attempt++) {
        await delay(config.pollMs);
        await readback(config, user, entry);
      }
    }
  } catch (error) {
    entry.failure = safeError(error);
    entry.outcome = entry.dispatchAttempted ? 'uncertain' : 'not_submitted';
  } finally {
    if (subscription && !await stopSubscription(subscription)) entry.streamError = 'stream_shutdown_timeout';
    entry.elapsedMs = Date.now() - startedAt; await save();
    console.log(JSON.stringify({ user: entry.user, kind: entry.kind, outcome: entry.outcome, turnId: entry.turnId ?? null, elapsedMs: entry.elapsedMs }));
  }
}

export async function main(mode = process.argv[2], environment = process.env) {
  if (!['preflight', 'batch', 'reconcile'].includes(mode)) throw new Error('Use mixed-ai.mjs preflight|batch|reconcile. No mode auto-submits work.');
  const config = mixedConfig(environment);
  const users = JSON.parse(await readFile(config.usersFile, 'utf8')); validateMixedUsers(users);
  await mkdir(config.outputDir, { recursive: true, mode: 0o700 });
  const path = join(config.outputDir, 'mixed-ai-receipt.json');
  let receipt;
  if (mode === 'preflight') {
    const catalog = await json(config, users[0], '/api/provider/models');
    if (catalog.status !== 200 || /fixture|stub/i.test(catalog.payload.provider?.id ?? '') ||
      !catalog.payload.agentModels?.some(model => model.id === config.model) || !catalog.payload.imageModels?.length) throw new Error('A real agent and native image provider catalog must be ready.');
    receipt = createMixedPlan(users, config.model);
    await writeFile(path, JSON.stringify(receipt, null, 2), { flag: 'wx', mode: 0o600 });
  } else {
    receipt = JSON.parse(await readFile(path, 'utf8'));
    if (receipt.schemaVersion !== 1 || receipt.fixtureFingerprint !== fixtureFingerprint(users) || receipt.model !== config.model || receipt.entries.length !== 32) throw new Error('Receipt does not match the current isolated fixture and model.');
  }
  let writes = Promise.resolve();
  const save = () => {
    const snapshot = JSON.stringify(receipt, null, 2);
    writes = writes.then(async () => { const temp = `${path}.${randomUUID()}.tmp`; await writeFile(temp, snapshot, { flag: 'wx', mode: 0o600 }); await rename(temp, path); });
    return writes;
  };
  if (mode === 'reconcile') {
    const before = receipt.entries.map(entry => ({ user: entry.user, turnId: entry.turnId, artifacts: entry.artifacts ?? [] }));
    for (const entry of receipt.entries.filter(entry => entry.dispatchAttempted && entry.outcome !== 'rejected')) {
      entry.recoveryConfirmed = false;
      try { await readback(config, users[entry.user], entry); entry.recoveryConfirmed = true; delete entry.recoveryError; }
      catch (error) { entry.recoveryError = safeError(error); entry.outcome = 'uncertain'; }
    }
    receipt.recovery = { capturedAt: new Date().toISOString(), mode: 'read_only',
      unchangedArtifacts: before.every(old => old.artifacts.every(artifact => receipt.entries[old.user].artifacts?.some(value => value.filename === artifact.filename && value.sha256 === artifact.sha256))),
      unchangedTurnIds: before.every(old => !old.turnId || receipt.entries[old.user].turnId === old.turnId),
      allReadbacksConfirmed: receipt.entries.filter(entry => entry.dispatchAttempted && entry.outcome !== 'rejected').every(entry => entry.recoveryConfirmed) };
  } else {
    assertPhaseCanDispatch(receipt, mode);
    // An immutable claim also fences concurrent driver processes. Never remove
    // it to repeat a phase; a crash permits read-only reconciliation only.
    await writeFile(join(config.outputDir, `mixed-ai-${mode}.dispatch-claimed`), receipt.runId, { flag: 'wx', mode: 0o600 });
    receipt.phases[mode] = 'started'; await save();
    const reading = mode === 'batch' ? runReadLoad(users, 100, { ...readLoadConfig({ LOADTEST_BASE_URL: config.baseUrl }, config.readDurationMs), requestTimeoutMs: config.requestTimeoutMs }) : null;
    const running = Promise.all(receipt.entries.filter(entry => entry.phase === mode).map(entry => executeEntry(config, users[entry.user], entry, save)));
    if (reading) {
      const [readResult, execution] = await Promise.allSettled([reading, running]);
      receipt.readLoad = readResult.status === 'fulfilled' ? readResult.value.summary : { passed: false, error: 'read_load_failed' };
      if (execution.status === 'rejected') throw execution.reason;
    }
    else await running;
    receipt.phases[mode] = 'finished';
  }
  let ledger = null;
  if (config.usageFile) ledger = JSON.parse(await readFile(config.usageFile, 'utf8'));
  for (const entry of receipt.entries) if (entry.turnId) entry.usage = matchUsage(entry, ledger);
  receipt.actualConsumption = summarizeRunUsage(receipt.entries, ledger);
  const expected = receipt.phases.batch === 'not_started' ? receipt.entries.slice(0, 2) : receipt.entries;
  receipt.summary = { completed: receipt.entries.filter(entry => entry.outcome === 'completed_verified').length,
    dispatched: receipt.entries.filter(entry => entry.dispatchAttempted).length,
    uncertain: receipt.entries.filter(entry => entry.outcome === 'uncertain').length,
    imageArtifacts: receipt.entries.reduce((sum, entry) => sum + (entry.artifacts?.length ?? 0), 0),
    ledgerVerified: receipt.entries.filter(entry => entry.usage.status === 'matched_operator_ledger_readback').length,
    executionPassed: expected.every(entry => entry.dispatchAttempted && entry.outcome === 'completed_verified' && !entry.foreignSseEvents && !entry.requiresHumanInput),
    streamPassed: expected.every(entry => entry.sseConnected && !entry.streamError && !entry.invalidSseFrames && !entry.foreignSseEvents),
    byKind: ['text', 'image'].map(kind => {
      const entries = expected.filter(entry => entry.kind === kind);
      const p95 = key => percentile(entries.map(entry => entry[key]).filter(Number.isFinite), 0.95);
      return { kind, count: entries.length, completed: entries.filter(entry => entry.outcome === 'completed_verified').length,
        acceptP95Ms: p95('acceptMs'), firstTextP95Ms: p95('firstTextMs'), firstImageP95Ms: p95('firstImageMs'), totalP95Ms: p95('elapsedMs') };
    }),
    usagePassed: receipt.actualConsumption.status === 'matched_full_root_ledger_readback' && expected.every(entry => entry.dispatchAttempted && entry.usage.status === 'matched_operator_ledger_readback') };
  await save(); console.log(JSON.stringify(receipt.summary));
  if (!receipt.summary.executionPassed || !receipt.summary.streamPassed || (mode === 'batch' && !receipt.readLoad?.passed) || (mode === 'reconcile' && (!receipt.summary.usagePassed || !receipt.recovery.allReadbacksConfirmed || !receipt.recovery.unchangedArtifacts || !receipt.recovery.unchangedTurnIds))) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error(JSON.stringify({ failed: true, code: 'MIXED_AI_DRIVER_FAILED', action: 'Inspect the private receipt; never repeat an uncertain phase.' })); process.exitCode = 1; });
}
