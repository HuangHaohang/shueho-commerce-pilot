import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { main } from './mixed-ai.mjs';
import { createMixedPlan, createSseParser, validateMixedUsers, assertPhaseCanDispatch, mixedConfig,
  PAID_AUTHORIZATION, assessReadback, matchUsage, visibleAssistantText, drainAbortableBody, stopSubscription, summarizeRunUsage } from './mixed-ai-protocol.mjs';

const users = Array.from({ length: 100 }, (_, index) => ({ cookie: `fixture-${index}`, threadId: `native-thread-${index}` }));
test('fixed paid scope is 1+1 preflight followed by 20 text and 10 image turns with unique requests', () => {
  const plan = createMixedPlan(users, 'gpt-5.6-luna');
  assert.equal(plan.entries.filter(entry => entry.kind === 'text').length, 21);
  assert.equal(plan.entries.filter(entry => entry.kind === 'image').length, 11);
  assert.equal(new Set(plan.entries.map(entry => entry.clientRequestId)).size, 32);
  assertPhaseCanDispatch(plan, 'preflight');
  assert.throws(() => assertPhaseCanDispatch(plan, 'batch'), /preflight/);
  plan.phases.preflight = 'started';
  assert.throws(() => assertPhaseCanDispatch(plan, 'preflight'), /cannot be submitted again/);
  plan.phases.preflight = 'finished';
  plan.entries.slice(0, 2).forEach(entry => entry.outcome = 'completed_verified');
  assertPhaseCanDispatch(plan, 'batch');
  plan.entries[2].dispatchAttempted = true;
  assert.throws(() => assertPhaseCanDispatch(plan, 'batch'), /cannot be submitted again/);
});

test('rejects missing authorization, daily/remote services and repeated user/thread fixtures', () => {
  assert.throws(() => mixedConfig({}), /authorization|scope/i);
  assert.throws(() => mixedConfig({ LOADTEST_PAID_AUTHORIZATION: PAID_AUTHORIZATION, LOADTEST_BASE_URL: 'http://127.0.0.1:3000' }), /isolated/);
  assert.throws(() => mixedConfig({ LOADTEST_PAID_AUTHORIZATION: PAID_AUTHORIZATION, LOADTEST_BASE_URL: 'https://production.example' }), /isolated/);
  assert.throws(() => validateMixedUsers(users.slice(0, 99)), /100 distinct/);
  assert.throws(() => validateMixedUsers(users.map((user, index) => index === 1 ? users[0] : user)), /100 distinct/);
});

test('decodes Chinese and emoji correctly across every byte split and CRLF frame boundary', () => {
  const wire = new TextEncoder().encode('event: notification\r\ndata: {"text":"陶瓷杯🫖"}\r\n\r\nevent: gateway/connected\ndata: {}\n\n');
  const frames = []; const parser = createSseParser(frame => frames.push(frame));
  for (const byte of wire) parser.push(Uint8Array.of(byte));
  parser.finish();
  assert.deepEqual(JSON.parse(frames[0].data), { text: '陶瓷杯🫖' });
  assert.equal(frames[1].event, 'gateway/connected');
});

test('does not silently accept partial, oversized or invalid UTF-8 event frames', () => {
  const parser = createSseParser(() => {}); parser.push(new TextEncoder().encode('data: unfinished'));
  assert.throws(() => parser.finish(), /partial frame/);
  assert.throws(() => createSseParser(() => {}, 5).push(new TextEncoder().encode('data: too long\n\n')), /safe bound/);
  assert.throws(() => createSseParser(() => {}).push(Uint8Array.of(255)), /encoded data|encoding/i);
});

test('SSE abort does not await a transport cancel promise that never settles', async () => {
  const controller = new AbortController(); let cancelled = false;
  const body = new ReadableStream({
    start(stream) { stream.enqueue(new TextEncoder().encode('data: ready\n\n')); },
    cancel() { cancelled = true; return new Promise(() => {}); },
  });
  const task = drainAbortableBody(body, controller.signal, () => controller.abort());
  assert.equal(await task, false); assert.equal(cancelled, true);
});

