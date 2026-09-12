import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'dotenv';
import { readEnvironmentPlan, startEnvironment } from './run-read-environment.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixtureRoot = resolve(root, '.runtime/scale-validation');
export const LIVE_PROVIDER_FIELDS = Object.freeze([
  'COMMERCE_PROVIDER_ID', 'COMMERCE_PROVIDER_NAME', 'COMMERCE_PROVIDER_BASE_URL', 'COMMERCE_PROVIDER_API_KEY',
  'COMMERCE_IMAGE_MODEL', 'COMMERCE_WEB_SEARCH_MODEL', 'COMMERCE_TITLE_MODEL', 'COMMERCE_AGENT_MODEL_SELECTORS',
  'COMMERCE_PROVIDER_MODEL_CACHE_TTL_MS', 'COMMERCE_WEB_SEARCH_TIMEOUT_MS', 'COMMERCE_WEB_SEARCH_MAX_ATTEMPTS',
  'CODEX_DEFAULT_MODEL',
]);

export class LiveValidationError extends Error {
  constructor(code, status) { super(code); this.name = 'LiveValidationError'; this.code = code; this.status = status; }
}

export function parseLiveProviderFile(contents) {
  const parsed = parse(contents);
  const provider = Object.fromEntries(LIVE_PROVIDER_FIELDS.filter(key => parsed[key]?.trim())
    .map(key => [key, parsed[key].trim()]));
  if (!provider.COMMERCE_PROVIDER_API_KEY || !provider.COMMERCE_PROVIDER_BASE_URL ||
    /[\r\n]/.test(provider.COMMERCE_PROVIDER_API_KEY)) throw new LiveValidationError('PROVIDER_CONFIGURATION_REQUIRED');
  let base;
  try { base = new URL(provider.COMMERCE_PROVIDER_BASE_URL); } catch { throw new LiveValidationError('PROVIDER_URL_INVALID'); }
  if (base.username || base.password || base.search || base.hash ||
    (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)))) {
    throw new LiveValidationError('PROVIDER_URL_INVALID');
  }
  provider.COMMERCE_PROVIDER_BASE_URL = base.toString().replace(/\/$/, '');
  provider.COMMERCE_PROVIDER_ID ??= 'scale_live_provider';
  provider.COMMERCE_PROVIDER_NAME ??= 'Isolated live provider validation';
  provider.CODEX_DEFAULT_MODEL ??= 'gpt-5.6-luna';
  provider.COMMERCE_AGENT_MODEL_SELECTORS ??= provider.CODEX_DEFAULT_MODEL;
  provider.COMMERCE_WEB_SEARCH_MODEL ??= provider.CODEX_DEFAULT_MODEL;
  provider.COMMERCE_TITLE_MODEL ??= provider.CODEX_DEFAULT_MODEL;
  provider.COMMERCE_IMAGE_MODEL ??= 'gpt-image-2';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(provider.COMMERCE_PROVIDER_ID) ||
      !/^[A-Za-z0-9._:/-]{1,128}$/.test(provider.CODEX_DEFAULT_MODEL)) {
    throw new LiveValidationError('PROVIDER_CONFIGURATION_INVALID');
  }
  return provider;
}

export async function preflightLiveProvider(provider, request = fetch) {
  // Discovery is the only upstream operation before readiness: redirects and any
  // authentication failure stop here. No response body/error text enters logs.
  let response;
  try {
    response = await request(`${provider.COMMERCE_PROVIDER_BASE_URL}/models`, {
      method: 'GET', redirect: 'error', cache: 'no-store',
      headers: { Authorization: `Bearer ${provider.COMMERCE_PROVIDER_API_KEY}` }, signal: AbortSignal.timeout(15000),
    });
  } catch { throw new LiveValidationError('PROVIDER_DISCOVERY_UNAVAILABLE'); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new LiveValidationError([401, 403].includes(response.status) ? 'PROVIDER_AUTH_REJECTED' : 'PROVIDER_DISCOVERY_REJECTED', response.status);
  }
  let catalog;
  try { catalog = await response.json(); } catch { throw new LiveValidationError('PROVIDER_CATALOG_INVALID'); }
  const models = Array.isArray(catalog?.data) ? catalog.data.filter(item => typeof item?.id === 'string') : [];
  if (!models.some(item => item.id === provider.CODEX_DEFAULT_MODEL)) throw new LiveValidationError('PROVIDER_MODEL_UNAVAILABLE');
  return { authenticated: true, modelCount: models.length, selectedModel: provider.CODEX_DEFAULT_MODEL, modelTurnsCreated: 0 };
}

