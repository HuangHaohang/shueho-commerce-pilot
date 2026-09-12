import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, relative, sep, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { makeSignature } from 'better-auth/crypto';
import { READ_FIXTURE_SECRET, validateScaleDatabase, validateScaleWeb } from './read-fixture-policy.mjs';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const fixtureRoot = resolve(repositoryRoot, '.runtime/scale-validation');

async function privateJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}

function uuidFor(value) {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function saveState(directory, state, secureCookies) {
  await privateJson(resolve(directory, 'fixture-state.json'), state);
  await privateJson(resolve(directory, 'users.json'), state.users.map(user => ({
    cookie: secureCookies ? user.secureCookie : user.cookie,
    ...(user.threadId ? { threadId: user.threadId } : {}),
  })));
}

async function prepare(database, directory, count, secret, secureCookies) {
  const key = createHash('sha256').update(database.name).digest('hex').slice(0, 12);
  let state;
  try { state = JSON.parse(await readFile(resolve(directory, 'fixture-state.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const secretHash = createHash('sha256').update(secret).digest('hex');
  if (state && (state.databaseName !== database.name || state.users.length !== count || state.secretHash !== secretHash)) {
    throw new Error('Existing private fixture receipt does not match the database, user count or test auth secret.');
  }
  if (!state) {
    const users = [];
    for (let index = 0; index < count; index += 1) {
      const token = randomBytes(32).toString('hex');
      const signed = encodeURIComponent(`${token}.${await makeSignature(token, secret)}`);
      users.push({ id: `scale-read-${key}-${index}`, sessionId: randomUUID(), token,
        cookie: `commerce_pilot.session_token=${signed}`, secureCookie: `__Secure-commerce_pilot.session_token=${signed}` });
    }
    state = { schemaVersion: 1, databaseName: database.name, secretHash,
      organizationId: uuidFor(`${key}:organization`), tenantId: uuidFor(`${key}:tenant`),
      workspaceId: uuidFor(`${key}:workspace`), roleId: uuidFor(`${key}:role`), users };
  }
  const pool = new Pool({ connectionString: database.url.toString(), max: 1, connectionTimeoutMillis: 5000 });
  const client = await pool.connect();
  try {
    const identity = await client.query('SELECT current_database() AS name');
    if (identity.rows[0]?.name !== database.name) throw new Error('Connected database does not match the validated disposable name.');
    const migration = await client.query("SELECT 1 FROM commerce_schema_migration WHERE version='20260911_052_image_session_scope_integrity'");
    if (!migration.rowCount) throw new Error('Apply registered Web migrations through 052 to the disposable database first.');
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('scale-read-fixture'))");
    const existing = await client.query('SELECT count(*)::int AS count FROM commerce_tenant WHERE id<>$1', [state.tenantId]);
    if (existing.rows[0].count !== 0) throw new Error('Disposable database contains an unrelated tenant; refusing fixture preparation.');
    await saveState(directory, state, secureCookies);
    for (const [index, user] of state.users.entries()) {
      await client.query('INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt") VALUES ($1,$2,$3,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT (id) DO NOTHING',
        [user.id, `Synthetic Reader ${index + 1}`, `${user.id}@example.test`]);
    }
    const owner = state.users[0].id;
    const slug = `scale-read-${key}`;
    await client.query("INSERT INTO commerce_organization (id,slug,name,status,created_by_user_id) VALUES ($1,$2,'Synthetic Read Capacity Fixture','active',$3) ON CONFLICT (id) DO NOTHING", [state.organizationId, slug, owner]);
    await client.query("INSERT INTO commerce_tenant (id,organization_id,slug,name,status,created_by_user_id) VALUES ($1,$2,$3,'Synthetic Read Capacity Fixture','active',$4) ON CONFLICT (id) DO NOTHING", [state.tenantId, state.organizationId, slug, owner]);
    await client.query("INSERT INTO commerce_workspace (id,tenant_id,slug,name,status,is_default,created_by_user_id) VALUES ($1,$2,'default','Synthetic Read Workspace','active',true,$3) ON CONFLICT (id) DO NOTHING", [state.workspaceId, state.tenantId, owner]);
    await client.query(`INSERT INTO commerce_enterprise_contract (tenant_id,status,seat_limit,workspace_limit,monthly_total_token_limit,monthly_model_request_limit,concurrent_turn_limit,concurrent_turn_limit_per_workspace,concurrent_turn_limit_per_user,token_reservation_per_turn,max_agent_threads_per_session)
      VALUES ($1,'active',$2,1,1000000,1000,25,25,1,50000,4) ON CONFLICT (tenant_id) DO NOTHING`, [state.tenantId, count]);
    await client.query("INSERT INTO commerce_tenant_runtime (tenant_id,isolation_mode,runtime_key,status) VALUES ($1,'dedicated',$2,'ready') ON CONFLICT (tenant_id) DO NOTHING", [state.tenantId, slug]);
    await client.query(`INSERT INTO commerce_enterprise_role (id,tenant_id,scope,role_key,name,allowed_permissions,is_system)
      VALUES ($1,$2,'workspace','scale_read_fixture','Synthetic read fixture',ARRAY['tenant.read','contract.read','workspaces.read','thread.create','thread.read.own','artifact.read','agent.run'],false)
      ON CONFLICT (id) DO NOTHING`, [state.roleId, state.tenantId]);
    for (const user of state.users) {
      await client.query("INSERT INTO commerce_tenant_membership (tenant_id,user_id,status,is_default,joined_at) VALUES ($1,$2,'active',true,CURRENT_TIMESTAMP) ON CONFLICT (tenant_id,user_id) DO NOTHING", [state.tenantId, user.id]);
      await client.query("INSERT INTO commerce_workspace_membership (tenant_id,workspace_id,user_id,status,is_default) VALUES ($1,$2,$3,'active',true) ON CONFLICT (tenant_id,workspace_id,user_id) DO NOTHING", [state.tenantId, state.workspaceId, user.id]);
      await client.query('INSERT INTO commerce_user_role_assignment (tenant_id,user_id,role_id,workspace_id,assigned_by_user_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [state.tenantId, user.id, state.roleId, state.workspaceId, owner]);
      await client.query('INSERT INTO "session" (id,token,"userId","expiresAt","createdAt","updatedAt") VALUES ($1,$2,$3,CURRENT_TIMESTAMP + interval \'12 hours\',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT (id) DO UPDATE SET "expiresAt"=EXCLUDED."expiresAt","updatedAt"=CURRENT_TIMESTAMP', [user.sessionId, user.token, user.id]);
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({ preparedUsers: count, tenantCount: 1, workspaceCount: 1, tenantId: state.tenantId, modelTurnsCreated: 0, fixtureDirectory: directory }));
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); await pool.end(); }
}

export function readSecureCookies(value) {
  if (value === undefined || value === '') return true;
  if (!['true', 'false'].includes(value)) throw new Error('SCALE_SECURE_COOKIES must be true or false.');
  return value === 'true';
}

export async function bindReadFixtures(state, { base, secureCookies = true, save, request = fetch, progress = () => {} }) {
  base = validateScaleWeb(base);
  if (state?.schemaVersion !== 1 || !Array.isArray(state.users) || !state.users.length ||
      state.users.some(user => !/^scale-read-[a-f0-9]{12}-\d+$/.test(user.id ?? '')) ||
      new Set(state.users.map(user => user.id)).size !== state.users.length) {
    throw new Error('A valid, distinct synthetic user fixture receipt is required.');
  }
  // Refresh users.json's selected cookie format even when every user was bound
  // earlier; a production Web always expects the __Secure- prefixed cookie.
  await save();
  let created = 0;
  for (const user of state.users) {
    if (user.bindUncertain) throw new Error('A previous empty-thread creation is uncertain; perform authenticated readback before another bind attempt.');
    const cookie = secureCookies ? user.secureCookie : user.cookie;
    const expectedPrefix = secureCookies ? '__Secure-commerce_pilot.session_token=' : 'commerce_pilot.session_token=';
    if (typeof cookie !== 'string' || !cookie.startsWith(expectedPrefix) || /[\r\n]/.test(cookie)) {
      throw new Error('The fixture session cookie does not match the selected Web authentication mode.');
    }
    const headers = { cookie, 'Content-Type': 'application/json', Origin: base };
    const session = await request(`${base}/api/account/session`, { headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000) });
    const authentication = await session.json().catch(() => null);
    if (session.status !== 200 || authentication?.user?.id !== user.id) throw new Error(`Fixture authentication failed with HTTP ${session.status}; no native thread was created.`);
    if (user.threadId) {
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(user.threadId)) throw new Error('Invalid previously bound Harness thread receipt.');
      const readback = await request(`${base}/api/agent/threads/${encodeURIComponent(user.threadId)}/status`, {
        headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000),
      });
      const stored = await readback.json().catch(() => null);
      if (!readback.ok || stored?.thread?.id !== user.threadId) {
        throw new Error(`Previously bound empty Harness thread is not available (HTTP ${readback.status}); preserve the receipt and reconcile the isolated runtime before preparing a fresh fixture.`);
      }
      continue;
    }
    user.bindUncertain = true;
    await save();
    const response = await request(`${base}/api/agent/threads`, { method: 'POST', headers, redirect: 'error',
      body: JSON.stringify({ model: 'gpt-5.6-luna', workflow: 'commerce-creative-project' }), signal: AbortSignal.timeout(60000) });
    const payload = await response.json().catch(() => null);
    const threadId = payload?.result?.thread?.id;
    if (!response.ok || typeof threadId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(threadId)) throw new Error(`Native empty-thread bind did not confirm success (HTTP ${response.status}); retained the uncertain receipt without retry.`);
    user.threadId = threadId;
    delete user.bindUncertain;
    created += 1;
    await save();
    if (created % 10 === 0) progress({ boundUsers: state.users.filter(candidate => candidate.threadId).length, modelTurnsCreated: 0 });
  }
  return { boundUsers: state.users.filter(user => user.threadId).length, newlyCreatedEmptyThreads: created, modelTurnsCreated: 0 };
}

async function bind(directory, secret, secureCookies) {
  const state = JSON.parse(await readFile(resolve(directory, 'fixture-state.json'), 'utf8'));
  if (state.secretHash !== createHash('sha256').update(secret).digest('hex')) throw new Error('Use the same fixture auth secret for prepare and bind.');
  const result = await bindReadFixtures(state, { base: process.env.SCALE_WEB_URL, secureCookies,
    save: () => saveState(directory, state, secureCookies), progress: value => console.log(JSON.stringify(value)),
  });
  console.log(JSON.stringify(result));
}

export async function main() {
  const mode = process.argv[2];
  if (!['prepare', 'bind'].includes(mode)) throw new Error('Usage: prepare-read-fixtures.mjs prepare|bind; configure only SCALE_* test inputs.');
  const count = Number(process.env.SCALE_USER_COUNT ?? 100);
  if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('SCALE_USER_COUNT must be between 1 and 1000.');
  const directory = resolve(process.env.SCALE_FIXTURE_DIR ?? fixtureRoot);
  const within = relative(fixtureRoot, directory);
  if (isAbsolute(within) || within.startsWith(`..${sep}`) || within === '..') throw new Error('Private fixture output must remain under .runtime/scale-validation.');
  const secret = process.env.SCALE_AUTH_SECRET ?? READ_FIXTURE_SECRET;
  if (!secret.startsWith('scale-') || secret.length < 32) throw new Error('Use a distinct scale-prefixed test auth secret of at least 32 characters.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const secureCookies = readSecureCookies(process.env.SCALE_SECURE_COOKIES);
  if (mode === 'prepare') await prepare(validateScaleDatabase(process.env.SCALE_DATABASE_URL), directory, count, secret, secureCookies);
  else await bind(directory, secret, secureCookies);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(JSON.stringify({ failed: true, code: error.code ?? error.name,
    reason: /password|credential|postgres(?:ql)?:\/\//i.test(error.message) ? 'Database connection or fixture configuration failed.' : error.message })); process.exitCode = 1; });
}