test('SSE abort races a permanently pending reader and bounded shutdown cannot hang the paid receipt', async () => {
  const controller = new AbortController(); let released = false, cancelled = false;
  const body = { getReader: () => ({ read: () => new Promise(() => {}), cancel: () => { cancelled = true; return new Promise(() => {}); }, releaseLock: () => { released = true; } }) };
  const task = drainAbortableBody(body, controller.signal, () => {});
  controller.abort(); assert.equal(await task, false); assert.equal(cancelled, true); assert.equal(released, true);
  const stop = new AbortController();
  assert.equal(await stopSubscription({ stop, done: new Promise(() => {}) }, 10), false);
  assert.equal(stop.signal.aborted, true);
});

function proofFixture() {
  const entry = { kind: 'image', clientRequestId: 'request-1', threadId: 'thread-1', turnId: 'turn-1' };
  const status = { id: 'thread-1', lastTurnId: 'turn-1', status: 'completed' };
  const history = { thread: status, messages: [{ role: 'user', clientId: 'request-1', turnId: 'turn-1' }],
    activities: [{ id: 'native-image', kind: 'image', status: 'completed', turnId: 'turn-1' }] };
  const images = [{ filename: 'image.png', turnId: 'turn-1' }];
  return { entry, status, history, images };
}
test('requires matching native client request, terminal turn and actual image inventory', () => {
  const { entry, status, history, images } = proofFixture();
  assert.equal(assessReadback(entry, status, history, images).verified, true);
  assert.equal(assessReadback(entry, { ...status, status: 'running' }, history, images).verified, false);
  assert.equal(assessReadback(entry, { ...status, lastTurnId: 'unrelated' }, history, images).verified, false);
  assert.equal(assessReadback(entry, status, history, []).verified, false);
  assert.equal(assessReadback(entry, status, { ...history, activities: [] }, images).verified, false);
  assert.equal(assessReadback(entry, status, { ...history, activities: [...history.activities, { kind: 'image', status: 'failed', turnId: 'turn-1' }] }, images).verified, false);
  assert.equal(assessReadback(entry, status, { ...history, messages: [] }, images).verified, false);
  assert.equal(assessReadback(entry, status, history, [...images, ...images]).duplicate, true);
  assert.equal(assessReadback(entry, status, { ...history, messages: [...history.messages, ...history.messages] }, images).verified, false);
});
test('an uncertain submission can resolve only by exact native request history, never by latest unrelated completion', () => {
  const { entry, status, history, images } = proofFixture(); delete entry.turnId;
  assert.equal(assessReadback(entry, status, history, images).turnId, 'turn-1');
  assert.equal(assessReadback(entry, status, { ...history, messages: [{ ...history.messages[0], clientId: 'someone-else' }] }, images).verified, false);
});
test('empty or interrupted structured replies are not counted as delivered text', () => {
  assert.equal(visibleAssistantText('{"responseType":"answer","message":"","body":""}'), '');
  assert.equal(visibleAssistantText('{"responseType":"draft","body":"partial'), '');
  assert.equal(visibleAssistantText('{"responseType":"draft","title":"标题","body":"文案正文"}'), '标题\n文案正文');
});
test('usage proof requires actual ledger identifiers and reported counters, not native events or model text', () => {
  const { entry } = proofFixture();
  assert.equal(matchUsage(entry, null).status, 'requires_ledger_readback');
  const receipt = { schemaVersion: 1, source: 'commerce_agent_usage_event', capturedAt: '2026-09-12T00:00:00Z', rows: [{
    id: 'actual-ledger-row', threadId: entry.threadId, turnId: entry.turnId, responseId: 'response-1', providerId: 'provider-1',
    model: 'gpt-5.6-luna', usageStatus: 'reported', totalTokens: 25, inputTokens: 20, outputTokens: 5,
  }] };
  assert.equal(matchUsage(entry, receipt).status, 'matched_operator_ledger_readback');
  assert.equal(matchUsage(entry, { ...receipt, rows: [{ ...receipt.rows[0], usageStatus: 'missing' }] }).status, 'missing_or_incomplete_ledger');
  assert.equal(matchUsage(entry, { ...receipt, rows: [receipt.rows[0], receipt.rows[0]] }).status, 'missing_or_incomplete_ledger');
  assert.equal(matchUsage(entry, { ...receipt, rows: [{ ...receipt.rows[0], turnId: 'different' }] }).status, 'missing_or_incomplete_ledger');
});

