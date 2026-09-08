import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresJustOneApiAdmission } from "./justoneapi-admission.js";
import { defaultJustOneApiResilience } from "./justoneapi-retry-policy.js";

const githubTest = process.env.GITHUB_ACTIONS === "true" && process.env.NODE_ENV === "test";
const runtimeUrl = process.env.JUSTONEAPI_TEST_DATABASE_URL ?? (githubTest ? process.env.EXTERNAL_DATA_DATABASE_URL : undefined);
const ownerUrl = process.env.JUSTONEAPI_TEST_MIGRATION_DATABASE_URL ?? (githubTest ? process.env.EXTERNAL_DATA_MIGRATION_DATABASE_URL : undefined);
const runtime = new Pool({ connectionString: runtimeUrl, max: 20 });
const owner = new Pool({ connectionString: ownerUrl });
const options = { ...defaultJustOneApiResilience, maxConcurrent: 2, endpointMaxConcurrent: 1,
  minIntervalMs: 0, endpointMinIntervalMs: 0, throttleBaseMs: 1_000 };

describe.skipIf(!runtimeUrl || !ownerUrl)("shared PostgreSQL admission", () => {
  beforeEach(async () => {
    await owner.query("DELETE FROM justoneapi_admission_lease");
    await owner.query("DELETE FROM justoneapi_admission_bucket");
  });
  afterAll(async () => { await runtime.end(); await owner.end(); });

  it("enforces global and per-endpoint concurrency across independently constructed clients", async () => {
    const requests = Array.from({ length: 20 }, (_, i) => ({ id: randomUUID(), path: `/api/fixture_${i % 3}/v1` }));
    const results = await Promise.all(requests.map(async (request) => ({ ...request,
      result: await new PostgresJustOneApiAdmission(runtime, options).acquire(request.path, request.id, Date.now() + 60_000),
    })));
    const admitted = results.filter((row) => row.result.acquired);
    expect(admitted).toHaveLength(2);
    expect(new Set(admitted.map((row) => row.path)).size).toBe(2);
    const client = new PostgresJustOneApiAdmission(runtime, options);
    await client.release(admitted[0]!.id);
    expect((await client.acquire(admitted[0]!.path, randomUUID(), Date.now() + 60_000)).acquired).toBe(true);
  });

  it("persists endpoint cooldown across clients without blocking another endpoint", async () => {
    const first = new PostgresJustOneApiAdmission(runtime, options);
    const lease = randomUUID();
    await first.acquire("/api/limited/v1", lease, Date.now() + 60_000);
    expect(await first.feedback("/api/limited/v1", true, 40_000)).toBeGreaterThanOrEqual(39_000);
    await first.release(lease);
    const restarted = new PostgresJustOneApiAdmission(runtime, options);
    const limited = await restarted.acquire("/api/limited/v1", randomUUID(), Date.now() + 60_000);
    expect(limited).toMatchObject({ acquired: false, reason: "rate_limited" });
    expect(limited.waitMs).toBeGreaterThan(39_000);
    expect((await restarted.acquire("/api/other/v1", randomUUID(), Date.now() + 60_000)).acquired).toBe(true);
  });

  it("recovers expired process leases without modifying provider attempt history", async () => {
    await owner.query("INSERT INTO justoneapi_admission_lease(id,api_path,expires_at) VALUES ($1,'/api/limited/v1',now()-interval '1 second')", [randomUUID()]);
    const before = await owner.query("SELECT count(*)::int AS count FROM justoneapi_token_attempt");
    expect((await new PostgresJustOneApiAdmission(runtime, options).acquire("/api/limited/v1", randomUUID(), Date.now() + 60_000)).acquired).toBe(true);
    expect((await owner.query("SELECT count(*)::int AS count FROM justoneapi_admission_lease")).rows[0].count).toBe(1);
    // Other token-store tests may append their own attempts concurrently; none may disappear.
    expect((await owner.query("SELECT count(*)::int AS count FROM justoneapi_token_attempt")).rows[0].count).toBeGreaterThanOrEqual(before.rows[0].count);
  });

  it("paces starts even after an earlier request has completed", async () => {
    const client = new PostgresJustOneApiAdmission(runtime, { ...options, minIntervalMs: 2_000 });
    const lease = randomUUID();
    await client.acquire("/api/first/v1", lease, Date.now() + 60_000);
    await client.release(lease);
    expect(await client.acquire("/api/second/v1", randomUUID(), Date.now() + 60_000)).toMatchObject({ acquired: false, reason: "paced" });
  });
});
