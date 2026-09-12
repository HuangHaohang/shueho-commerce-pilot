import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { makeSignature } from "better-auth/crypto";
import { Pool } from "pg";

const AUTHORIZATION = "server244-company-load-and-image-comparison-2026-09-12";
const USER_COUNT = 100;
const PUBLIC_HOST = "commerce.shueho.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readProductionFixtureConfig(environment) {
  if (environment.PRODUCTION_LOAD_AUTHORIZATION !== AUTHORIZATION) {
    throw new Error("Explicit server244 production-load authorization is required.");
  }
  if (!UUID.test(environment.COMMERCE_RUNTIME_TENANT_ID ?? "")) {
    throw new Error("COMMERCE_RUNTIME_TENANT_ID must identify the dedicated production tenant.");
  }
  if (!environment.MIGRATION_DATABASE_URL || !environment.BETTER_AUTH_SECRET || environment.BETTER_AUTH_SECRET.length < 32) {
    throw new Error("The protected migration database and Better Auth job settings are required.");
  }
  const database = new URL(environment.MIGRATION_DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || decodeURIComponent(database.pathname.slice(1)) !== 'commerce_pilot') {
    throw new Error("Production load fixtures require the explicit Commerce Pilot owner database.");
  }
  const base = new URL(environment.PRODUCTION_LOAD_BASE_URL ?? `https://${PUBLIC_HOST}`);
  if (base.protocol !== "https:" || base.hostname !== PUBLIC_HOST || base.pathname !== "/" || base.search || base.hash || base.username || base.password) {
    throw new Error(`Production fixture BFF must be https://${PUBLIC_HOST}.`);
  }
  const outputDirectory = resolve(environment.PRODUCTION_LOAD_OUTPUT_DIR ?? "");
  if (!environment.PRODUCTION_LOAD_OUTPUT_DIR || !outputDirectory.includes("production-load")) {
    throw new Error("Use a dedicated protected production-load output directory.");
  }
  return {
    baseUrl: base.origin,
    databaseUrl: database.toString(),
    outputDirectory,
    statePath: resolve(outputDirectory, "fixture-state.json"),
    usersPath: resolve(outputDirectory, "users.json"),
    tenantId: environment.COMMERCE_RUNTIME_TENANT_ID,
    authSecret: environment.BETTER_AUTH_SECRET,
    agentModel: environment.PRODUCTION_LOAD_AGENT_MODEL?.trim() || "gpt-5.6-luna",
  };
}

async function atomicPrivateJson(path, value, replace = true) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
  if (!replace) {
    try {
      await writeFile(path, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
    } finally {
      await import("node:fs/promises").then(({ rm }) => rm(temporary, { force: true }));
    }
    return;
  }
  await rename(temporary, path);
}

async function saveState(config, state) {
  await atomicPrivateJson(config.statePath, state);
  await atomicPrivateJson(config.usersPath, state.users.map(({ cookie, threadId }) => ({ cookie, ...(threadId ? { threadId } : {}) })));
}