test('actual consumption includes title generation and descendant responses rather than reporting logical Turn count as cost', () => {
  const entries = [{ threadId: 'root-1', dispatchAttempted: true }];
  const row = { id: 'ledger-1', rootThreadId: 'root-1', threadId: 'root-1', turnId: 'turn-1', responseId: 'response-1', providerId: 'provider-1', source: 'codex_harness', usageStatus: 'reported', totalTokens: 30 };
  const receipt = { schemaVersion: 1, source: 'commerce_agent_usage_event', scope: { rootThreadIds: ['root-1'], includesDescendants: true, includesAllSources: true }, rows: [
    row, { ...row, id: 'ledger-2', responseId: 'response-2', source: 'title_generation', totalTokens: 10 },
    { ...row, id: 'ledger-3', responseId: 'response-3', threadId: 'child-1', totalTokens: 20 },
    { ...row, id: 'foreign', responseId: 'foreign', rootThreadId: 'someone-else', totalTokens: 900 },
  ] };
  const result = summarizeRunUsage(entries, receipt);
  assert.equal(result.status, 'matched_full_root_ledger_readback');
  assert.equal(result.providerResponses, 3); assert.equal(result.totalTokens, 60); assert.equal(result.descendantResponses, 1);
  assert.deepEqual(result.bySource.find(item => item.source === 'title_generation'), { source: 'title_generation', responses: 1, totalTokens: 10 });
  assert.equal(summarizeRunUsage(entries, { ...receipt, scope: undefined }).status, 'incomplete_root_ledger');
  assert.equal(summarizeRunUsage(entries, { ...receipt, rows: [row, row] }).providerResponses, null);
});

