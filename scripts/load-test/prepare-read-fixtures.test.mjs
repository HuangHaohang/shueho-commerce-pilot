import assert from 'node:assert/strict';
import test from 'node:test';
import { bindReadFixtures, readSecureCookies } from './prepare-read-fixtures.mjs';

const user = index => ({ id: `scale-read-abcdefabcdef-${index}`,
  cookie: `commerce_pilot.session_token=synthetic-${index}`,
  secureCookie: `__Secure-commerce_pilot.session_token=synthetic-${index}` });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

test('default cookies match the explicit production BetterAuth secure prefix', () => {
  assert.equal(readSecureCookies(), true);
  assert.equal(readSecureCookies(''), true);
  assert.equal(readSecureCookies('false'), false);
  assert.throws(() => readSecureCookies('0'));
});

test('bind authenticates 100 users at the real product endpoint and creates exactly 100 empty native threads', async () => {
  const state = { schemaVersion: 1, users: Array.from({ length: 100 }, (_, index) => user(index)) };
  const receipts = [];
  const calls = [];
  const result = await bindReadFixtures(state, {
    save: async () => receipts.push(structuredClone(state)),
    request: async (url, options) => {
      calls.push({ url, method: options.method ?? 'GET' });
      const index = Number(options.headers.cookie.match(/synthetic-(\d+)/)[1]);
      assert.ok(options.headers.cookie.startsWith('__Secure-commerce_pilot.session_token='));
      assert.equal(options.redirect, 'error');
      if (url.endsWith('/api/account/session')) return json({ user: { id: user(index).id } });
      assert.equal(url, 'http://127.0.0.1:3100/api/agent/threads');
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), { model: 'gpt-5.6-luna', workflow: 'commerce-creative-project' });
      assert.equal(receipts.at(-1).users[index].bindUncertain, true);
      return json({ result: { thread: { id: `native-thread-${index}` } } });
    },
  });
  assert.deepEqual(result, { boundUsers: 100, newlyCreatedEmptyThreads: 100, modelTurnsCreated: 0 });
  assert.equal(calls.length, 200);
  assert.equal(calls.filter(call => call.method === 'POST').length, 100);
  assert.equal(receipts.at(-1).users.some(candidate => candidate.bindUncertain), false);
});

test('wrong session identity fails before any empty thread creation', async () => {
  const state = { schemaVersion: 1, users: [user(0)] };
  let calls = 0;
  await assert.rejects(bindReadFixtures(state, { save: async () => {}, request: async () => {
    calls += 1; return json({ user: { id: user(1).id } });
  } }), /authentication failed/);
  assert.equal(calls, 1);
  assert.equal(state.users[0].bindUncertain, undefined);
});

test('uncertain creation remains fenced and is never repeated automatically', async () => {
  const state = { schemaVersion: 1, users: [user(0)] };
  let writes = 0;
  const options = { save: async () => {}, request: async (url) => {
    if (url.endsWith('/session')) return json({ user: { id: user(0).id } });
    writes += 1; throw new Error('connection lost after dispatch');
  } };
  await assert.rejects(bindReadFixtures(state, options), /connection lost/);
  await assert.rejects(bindReadFixtures(state, options), /previous empty-thread creation is uncertain/);
  assert.equal(writes, 1);
});

test('rerunning bind verifies persisted empty threads rather than assuming they survived a runtime restart', async () => {
  const state = { schemaVersion: 1, users: [{ ...user(0), threadId: 'native-thread-0' }] };
  const calls = [];
  await assert.rejects(bindReadFixtures(state, { save: async () => {}, request: async (url, options) => {
    calls.push({ url, method: options.method ?? 'GET' });
    return url.endsWith('/session') ? json({ user: { id: user(0).id } }) : json({ error: 'missing' }, 404);
  } }), /Previously bound empty Harness thread is not available/);
  assert.equal(calls.length, 2);
  assert.equal(calls.every(call => call.method === 'GET'), true);
  assert.equal(state.users[0].threadId, 'native-thread-0');
});
