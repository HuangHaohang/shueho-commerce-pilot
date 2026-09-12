import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, copyFile, cp, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { READ_FIXTURE_SECRET, READ_FIXTURE_PROVIDER_KEY, validateScaleDatabase } from './read-fixture-policy.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixtureDirectory = resolve(root, '.runtime/scale-validation');
const INTERNAL_TEST_TOKEN = 'scale-internal-service-token-for-loopback-tests-only';
const DATABASE_NAME = 'commerce_pilot_scale_20260912';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readEnvironmentPlan(state, parentEnvironment = process.env) {
  if (state?.schemaVersion !== 1 || state.databaseName !== DATABASE_NAME ||
      ![state.tenantId, state.workspaceId, state.organizationId].every(value => UUID.test(value ?? '')) ||
      !Array.isArray(state.users) || state.users.length !== 100 ||
      state.users.some(user => !/^scale-read-[a-f0-9]{12}-\d+$/.test(user.id ?? '') || typeof user.secureCookie !== 'string' || !user.secureCookie) ||
      new Set(state.users.map(user => user.id)).size !== 100 ||
      state.secretHash !== createHash('sha256').update(READ_FIXTURE_SECRET).digest('hex')) {
    throw new Error('Prepare the matching 100-user isolated fixture with the default scale test secret first.');
  }
  const runtimeDatabase = validateScaleDatabase(parentEnvironment.SCALE_RUNTIME_DATABASE_URL ??
    `postgresql://commerce_pilot_app:commerce_pilot_app_dev@127.0.0.1:55432/${DATABASE_NAME}`);
  if (runtimeDatabase.name !== DATABASE_NAME || decodeURIComponent(runtimeDatabase.url.username) !== 'commerce_pilot_app') {
    throw new Error('This launcher uses only the prepared scale database and the non-owner commerce_pilot_app role.');
  }
  const home = join(fixtureDirectory, 'process-home');
  // Deliberately do not spread process.env: no provider, proxy, cloud, npm, Node
  // preload or developer-Codex credentials flow into any fixture child.
  const baseEnvironment = {
    PATH: process.platform === 'win32'
      ? [dirname(process.execPath), join(parentEnvironment.SystemRoot ?? 'C:\\Windows', 'System32')].join(';')
      : [dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
    HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData/Roaming'),
    LOCALAPPDATA: join(home, 'AppData/Local'), TEMP: join(home, 'tmp'), TMP: join(home, 'tmp'),
    ...(process.platform === 'win32' ? { SystemRoot: parentEnvironment.SystemRoot ?? 'C:\\Windows', WINDIR: parentEnvironment.SystemRoot ?? 'C:\\Windows' } : {}),
    ...(process.platform === 'win32' ? { ComSpec: join(parentEnvironment.SystemRoot ?? 'C:\\Windows', 'System32/cmd.exe'), PATHEXT: '.COM;.EXE;.BAT;.CMD' } : {}),
    NEXT_TELEMETRY_DISABLED: '1', DOTENV_CONFIG_QUIET: 'true',
  };
  const common = { COMMERCE_RUNTIME_TENANT_ID: state.tenantId, COMMERCE_GATEWAY_INTERNAL_TOKEN: INTERNAL_TEST_TOKEN };
  const gatewayEnvironment = {
    ...baseEnvironment, ...common, NODE_ENV: 'development',
    CODEX_HOME: join(fixtureDirectory, 'codex'),
    CODEX_BIN: join(root, '.runtime/bin', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'codex.exe' : 'codex'),
    COMMERCE_AGENT_HOST: '127.0.0.1', COMMERCE_AGENT_PORT: '8887',
    COMMERCE_PROVIDER_ID: 'scale_catalog_fixture', COMMERCE_PROVIDER_NAME: 'Read-only local catalog fixture',
    COMMERCE_PROVIDER_BASE_URL: 'http://127.0.0.1:8888/v1', COMMERCE_PROVIDER_API_KEY: READ_FIXTURE_PROVIDER_KEY,
    CODEX_DEFAULT_MODEL: 'gpt-5.6-luna', COMMERCE_WEB_SEARCH_MODEL: 'gpt-5.6-luna',
    COMMERCE_IMAGE_MODEL: 'gpt-image-2', COMMERCE_IMAGE_QUALITY: 'auto', COMMERCE_AGENT_MODEL_SELECTORS: 'gpt-5.6-luna,gpt-6-astra',
    COMMERCE_AGENT_EVENT_SINK_URL: 'http://127.0.0.1:3100/api/internal/agent-events',
    COMMERCE_AGENT_AUTHORIZATION_URL: 'http://127.0.0.1:3100/api/internal/agent-authorization',
    COMMERCE_AGENT_ADMISSION_URL: 'http://127.0.0.1:3100/api/internal/agent-admission',
    COMMERCE_PRODUCT_CATALOG_CONTROL_URL: 'http://127.0.0.1:3100/api/internal/product-catalog',
    EXTERNAL_DATA_SERVICE_MCP_URL: 'http://127.0.0.1:8888/disabled-external-data', EXTERNAL_DATA_SERVICE_MCP_TOKEN: '',
  };
  const webEnvironment = {
    ...baseEnvironment, ...common, NODE_ENV: 'production',
    DATABASE_URL: runtimeDatabase.url.toString(), COMMERCE_ENFORCE_DATABASE_RLS: 'true',
    COMMERCE_DATABASE_POOL_MAX: '20', COMMERCE_DATABASE_CONNECT_TIMEOUT_MS: '5000',
    BETTER_AUTH_URL: 'http://127.0.0.1:3100', BETTER_AUTH_SECRET: READ_FIXTURE_SECRET,
    AUTH_TRUSTED_ORIGINS: 'http://127.0.0.1:3100,http://localhost:3100',
    COMMERCE_GATEWAY_URL: 'http://127.0.0.1:8887', COMMERCE_ALLOW_PUBLIC_REGISTRATION: 'false',
    AUTH_EMAIL_DELIVERY_PROVIDER: 'disabled', AUTH_SMS_DELIVERY_PROVIDER: 'disabled',
    NEXT_DIST_DIR: '.next-scale-validation',
  };
  return { baseEnvironment, gatewayEnvironment, webEnvironment, tenantId: state.tenantId,
    fixtureDirectory, databaseName: DATABASE_NAME, ports: { web: 3100, gateway: 8887, catalog: 8888 } };
}

async function assertPrerequisites(plan) {
  await Promise.all([
    access(plan.gatewayEnvironment.CODEX_BIN),
    access(join(dirname(plan.gatewayEnvironment.CODEX_BIN), 'runtime-manifest.json')),
    access(join(dirname(plan.gatewayEnvironment.CODEX_BIN), 'LICENSE.codex')),
    access(join(dirname(plan.gatewayEnvironment.CODEX_BIN), 'NOTICE.codex')),
    access(join(root, 'dist/src/gateway/server.js')),
    access(join(root, 'apps/web/.next-scale-validation/BUILD_ID')),
  ]);
  const pool = new Pool({ connectionString: plan.webEnvironment.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 });
  try {
    const role = (await pool.query('SELECT current_database() AS database, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user')).rows[0];
    if (!role || role.database !== DATABASE_NAME || role.rolsuper || role.rolbypassrls) throw new Error('The isolated Web runtime must use a non-superuser, non-BYPASSRLS database role.');
  } finally { await pool.end(); }
}

export async function stageApplications(plan, sourceRoot = root) {
  for (const directory of [plan.baseEnvironment.HOME, plan.baseEnvironment.APPDATA, plan.baseEnvironment.LOCALAPPDATA, plan.baseEnvironment.TEMP, plan.gatewayEnvironment.CODEX_HOME]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  const stage = await mkdtemp(join(plan.fixtureDirectory, 'read-environment-'));
  const gateway = join(stage, 'gateway');
  const web = join(stage, 'web');
  await mkdir(gateway);
  await mkdir(web);
  // Gateway discovers its managed MCP and shipped Skills from cwd. A clean
  // application staging cwd also prevents that MCP's dotenv from reading root .env.
  for (const directory of ['dist', 'vendor', 'runtime']) {
    await cp(join(sourceRoot, directory), join(gateway, directory), { recursive: true, dereference: true });
  }
  await copyFile(join(sourceRoot, 'package.json'), join(gateway, 'package.json'));
  await symlink(join(sourceRoot, 'node_modules'), join(gateway, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  // Match the workspace dependency hierarchy even when the staging location does
  // not happen to sit below the source checkout.
  await symlink(join(sourceRoot, 'node_modules'), join(stage, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const file of ['package.json', 'next.config.ts', 'tsconfig.json']) await copyFile(join(sourceRoot, 'apps/web', file), join(web, file));
  // Next loads .env itself; a separate app directory avoids every real Web .env
  // without relying on private Next flags or editing the user's development files.
  for (const directory of ['node_modules', 'public']) {
    await symlink(join(sourceRoot, 'apps/web', directory), join(web, directory), process.platform === 'win32' ? 'junction' : 'dir');
  }
  // Snapshot the completed production artifact: rebuilding the source checkout
  // must not replace files underneath the already-running isolated Web process.
  const buildSource = join(sourceRoot, 'apps/web/.next-scale-validation');
  const buildId = await readFile(join(buildSource, 'BUILD_ID'), 'utf8');
  await cp(buildSource, join(web, '.next-scale-validation'), { recursive: true,
    filter: path => path !== join(buildSource, 'cache'),
  });
  if (buildId !== await readFile(join(buildSource, 'BUILD_ID'), 'utf8')) {
    throw new Error('The production Web build changed during staging; finish the build and launch again.');
  }
  for (const [directory, environment] of [[gateway, plan.gatewayEnvironment], [web, plan.webEnvironment]]) {
    const path = join(directory, directory === gateway ? '.env.gateway' : '.env');
    environment.DOTENV_CONFIG_PATH = path;
    const fixtureValues = Object.entries(environment).filter(([key]) => !['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'SystemRoot', 'WINDIR'].includes(key));
    // Values are app-generated fixture settings; no shell evaluates this file.
    await writeFile(path, fixtureValues.map(([key, value]) => `${key}='${value.replaceAll("'", '')}'`).join('\n') + '\n', { mode: 0o600 });
  }
  // The managed MCP intentionally does not receive DOTENV_CONFIG_PATH. Its
  // fallback .env contains only provider fixture settings, never callback keys.
  const mcpValues = Object.entries(plan.gatewayEnvironment).filter(([key]) =>
    key.startsWith('COMMERCE_PROVIDER_') || ['CODEX_HOME', 'NODE_ENV', 'COMMERCE_WEB_SEARCH_MODEL', 'COMMERCE_IMAGE_MODEL', 'COMMERCE_IMAGE_QUALITY', 'COMMERCE_AGENT_MODEL_SELECTORS'].includes(key));
  await writeFile(join(gateway, '.env'), mcpValues.map(([key, value]) => `${key}='${value.replaceAll("'", '')}'`).join('\n') + '\n', { mode: 0o600 });
  return { stage, gateway, web };
}

async function waitUntilReady(url, headers, check, children) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (children.some(({ child }) => child.exitCode !== null)) throw new Error('An isolated service exited before readiness; inspect its private local log.');
    try {
      const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(2000) });
      if (response.ok && await check(response)) return;
      await response.body?.cancel();
    } catch { /* Read-only readiness probe; never replay an execution. */ }
    await delay(500);
  }
  throw new Error('Isolated service readiness timed out; no load test was run.');
}

export async function startEnvironment(plan, { catalog = true } = {}) {
  await assertPrerequisites(plan);
  const staged = await stageApplications(plan);
  const children = [];
  let stopping = false;
  const launch = (name, args, cwd, env) => {
    const log = createWriteStream(join(staged.stage, `${name}.log`), { flags: 'wx', mode: 0o600 });
    const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.once('close', () => log.end());
    child.once('error', () => { process.exitCode = 1; void shutdown(); });
    child.once('exit', () => { if (!stopping) { process.exitCode = 1; void shutdown(); } });
    children.push({ name, child });
  };
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    for (const { child } of [...children].reverse()) {
      if (child.exitCode !== null || !child.pid) continue;
      if (process.platform === 'win32') {
        // Only trees rooted at this launcher's still-running children are stopped.
        const terminate = spawn(join(plan.baseEnvironment.SystemRoot, 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', env: plan.baseEnvironment });
        await new Promise(resolveStopped => { terminate.once('close', resolveStopped); terminate.once('error', resolveStopped); });
      } else child.kill('SIGTERM');
    }
    console.log(JSON.stringify({ stopped: true, ownedServices: children.length, logs: staged.stage }));
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void shutdown(); });
  try {
    if (catalog) launch('catalog', [join(root, 'scripts/load-test/catalog-stub.mjs')], staged.stage, {
      ...plan.baseEnvironment, SCALE_CATALOG_PORT: String(plan.ports.catalog),
    });
    const require = createRequire(join(root, 'apps/web/package.json'));
    launch('web', [require.resolve('next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(plan.ports.web)], staged.web, plan.webEnvironment);
    if (catalog) await waitUntilReady(`http://127.0.0.1:${plan.ports.catalog}/health`, {}, async response => (await response.json()).modelExecutionAvailable === false, children);
    await waitUntilReady(`http://127.0.0.1:${plan.ports.web}`, {}, async () => true, children);
    launch('gateway', [join(staged.gateway, 'dist/src/gateway/server.js')], staged.gateway, plan.gatewayEnvironment);
    await waitUntilReady(`http://127.0.0.1:${plan.ports.gateway}/health`, { 'x-commerce-gateway-token': INTERNAL_TEST_TOKEN }, async response => (await response.json()).managedMcp?.state === 'ready', children);
    console.log(JSON.stringify({ ready: true, ...plan.ports, tenantId: plan.tenantId, modelExecutionAvailable: !catalog,
      gatewayMode: 'development', webMode: 'production', productionIsolationCertified: false, logs: staged.stage }));
  } catch (error) { await shutdown(); throw error; }
}

async function main() {
  const command = process.argv[2] ?? 'review';
  if (!['review', 'start'].includes(command)) throw new Error('Usage: run-read-environment.mjs review|start');
  const state = JSON.parse(await readFile(join(fixtureDirectory, 'fixture-state.json'), 'utf8'));
  const plan = readEnvironmentPlan(state);
  if (command === 'review') {
    console.log(JSON.stringify({ operation: 'review-only', ports: plan.ports, database: plan.databaseName,
      tenantId: plan.tenantId, runtimeDirectory: plan.gatewayEnvironment.CODEX_HOME,
      callbacks: ['agent-events', 'agent-authorization', 'agent-admission'],
      startsModelTurns: false, defaultCommandStartsServices: false, modelExecutionAvailable: false }, null, 2));
  } else await startEnvironment(plan);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Read environment preparation/start failed. No load validation is implied; inspect the private local service logs and fixture prerequisites.'); process.exitCode = 1; });
}
