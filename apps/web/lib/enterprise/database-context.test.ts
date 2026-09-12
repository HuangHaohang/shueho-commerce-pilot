import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ assertRole: vi.fn(), connect: vi.fn(), query: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/auth/database", () => ({
  assertApplicationDatabaseRoleSecurity: mocks.assertRole,
  getAuthDatabase: () => ({ connect: mocks.connect }),
}));

import { withEnterpriseDatabaseContext, withEnterpriseTenantDatabaseContext } from "./database-context";

const scope = { tenantId: "tenant-a", workspaceId: "workspace-a", userId: "user-a" };

describe("transaction-local enterprise context", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
    mocks.query.mockResolvedValue({ rows: [] });
  });

  it.each([
    [withEnterpriseDatabaseContext, "off"],
    [withEnterpriseTenantDatabaseContext, "on"],
  ] as const)("binds every scope field before business work in one database round trip", async (run, tenantWide) => {
    const result = await run(scope, async (client) => {
      expect(mocks.query).toHaveBeenCalledTimes(2);
      expect(mocks.query.mock.calls[0]).toEqual(["BEGIN"]);
      const [sql, parameters] = mocks.query.mock.calls[1];
      expect(sql.match(/set_config\(/g)).toHaveLength(4);
      expect(sql.match(/true\)/g)).toHaveLength(4);
      expect(parameters).toEqual([scope.tenantId, scope.workspaceId, scope.userId, tenantWide]);
      await client.query("SELECT owned_business_record");
      return "readback";
    });
    expect(result).toBe("readback");
    expect(mocks.query).toHaveBeenCalledTimes(4);
    expect(mocks.query.mock.calls[3]).toEqual(["COMMIT"]);
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("never acquires a client or runs business work when the role check fails", async () => {
    mocks.assertRole.mockRejectedValue(new Error("unsafe role"));
    const task = vi.fn();
    await expect(withEnterpriseDatabaseContext(scope, task)).rejects.toThrow("unsafe role");
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(task).not.toHaveBeenCalled();
  });

  it("rolls back a failed scope assignment before business work", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error("scope setup failed"));
    const task = vi.fn();
    await expect(withEnterpriseDatabaseContext(scope, task)).rejects.toThrow("scope setup failed");
    expect(task).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("discards a connection on rollback failure and preserves the original failure without retrying work", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql === "ROLLBACK") throw new Error("connection lost");
      return { rows: [] };
    });
    const original = new Error("business operation failed");
    const task = vi.fn().mockRejectedValue(original);
    await expect(withEnterpriseDatabaseContext(scope, task)).rejects.toBe(original);
    expect(task).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(mocks.query).not.toHaveBeenCalledWith("COMMIT");
  });

  it("binds a new scope on each borrow rather than retaining another tenant's scope", async () => {
    const second = { tenantId: "tenant-b", workspaceId: "workspace-b", userId: "user-b" };
    await withEnterpriseDatabaseContext(scope, async () => undefined);
    await withEnterpriseDatabaseContext(second, async () => undefined);
    const assignments = mocks.query.mock.calls.filter(([, values]) => Array.isArray(values));
    expect(assignments.map(([, values]) => values)).toEqual([
      [scope.tenantId, scope.workspaceId, scope.userId, "off"],
      [second.tenantId, second.workspaceId, second.userId, "off"],
    ]);
    expect(mocks.assertRole).toHaveBeenCalledTimes(2);
  });
});