test('fake-BFF preflight sends exactly two POSTs, reconciles a lost acknowledgement, and restart readback never redispatches', async t => {
  const fixtureRoot = fileURLToPath(new URL('../../.runtime/scale-validation/', import.meta.url));
  await mkdir(fixtureRoot, { recursive: true });
  const directory = await mkdtemp(join(fixtureRoot, 'mixed-driver-offline-'));
  const usersFile = join(directory, 'users.json'), outputDir = join(directory, 'result');
  const requireWeb = createRequire(new URL('../../apps/web/package.json', import.meta.url));
  const imageBytes = await requireWeb('sharp')({ create: { width: 16, height: 16, channels: 3, background: '#123456' } }).png().toBuffer();
  const filename = '1710000000000-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png';
  const turns = new Map(); let posts = 0, unexpectedRequests = 0;
  const previousExitCode = process.exitCode;
  t.mock.method(console, 'log', () => {});
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(input), path = url.pathname;
    if (url.origin !== 'http://127.0.0.1:3199') { unexpectedRequests++; throw new Error('Unexpected network origin.'); }
    const index = Number(String(init.headers?.cookie ?? '').replace('fixture-', ''));
    const threadId = users[index]?.threadId;
    if (path === '/api/provider/models') return Response.json({ provider: { id: 'offline-evaluation' }, agentModels: [{ id: 'gpt-5.6-luna' }], imageModels: [{ id: 'gpt-image-2' }] });
    if (path === '/api/agent/events') return new Response(new ReadableStream({
      start(controller) {
        const bytes = new TextEncoder().encode('event: gateway/connected\r\ndata: {}\r\n\r\n');
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        init.signal.addEventListener('abort', () => controller.close(), { once: true });
      },
    }), { headers: { 'content-type': 'text/event-stream' } });
    if (path === `/api/provider/generated-images/${filename}`) return new Response(imageBytes, { headers: { 'content-type': 'image/png' } });
    if (!threadId || !path.startsWith(`/api/agent/threads/${threadId}`)) { unexpectedRequests++; throw new Error('Unexpected BFF route.'); }
    if (init.method === 'POST') {
      assert.equal(path, `/api/agent/threads/${threadId}/turns`);
      posts++; const request = JSON.parse(init.body); const turnId = `turn-${index}`;
      turns.set(threadId, { turnId, requestId: request.clientRequestId });
      // The first accepted Turn loses its HTTP acknowledgement. Only history
      // readback can recover it; there must not be a second POST.
      return index === 0 ? Response.json({ error: 'unavailable' }, { status: 503 }) : Response.json({ result: { turn: { id: turnId } } });
    }
    const turn = turns.get(threadId);
    const thread = { id: threadId, lastTurnId: turn?.turnId ?? null, status: turn ? 'completed' : 'idle' };
    if (path.endsWith('/status')) return Response.json({ thread });
    if (path.endsWith('/images')) return Response.json({ images: turn && index === 1 ? [{ filename, turnId: turn.turnId }] : [] });
    return Response.json({ thread, messages: turn ? [
      { id: `user-${index}`, role: 'user', clientId: turn.requestId, turnId: turn.turnId },
      { id: `assistant-${index}`, role: 'assistant', content: '已生成合成商品文案。', turnId: turn.turnId, phase: 'final_answer' },
    ] : [], activities: turn && index === 1 ? [{ id: 'image-native', kind: 'image', status: 'completed', turnId: turn.turnId }] : [], nextCursor: null });
  });
  const env = { LOADTEST_PAID_AUTHORIZATION: PAID_AUTHORIZATION, LOADTEST_BASE_URL: 'http://127.0.0.1:3199',
    LOADTEST_USERS_FILE: usersFile, LOADTEST_OUTPUT_DIR: outputDir, LOADTEST_POLL_MS: '1000', LOADTEST_TURN_TIMEOUT_MS: '10000' };
  try {
    await writeFile(usersFile, JSON.stringify(users), { mode: 0o600 });
    await main('preflight', env);
    let receipt = JSON.parse(await readFile(join(outputDir, 'mixed-ai-receipt.json'), 'utf8'));
    assert.equal(posts, 2); assert.equal(receipt.summary.completed, 2); assert.equal(receipt.entries[0].submitStatus, 503);
    assert.equal(receipt.entries[0].turnId, 'turn-0'); assert.equal(receipt.entries[1].artifacts[0].width, 16);
    await assert.rejects(main('preflight', env), /EEXIST/); assert.equal(posts, 2);
    const ledgerPath = join(directory, 'ledger.json');
    await writeFile(ledgerPath, JSON.stringify({ schemaVersion: 1, source: 'commerce_agent_usage_event', capturedAt: new Date().toISOString(),
      scope: { rootThreadIds: receipt.entries.slice(0, 2).map(entry => entry.threadId), includesDescendants: true, includesAllSources: true }, rows: receipt.entries.slice(0, 2).map(entry => ({
      id: `fixture-ledger-${entry.user}`, rootThreadId: entry.threadId, threadId: entry.threadId, turnId: entry.turnId,
      responseId: `fixture-response-${entry.user}`, providerId: 'offline-evaluation', model: 'gpt-5.6-luna',
      source: 'codex_harness', usageStatus: 'reported', totalTokens: 20, inputTokens: 10, outputTokens: 10,
    })) }), { mode: 0o600 });
    await main('reconcile', { ...env, LOADTEST_USAGE_RECEIPTS_FILE: ledgerPath });
    receipt = JSON.parse(await readFile(join(outputDir, 'mixed-ai-receipt.json'), 'utf8'));
    assert.equal(posts, 2); assert.equal(unexpectedRequests, 0);
    assert.equal(receipt.recovery.allReadbacksConfirmed, true); assert.equal(receipt.recovery.unchangedArtifacts, true);
    assert.equal(receipt.summary.usagePassed, true);
    assert.equal(JSON.stringify(receipt).includes('fixture-0'), false, 'cookies must not enter receipts');
    assert.equal(JSON.stringify(receipt).includes('这是已授权'), false, 'prompts must not enter receipts');
  } finally {
    process.exitCode = previousExitCode;
    assert.ok(relative(fixtureRoot, directory).startsWith('mixed-driver-offline-'));
    await rm(directory, { recursive: true, force: true });
  }
});
