import type { PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn(), options: {} as Record<string, unknown> }));
vi.mock("./config.js", () => ({ config: { databaseUrl: "postgresql://fixture:fixture@unused.invalid/fixture" } }));
vi.mock("pg", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    Pool: class extends EventEmitter {
      connect = mocks.connect;
      constructor(options: Record<string, unknown>) { super(); mocks.options = options; }
    },
  };
});

import { database, withScope } from "./database.js";

const scope = { tenantId: "tenant-fixture", workspaceId: "workspace-fixture" };
const client = { query: vi.fn(), release: vi.fn() };
beforeEach(() => {
  mocks.connect.mockReset().mockResolvedValue(client as unknown as PoolClient);
  client.query.mockReset().mockResolvedValue({ rows: [] });
  client.release.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("external warehouse database failure boundaries", () => {
  it("bounds connection waiting while preserving the fixed ten-client pool", () => {
    expect(mocks.options).toMatchObject({ max: 10, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000 });
  });

  it("absorbs idle disconnect events without exposing provider/SQL/error content", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => database.emit("error", new Error("secret-token tenant-sql raw-response"))).not.toThrow();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]).toEqual(["External data PostgreSQL pool lost an idle connection; it will be replaced."]);
  });

  it("establishes both transaction-local scopes before work and releases once after commit", async () => {
    const operation = vi.fn(async () => {
      expect(client.query.mock.calls).toEqual([
        ["BEGIN"],
        ["SELECT set_config('external_data.tenant_id', $1, true)", [scope.tenantId]],
        ["SELECT set_config('external_data.workspace_id', $1, true)", [scope.workspaceId]],
      ]);
      return "stored";
    });
    await expect(withScope(scope, operation)).resolves.toBe("stored");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls.at(-1)).toEqual(["COMMIT"]);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("propagates connect timeout without borrowing, retrying or executing paid work", async () => {
    const failure = new Error("connection wait timed out");
    mocks.connect.mockRejectedValueOnce(failure);
    const operation = vi.fn();
    await expect(withScope(scope, operation)).rejects.toBe(failure);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(operation).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
    expect(client.release).not.toHaveBeenCalled();
  });

  it("fails closed before the operation when workspace scope setup fails", async () => {
    const failure = new Error("scope setup failed");
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("workspace_id")) throw failure;
      return { rows: [] };
    });
    const operation = vi.fn();
    await expect(withScope(scope, operation)).rejects.toBe(failure);
    expect(operation).not.toHaveBeenCalled();
    expect(client.query.mock.calls.at(-1)).toEqual(["ROLLBACK"]);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("preserves the operation error and reuses only a successfully rolled-back client", async () => {
    const failure = new Error("raw persistence failed");
    const operation = vi.fn(async () => { throw failure; });
    await expect(withScope(scope, operation)).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls.at(-1)).toEqual(["ROLLBACK"]);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("destroys a connection after rollback fails without replacing the original failure", async () => {
    const failure = new Error("original operation failure");
    client.query.mockImplementation(async (sql: string) => {
      if (sql === "ROLLBACK") throw new Error("rollback disconnected");
      return { rows: [] };
    });
    const operation = vi.fn(async () => { throw failure; });
    await expect(withScope(scope, operation)).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("does not replay work or claim success after an uncertain commit", async () => {
    const failure = new Error("commit acknowledgement lost");
    client.query.mockImplementation(async (sql: string) => {
      if (sql === "COMMIT") throw failure;
      return { rows: [] };
    });
    const operation = vi.fn(async () => "provider-result-recorded");
    await expect(withScope(scope, operation)).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls.filter(([sql]) => sql === "COMMIT")).toHaveLength(1);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  });
});
