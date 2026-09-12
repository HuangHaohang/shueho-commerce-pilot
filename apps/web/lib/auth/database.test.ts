import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), createPool: vi.fn() }));

vi.mock("pg", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    Pool: class extends EventEmitter {
      query = mocks.query;
      constructor(options: unknown) {
        super();
        mocks.createPool(options);
      }
    },
  };
});

import { assertApplicationDatabaseRoleSecurity, getAuthDatabase } from "./database";

const databaseGlobal = globalThis as typeof globalThis & {
  commercePilotAuthPool?: unknown;
  commercePilotDatabaseSecurityCheck?: Promise<void>;
};
const safeRole = { rows: [{ current_user: "application", rolsuper: false, rolbypassrls: false }] };

describe("application database availability", () => {
  beforeEach(() => {
    delete databaseGlobal.commercePilotAuthPool;
    delete databaseGlobal.commercePilotDatabaseSecurityCheck;
    vi.clearAllMocks();
    mocks.query.mockReset().mockResolvedValue(safeRole);
    vi.stubEnv("DATABASE_URL", "postgresql://test:placeholder@127.0.0.1/disposable");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("COMMERCE_DATABASE_ROLE_MODE", "");
    vi.stubEnv("COMMERCE_DATABASE_POOL_MAX", "");
    vi.stubEnv("COMMERCE_DATABASE_CONNECT_TIMEOUT_MS", "");
  });

  afterEach(() => {
    delete databaseGlobal.commercePilotAuthPool;
    delete databaseGlobal.commercePilotDatabaseSecurityCheck;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("shares one bounded pool per process and honors deployment connection budgets", () => {
    vi.stubEnv("COMMERCE_DATABASE_POOL_MAX", "12");
    vi.stubEnv("COMMERCE_DATABASE_CONNECT_TIMEOUT_MS", "2000");
    const pool = getAuthDatabase();
    expect(getAuthDatabase()).toBe(pool);
    expect(mocks.createPool).toHaveBeenCalledOnce();
    expect(mocks.createPool).toHaveBeenCalledWith(expect.objectContaining({
      max: 12, connectionTimeoutMillis: 2_000, idleTimeoutMillis: 30_000,
    }));
  });

  it.each(["0", "101", "1.5", "Infinity", "invalid", "2e1"])("rejects invalid pool size %s", (value) => {
    vi.stubEnv("COMMERCE_DATABASE_POOL_MAX", value);
    expect(() => getAuthDatabase()).toThrow("COMMERCE_DATABASE_POOL_MAX must be an integer");
    expect(mocks.createPool).not.toHaveBeenCalled();
  });

  it("preserves the default production connection and wait limits", () => {
    getAuthDatabase();
    expect(mocks.createPool).toHaveBeenCalledWith(expect.objectContaining({ max: 20, connectionTimeoutMillis: 5_000 }));
  });

  it("rejects an unbounded acquisition timeout", () => {
    vi.stubEnv("COMMERCE_DATABASE_CONNECT_TIMEOUT_MS", "0");
    expect(() => getAuthDatabase()).toThrow("COMMERCE_DATABASE_CONNECT_TIMEOUT_MS must be an integer");
  });

  it("deduplicates concurrent security checks and allows recovery on a later request", async () => {
    const unavailable = new Error("database unavailable");
    mocks.query.mockRejectedValueOnce(unavailable);
    const first = assertApplicationDatabaseRoleSecurity();
    expect(assertApplicationDatabaseRoleSecurity()).toBe(first);
    await expect(first).rejects.toBe(unavailable);
    expect(mocks.query).toHaveBeenCalledOnce();
    await expect(assertApplicationDatabaseRoleSecurity()).resolves.toBeUndefined();
    await expect(assertApplicationDatabaseRoleSecurity()).resolves.toBeUndefined();
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it("continues to fail closed when a retry still has an unsafe application role", async () => {
    mocks.query.mockResolvedValue({ rows: [{ current_user: "unsafe", rolsuper: true, rolbypassrls: false }] });
    await expect(assertApplicationDatabaseRoleSecurity()).rejects.toThrow("superuser or BYPASSRLS");
    await expect(assertApplicationDatabaseRoleSecurity()).rejects.toThrow("superuser or BYPASSRLS");
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it("absorbs an idle connection failure without logging credentials and rechecks the replacement", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    await assertApplicationDatabaseRoleSecurity();
    const failure = new Error("password=must-not-appear user private data");
    expect(() => getAuthDatabase().emit("error", failure)).not.toThrow();
    expect(logger).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.mock.calls)).not.toContain(failure.message);
    await assertApplicationDatabaseRoleSecurity();
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.createPool).toHaveBeenCalledOnce();
  });
});
