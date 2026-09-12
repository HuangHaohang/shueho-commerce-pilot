import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readEnvironmentPlan, stageApplications } from './run-read-environment.mjs';
import { READ_FIXTURE_SECRET, READ_FIXTURE_PROVIDER_KEY } from './read-fixture-policy.mjs';

const state = { schemaVersion: 1, databaseName: 'commerce_pilot_scale_20260912', tenantId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002', organizationId: '00000000-0000-4000-8000-000000000003',
  users: Array.from({ length: 100 }, (_, index) => ({ id: `scale-read-abcdefabcdef-${index}`, secureCookie: 'fixture-only' })),
  secretHash: createHash('sha256').update(READ_FIXTURE_SECRET).digest('hex') };

test('review plan uses isolated ports, the verified runtime and source-defined callback routes', () => {
  const plan = readEnvironmentPlan(state, {});
  assert.deepEqual(plan.ports, { web: 3100, gateway: 8887, catalog: 8888 });
  assert.match(plan.gatewayEnvironment.CODEX_BIN, /\.runtime[\\/]bin[\\/]/);
  assert.match(plan.gatewayEnvironment.CODEX_HOME, /scale-validation[\\/]codex$/);
  assert.equal(plan.gatewayEnvironment.COMMERCE_AGENT_AUTHORIZATION_URL, 'http://127.0.0.1:3100/api/internal/agent-authorization');
  assert.equal(plan.gatewayEnvironment.COMMERCE_AGENT_ADMISSION_URL, 'http://127.0.0.1:3100/api/internal/agent-admission');
  assert.equal(plan.gatewayEnvironment.COMMERCE_AGENT_EVENT_SINK_URL, 'http://127.0.0.1:3100/api/internal/agent-events');
});

test('child plans omit inherited provider, database, proxy and Node preload credentials', () => {
  const plan = readEnvironmentPlan(state, { COMMERCE_PROVIDER_API_KEY: 'real-provider-sentinel', DATABASE_URL: 'real-database-sentinel',
    OPENAI_API_KEY: 'real-openai-sentinel', HTTPS_PROXY: 'real-proxy-sentinel', NODE_OPTIONS: '--require secret-loader', CODEX_HOME: 'real-home-sentinel' });
  assert.equal(plan.gatewayEnvironment.COMMERCE_PROVIDER_API_KEY, READ_FIXTURE_PROVIDER_KEY);
  assert.equal(plan.webEnvironment.BETTER_AUTH_SECRET, READ_FIXTURE_SECRET);
  assert.equal(JSON.stringify(plan).includes('sentinel'), false);
  assert.equal(plan.gatewayEnvironment.NODE_OPTIONS, undefined);
  assert.equal(plan.webEnvironment.MIGRATION_DATABASE_URL, undefined);
  assert.equal(plan.webEnvironment.COMMERCE_PROVIDER_API_KEY, undefined);
});

test('an unrelated fixture receipt or owner/remote runtime URL is refused without starting processes', () => {
  assert.throws(() => readEnvironmentPlan({ ...state, databaseName: 'commerce_pilot' }, {}));
  assert.throws(() => readEnvironmentPlan({ ...state, users: [] }, {}));
  assert.throws(() => readEnvironmentPlan(state, { SCALE_RUNTIME_DATABASE_URL: 'postgres://commerce_pilot@127.0.0.1/commerce_pilot_scale_20260912' }));
  assert.throws(() => readEnvironmentPlan(state, { SCALE_RUNTIME_DATABASE_URL: 'postgres://commerce_pilot_app@remote.invalid/commerce_pilot_scale_20260912' }));
});

test('staging snapshots the completed build and preserves dependency hierarchy without copying checkout env files', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'commerce-scale-stage-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const source = join(temporary, 'source');
  const output = join(temporary, 'isolated');
  for (const path of ['dist', 'vendor', 'runtime', 'node_modules', 'apps/web/node_modules', 'apps/web/public', 'apps/web/.next-scale-validation/cache']) {
    await mkdir(join(source, path), { recursive: true });
  }
  await mkdir(output);
  await writeFile(join(source, 'package.json'), '{}');
  for (const file of ['package.json', 'next.config.ts', 'tsconfig.json']) await writeFile(join(source, 'apps/web', file), file === 'package.json' ? '{}' : '');
  await writeFile(join(source, '.env'), 'SENTINEL=must-not-copy');
  await writeFile(join(source, 'apps/web/.env'), 'SENTINEL=must-not-copy');
  await writeFile(join(source, 'apps/web/.next-scale-validation/BUILD_ID'), 'build-before');
  await writeFile(join(source, 'apps/web/.next-scale-validation/cache/ignored'), 'build-cache');
  const plan = readEnvironmentPlan(state, {});
  plan.fixtureDirectory = output;
  for (const field of ['HOME', 'APPDATA', 'LOCALAPPDATA', 'TEMP']) plan.baseEnvironment[field] = join(output, field);
  plan.gatewayEnvironment.CODEX_HOME = join(output, 'codex');
  const staged = await stageApplications(plan, source);
  await writeFile(join(source, 'apps/web/.next-scale-validation/BUILD_ID'), 'build-after');
  assert.equal(await readFile(join(staged.web, '.next-scale-validation/BUILD_ID'), 'utf8'), 'build-before');
  await assert.rejects(readFile(join(staged.web, '.next-scale-validation/cache/ignored')), { code: 'ENOENT' });
  assert.equal(await realpath(join(staged.stage, 'node_modules')), await realpath(join(source, 'node_modules')));
  assert.equal((await readFile(join(staged.web, '.env'), 'utf8')).includes('SENTINEL'), false);
  assert.equal((await readFile(join(staged.gateway, '.env'), 'utf8')).includes('SENTINEL'), false);
});