export async function prepareProductionFixtures(config) {
  await mkdir(config.outputDirectory, { recursive: true, mode: 0o700 });
  try {
    await readFile(config.statePath, "utf8");
    throw new Error("A production load fixture receipt already exists; resume or clean it instead of creating another.");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
  const runKey = randomUUID().replaceAll("-", "").slice(0, 12);
  const state = {
    schemaVersion: 1,
    authorization: AUTHORIZATION,
    runKey,
    tenantId: config.tenantId,
    workspaceId: randomUUID(),
    roleId: randomUUID(),
    createdAt: new Date().toISOString(),
    users: [],
  };
  for (let index = 0; index < USER_COUNT; index++) {
    const token = randomBytes(32).toString("hex");
    const signed = encodeURIComponent(`${token}.${await makeSignature(token, config.authSecret)}`);
    state.users.push({
      id: `production-load-${runKey}-${String(index).padStart(3, "0")}`,
      sessionId: randomUUID(),
      token,
      cookie: `__Secure-commerce_pilot.session_token=${signed}`,
      threadId: null,
      bindUncertain: false,
    });
  }

  const pool = new Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 5_000 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`production-load:${config.tenantId}`]);
    const identity = await client.query("SELECT current_database() AS database, current_user AS role");
    if (identity.rows[0]?.database !== "commerce_pilot" || identity.rows[0]?.role !== "commerce_pilot") {
      throw new Error("Production fixtures require the Commerce Pilot migration owner role.");
    }
    const capacity = await client.query(`
      SELECT contract.seat_limit, contract.workspace_limit,
        (SELECT count(*)::int FROM commerce_tenant_membership WHERE tenant_id=$1 AND status='active') AS members,
        (SELECT count(*)::int FROM commerce_workspace WHERE tenant_id=$1 AND status='active') AS workspaces
      FROM commerce_enterprise_contract contract
      JOIN commerce_tenant tenant ON tenant.id=contract.tenant_id
      WHERE contract.tenant_id=$1 AND contract.status='active' AND tenant.status='active'
      FOR UPDATE`, [config.tenantId]);
    const limits = capacity.rows[0];
    if (!limits || Number(limits.members) + USER_COUNT > Number(limits.seat_limit) || Number(limits.workspaces) + 1 > Number(limits.workspace_limit)) {
      throw new Error("The production contract has insufficient seat or workspace capacity for the isolated fixture.");
    }
    const collisions = await client.query(`SELECT
      (SELECT count(*)::int FROM "user" WHERE id LIKE $1) AS users,
      (SELECT count(*)::int FROM commerce_workspace WHERE tenant_id=$2 AND slug LIKE 'load-acceptance-%') AS workspaces`,
      [`production-load-${runKey}-%`, config.tenantId]);
    if (collisions.rows[0]?.users !== 0 || collisions.rows[0]?.workspaces !== 0) {
      throw new Error("An earlier production load fixture must be reconciled before creating another.");
    }
    await client.query(`INSERT INTO commerce_workspace
      (id,tenant_id,slug,name,status,is_default) VALUES ($1,$2,$3,$4,'active',false)`,
      [state.workspaceId, config.tenantId, `load-acceptance-${runKey}`, `Production Load Acceptance ${runKey}`]);
    await client.query(`INSERT INTO commerce_enterprise_role
      (id,tenant_id,scope,role_key,name,description,allowed_permissions,is_system)
      VALUES ($1,$2,'workspace',$3,'Production load operator','Synthetic production acceptance identity',
      ARRAY['tenant.read','contract.read','workspaces.read','thread.create','thread.read.own','thread.interrupt','thread.delete','queue.manage','artifact.read','agent.run'],false)`,
      [state.roleId, config.tenantId, `production_load_${runKey}`]);
    for (const [index, user] of state.users.entries()) {
      await client.query(`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt")
        VALUES ($1,$2,$3,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
        [user.id, `Synthetic Production Load ${index + 1}`, `${user.id}@example.test`]);
      await client.query(`INSERT INTO commerce_tenant_membership
        (tenant_id,user_id,status,seat_type,is_default,joined_at) VALUES ($1,$2,'active','enterprise',true,CURRENT_TIMESTAMP)`,
        [config.tenantId, user.id]);
      await client.query(`INSERT INTO commerce_workspace_membership
        (tenant_id,workspace_id,user_id,status,is_default) VALUES ($1,$2,$3,'active',true)`,
        [config.tenantId, state.workspaceId, user.id]);
      await client.query(`INSERT INTO commerce_user_role_assignment
        (tenant_id,user_id,role_id,workspace_id) VALUES ($1,$2,$3,$4)`,
        [config.tenantId, user.id, state.roleId, state.workspaceId]);
      await client.query(`INSERT INTO "session" (id,token,"userId","expiresAt","createdAt","updatedAt")
        VALUES ($1,$2,$3,CURRENT_TIMESTAMP + interval '12 hours',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
        [user.sessionId, user.token, user.id]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
  await atomicPrivateJson(config.statePath, state, false);
  await atomicPrivateJson(config.usersPath, state.users.map(({ cookie }) => ({ cookie })), false);
  return { preparedUsers: USER_COUNT, workspaceCreated: true, modelTurnsCreated: 0 };
}

export async function bindProductionFixtures(config, state, request = fetch) {
  validateState(config, state);
  let created = 0;
  for (const user of state.users) {
    if (user.bindUncertain) throw new Error("A prior thread creation is uncertain; preserve the receipt and stop.");
    const headers = { cookie: user.cookie, origin: config.baseUrl, "content-type": "application/json" };
    const session = await request(`${config.baseUrl}/api/account/session`, { headers, redirect: "error", signal: AbortSignal.timeout(30_000) });
    const identity = await session.json().catch(() => null);
    if (session.status !== 200 || identity?.user?.id !== user.id) throw new Error("Synthetic production session authentication failed.");
    if (user.threadId) continue;
    user.bindUncertain = true;
    await saveState(config, state);
    const response = await request(`${config.baseUrl}/api/agent/threads`, {
      method: "POST",
      headers,
      redirect: "error",
      body: JSON.stringify({ model: config.agentModel, workflow: "commerce-creative-project" }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => null);
    const threadId = payload?.result?.thread?.id;
    if (response.status !== 200 || typeof threadId !== "string") {
      throw new Error(`Native production thread creation is uncertain or failed with HTTP ${response.status}.`);
    }
    user.threadId = threadId;
    user.bindUncertain = false;
    created++;
    await saveState(config, state);
    if (created % 10 === 0) console.log(JSON.stringify({ boundUsers: created }));
  }
  return { boundUsers: state.users.filter((user) => user.threadId).length, newlyCreatedEmptyThreads: created };
}

export async function cleanupProductionFixtures(config, state, request = fetch) {
  validateState(config, state);
  for (const user of state.users.filter((candidate) => candidate.threadId)) {
    const headers = { cookie: user.cookie, origin: config.baseUrl, "content-type": "application/json" };
    const status = await request(`${config.baseUrl}/api/agent/threads/${encodeURIComponent(user.threadId)}/status`, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    const current = await status.json().catch(() => null);
    if (status.status !== 200 || current?.thread?.status === "running") {
      throw new Error("A production load thread is running or unreadable; cleanup stopped without deleting identities.");
    }
    const queued = await request(`${config.baseUrl}/api/agent/thread-deletions`, {
      method: "POST",
      headers,
      redirect: "error",
      body: JSON.stringify({ threadIds: [user.threadId] }),
      signal: AbortSignal.timeout(30_000),
    });
    const deletion = await queued.json().catch(() => null);
    if (queued.status !== 202 || typeof deletion?.job?.id !== "string") throw new Error("Thread cleanup was not durably queued.");
    const deadline = Date.now() + 120_000;
    let deletionCompleted = false;
    while (Date.now() < deadline) {
      const readback = await request(`${config.baseUrl}/api/agent/thread-deletions/${encodeURIComponent(deletion.job.id)}`, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      const job = await readback.json().catch(() => null);
      if (readback.status === 200 && job?.job?.status === "completed") {
        deletionCompleted = true;
        break;
      }
      if (readback.status !== 200 || ["partial", "failed"].includes(job?.job?.status)) throw new Error("Thread cleanup failed readback.");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
    }
    if (!deletionCompleted) throw new Error("Thread cleanup did not reach verified completion before the deadline.");
    user.threadId = null;
    await saveState(config, state);
  }
  const pool = new Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 5_000 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`production-load:${config.tenantId}`]);
    const remaining = await client.query("SELECT count(*)::int AS count FROM commerce_agent_thread WHERE tenant_id=$1 AND workspace_id=$2", [config.tenantId, state.workspaceId]);
    if (remaining.rows[0]?.count !== 0) throw new Error("Harness thread deletion readback is incomplete; fixture identities were retained.");
    const ids = state.users.map((user) => user.id);
    await client.query("DELETE FROM \"user\" WHERE id=ANY($1::text[])", [ids]);
    await client.query("DELETE FROM commerce_enterprise_role WHERE tenant_id=$1 AND id=$2", [config.tenantId, state.roleId]);
    await client.query("DELETE FROM commerce_workspace WHERE tenant_id=$1 AND id=$2", [config.tenantId, state.workspaceId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
  state.cleanedAt = new Date().toISOString();
  await saveState(config, state);
  return { deletedUsers: USER_COUNT, deletedThreads: USER_COUNT, cleanupVerified: true };
}

function validateState(config, state) {
  if (state?.schemaVersion !== 1 || state.authorization !== AUTHORIZATION || state.tenantId !== config.tenantId ||
      !UUID.test(state.workspaceId ?? "") || !UUID.test(state.roleId ?? "") || !Array.isArray(state.users) || state.users.length !== USER_COUNT ||
      new Set(state.users.map((user) => user.id)).size !== USER_COUNT || state.users.some((user) =>
        !user.id.startsWith(`production-load-${state.runKey}-`) || typeof user.cookie !== "string" || !user.cookie.startsWith("__Secure-commerce_pilot.session_token="))) {
    throw new Error("Production fixture receipt does not match the authorized tenant and run.");
  }
}

export async function main(mode = process.argv[2], environment = process.env) {
  if (!['prepare', 'bind', 'cleanup'].includes(mode)) throw new Error("Use production-load-fixtures.mjs prepare|bind|cleanup.");
  const config = readProductionFixtureConfig(environment);
  if (mode === "prepare") return prepareProductionFixtures(config);
  const state = JSON.parse(await readFile(config.statePath, "utf8"));
  return mode === "bind" ? bindProductionFixtures(config, state) : cleanupProductionFixtures(config, state);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((result) => console.log(JSON.stringify(result))).catch(() => {
    console.error(JSON.stringify({ failed: true, code: "PRODUCTION_LOAD_FIXTURE_FAILED" }));
    process.exitCode = 1;
  });
}