export function readLiveEnvironmentPlan(state, provider, parentEnvironment = {}) {
  const plan = readEnvironmentPlan(state, parentEnvironment);
  const directory = resolve(parentEnvironment.SCALE_LIVE_FIXTURE_DIR ?? join(fixtureRoot, 'live-validation'));
  const within = relative(fixtureRoot, directory);
  if (!within || isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`)) {
    throw new LiveValidationError('LIVE_FIXTURE_DIRECTORY_INVALID');
  }
  plan.fixtureDirectory = directory;
  plan.ports = { web: 3200, gateway: 8897 };
  const home = join(directory, 'process-home');
  Object.assign(plan.baseEnvironment, { HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData/Roaming'),
    LOCALAPPDATA: join(home, 'AppData/Local'), TEMP: join(home, 'tmp'), TMP: join(home, 'tmp') });
  plan.gatewayEnvironment = { ...plan.gatewayEnvironment, ...plan.baseEnvironment, ...provider,
    CODEX_HOME: join(directory, 'codex'), CODEX_DEFAULT_MODEL_PROVIDER: provider.COMMERCE_PROVIDER_ID,
    COMMERCE_AGENT_PORT: '8897',
    COMMERCE_AGENT_EVENT_SINK_URL: 'http://127.0.0.1:3200/api/internal/agent-events',
    COMMERCE_AGENT_AUTHORIZATION_URL: 'http://127.0.0.1:3200/api/internal/agent-authorization',
    COMMERCE_AGENT_ADMISSION_URL: 'http://127.0.0.1:3200/api/internal/agent-admission',
    COMMERCE_PRODUCT_CATALOG_CONTROL_URL: 'http://127.0.0.1:3200/api/internal/product-catalog',
    EXTERNAL_DATA_SERVICE_MCP_URL: 'http://127.0.0.1:8897/disabled-external-data', EXTERNAL_DATA_SERVICE_MCP_TOKEN: '',
  };
  plan.webEnvironment = { ...plan.webEnvironment, ...plan.baseEnvironment,
    BETTER_AUTH_URL: 'http://127.0.0.1:3200', AUTH_TRUSTED_ORIGINS: 'http://127.0.0.1:3200,http://localhost:3200',
    COMMERCE_GATEWAY_URL: 'http://127.0.0.1:8897' };
  return plan;
}

export function createLiveFixtureState(source, provider) {
  return { ...source, runtimePurpose: 'live-provider-validation',
    providerScopeHash: createHash('sha256').update(`${provider.COMMERCE_PROVIDER_ID}\n${provider.COMMERCE_PROVIDER_BASE_URL}`).digest('hex'),
    users: source.users.map(({ id, sessionId, token, cookie, secureCookie }) => ({ id, sessionId, token, cookie, secureCookie })) };
}

async function privateJson(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 });
  await rename(temporary, path);
}

async function prepareLiveReceipt(source, provider, plan) {
  await mkdir(plan.fixtureDirectory, { recursive: true, mode: 0o700 });
  const proposed = createLiveFixtureState(source, provider);
  const statePath = join(plan.fixtureDirectory, 'fixture-state.json');
  let existing;
  try { existing = JSON.parse(await readFile(statePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new LiveValidationError('LIVE_FIXTURE_RECEIPT_INVALID'); }
  if (existing) {
    if (existing.runtimePurpose !== proposed.runtimePurpose || existing.tenantId !== proposed.tenantId ||
      existing.secretHash !== proposed.secretHash || existing.providerScopeHash !== proposed.providerScopeHash) {
      throw new LiveValidationError('LIVE_FIXTURE_SCOPE_MISMATCH');
    }
    // Preserve existing dispatch/bind evidence. The bind command rechecks native
    // thread availability; it never assumes empty threads survived a restart.
    return;
  }
  await privateJson(statePath, proposed);
  await privateJson(join(plan.fixtureDirectory, 'users.json'), proposed.users.map(user => ({ cookie: user.secureCookie })));
}

export async function main(environment = process.env, args = process.argv.slice(2)) {
  const command = args[0] ?? 'review';
  if (!['review', 'preflight', 'start'].includes(command)) throw new LiveValidationError('LIVE_COMMAND_INVALID');
  if (!environment.SCALE_PROVIDER_ENV_FILE?.trim()) throw new LiveValidationError('EXPLICIT_PROVIDER_FILE_REQUIRED');
  // Read precisely the operator-selected file. Never load dotenv/config, search
  // developer homes or inherit provider credentials from the parent environment.
  const provider = parseLiveProviderFile(await readFile(resolve(environment.SCALE_PROVIDER_ENV_FILE), 'utf8'));
  const source = JSON.parse(await readFile(join(fixtureRoot, 'fixture-state.json'), 'utf8'));
  const plan = readLiveEnvironmentPlan(source, provider, environment);
  const summary = { ports: plan.ports, fixtureDirectory: plan.fixtureDirectory, selectedModel: provider.CODEX_DEFAULT_MODEL,
    modelTurnsCreated: 0, newDedicatedThreadsRequired: true, productionIsolationCertified: false };
  if (command === 'review') { console.log(JSON.stringify({ operation: 'review-only', ...summary })); return; }
  const discovery = await preflightLiveProvider(provider);
  if (command === 'preflight') { console.log(JSON.stringify({ operation: 'provider-discovery-only', ...summary, ...discovery })); return; }
  await prepareLiveReceipt(source, provider, plan);
  console.log(JSON.stringify({ operation: 'live-environment-start', ...summary, ...discovery }));
  await startEnvironment(plan, { catalog: false });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(JSON.stringify({ failed: true, code: error instanceof LiveValidationError ? error.code : 'LIVE_PREPARATION_FAILED',
      ...(error instanceof LiveValidationError && error.status ? { status: error.status } : {}), modelTurnsCreated: 0 }));
    process.exitCode = 1;
  });
}
