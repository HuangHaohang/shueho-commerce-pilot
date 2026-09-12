import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { READ_FIXTURE_SECRET } from './read-fixture-policy.mjs';
import { createLiveFixtureState, main, parseLiveProviderFile, preflightLiveProvider, readLiveEnvironmentPlan } from './run-live-environment.mjs';

const contents = `COMMERCE_PROVIDER_BASE_URL=https://provider.example.test/v1
COMMERCE_PROVIDER_API_KEY=synthetic-key-do-not-log
CODEX_DEFAULT_MODEL=gpt-5.6-luna
DATABASE_URL=must-not-pass-through
OPENAI_API_KEY=must-not-pass-through
COMMERCE_GATEWAY_INTERNAL_TOKEN=must-not-pass-through
NODE_OPTIONS=--require must-not-pass-through
HTTPS_PROXY=must-not-pass-through
NEXT_PUBLIC_PROVIDER_KEY=must-not-pass-through
`;
const state = { schemaVersion: 1, databaseName: 'commerce_pilot_scale_20260912', tenantId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002', organizationId: '00000000-0000-4000-8000-000000000003',
  users: Array.from({ length: 100 }, (_, index) => ({ id: `scale-read-abcdefabcdef-${index}`, sessionId: `session-${index}`, token: `token-${index}`,
    cookie: `commerce_pilot.session_token=synthetic-${index}`, secureCookie: `__Secure-commerce_pilot.session_token=synthetic-${index}`, threadId: `old-thread-${index}`, bindUncertain: true })),
  secretHash: createHash('sha256').update(READ_FIXTURE_SECRET).digest('hex') };

test('provider file must be explicitly selected; no filesystem guessing or execution occurs', async () => {
  await assert.rejects(main({}, ['start']), { code: 'EXPLICIT_PROVIDER_FILE_REQUIRED' });
});

test('only provider-owned configuration is accepted from the selected file', () => {
  const provider = parseLiveProviderFile(contents);
  assert.equal(provider.COMMERCE_PROVIDER_API_KEY, 'synthetic-key-do-not-log');
  assert.equal(provider.COMMERCE_PROVIDER_ID, 'scale_live_provider');
  assert.equal(provider.COMMERCE_AGENT_MODEL_SELECTORS, provider.CODEX_DEFAULT_MODEL);
  assert.equal(JSON.stringify(provider).includes('must-not-pass-through'), false);
  for (const base of ['http://remote.example/v1', 'https://user:password@example.test/v1', 'https://example.test/v1?api_key=x']) {
    assert.throws(() => parseLiveProviderFile(`COMMERCE_PROVIDER_BASE_URL=${base}\nCOMMERCE_PROVIDER_API_KEY=synthetic`), { code: 'PROVIDER_URL_INVALID' });
  }
});

test('401 discovery stops after one GET without consuming or exposing the provider error body', async () => {
  const calls = [];
  let bodyRead = false;
  await assert.rejects(preflightLiveProvider(parseLiveProviderFile(contents), async (url, options) => {
    calls.push({ url, options });
    return { ok: false, status: 401, body: { cancel: async () => {} }, json: async () => { bodyRead = true; return { secret: 'must-not-read' }; } };
  }), { code: 'PROVIDER_AUTH_REJECTED', status: 401 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://provider.example.test/v1/models');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(bodyRead, false);
});

test('successful preflight returns only safe discovery metadata and never submits a Turn', async () => {
  let requests = 0;
  const result = await preflightLiveProvider(parseLiveProviderFile(contents), async (_url, options) => {
    requests += 1;
    assert.equal(options.method, 'GET');
    return new Response(JSON.stringify({ data: [{ id: 'gpt-5.6-luna' }, { id: 'gpt-image-2' }] }));
  });
  assert.deepEqual(result, { authenticated: true, modelCount: 2, selectedModel: 'gpt-5.6-luna', modelTurnsCreated: 0 });
  assert.equal(requests, 1);
  assert.equal(JSON.stringify(result).includes('synthetic-key'), false);
});

test('missing configured model is rejected before any model execution', async () => {
  await assert.rejects(preflightLiveProvider(parseLiveProviderFile(contents), async () => new Response(JSON.stringify({ data: [] }))), {
    code: 'PROVIDER_MODEL_UNAVAILABLE',
  });
});

test('live plan uses independent ports, home, callbacks and fixture path without leaking provider secrets to Web', () => {
  const plan = readLiveEnvironmentPlan(state, parseLiveProviderFile(contents), { COMMERCE_PROVIDER_API_KEY: 'wrong-parent-key', NODE_OPTIONS: 'wrong-parent-preload' });
  assert.deepEqual(plan.ports, { web: 3200, gateway: 8897 });
  assert.match(plan.fixtureDirectory, /scale-validation[\\/]live-validation$/);
  assert.match(plan.gatewayEnvironment.CODEX_HOME, /live-validation[\\/]codex$/);
  assert.equal(plan.gatewayEnvironment.COMMERCE_PROVIDER_API_KEY, 'synthetic-key-do-not-log');
  assert.equal(plan.gatewayEnvironment.COMMERCE_AGENT_AUTHORIZATION_URL, 'http://127.0.0.1:3200/api/internal/agent-authorization');
  assert.equal(plan.webEnvironment.COMMERCE_GATEWAY_URL, 'http://127.0.0.1:8897');
  assert.equal(JSON.stringify(plan.webEnvironment).includes('synthetic-key'), false);
  assert.equal(JSON.stringify(plan.baseEnvironment).includes('synthetic-key'), false);
  assert.equal(JSON.stringify(plan).includes('wrong-parent'), false);
});

test('live users preserve real fixture identities but drop every stale read-only thread binding', () => {
  const fresh = createLiveFixtureState(state, parseLiveProviderFile(contents));
  assert.equal(fresh.users.length, 100);
  assert.equal(fresh.users[0].id, state.users[0].id);
  assert.equal(fresh.users[0].secureCookie, state.users[0].secureCookie);
  assert.equal(fresh.users.some(user => user.threadId || user.bindUncertain), false);
  assert.equal(state.users[0].threadId, 'old-thread-0');
  assert.equal(fresh.runtimePurpose, 'live-provider-validation');
  assert.equal(JSON.stringify(fresh).includes('synthetic-key'), false);
});
