import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertApplicationDatabaseRoleSecurity: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("@/lib/auth/database", () => ({
  assertApplicationDatabaseRoleSecurity: mocks.assertApplicationDatabaseRoleSecurity,
  getAuthDatabase: () => ({ connect: mocks.connect }),
}));

vi.mock("@/lib/enterprise/database-context", () => ({
  withEnterpriseDatabaseContext: vi.fn(),
}));

import { claimNextThreadDeletionJob } from "./thread-deletion-jobs";

describe("tenant-pinned thread deletion claims", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an absent or malformed tenant pin before opening the database", async () => {
    await expect(claimNextThreadDeletionJob("")).rejects.toThrow("tenant pin");
    await expect(claimNextThreadDeletionJob(null as unknown as string)).rejects.toThrow("tenant pin");
    await expect(claimNextThreadDeletionJob("not-a-tenant")).rejects.toThrow("tenant pin");
    expect(mocks.assertApplicationDatabaseRoleSecurity).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("sets a transaction-local tenant scope before invoking the claim function", async () => {
    const tenantId = "11111111-1111-4111-8111-111111111111";
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: "22222222-2222-4222-8222-222222222222",
          tenant_id: tenantId,
          workspace_id: "33333333-3333-4333-8333-333333333333",
          user_id: "user-1",
        }],
      })
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    mocks.connect.mockResolvedValue({ query, release });

    await expect(claimNextThreadDeletionJob(tenantId)).resolves.toEqual({
      id: "22222222-2222-4222-8222-222222222222",
      tenantId,
      workspaceId: "33333333-3333-4333-8333-333333333333",
      userId: "user-1",
    });

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      "SELECT set_config('commerce.tenant_id', $1, true)",
      "SELECT set_config('commerce.tenant_wide', 'on', true)",
      "SELECT * FROM commerce_claim_thread_deletion_job($1::uuid)",
      "COMMIT",
    ]);
    expect(release).toHaveBeenCalledOnce();
  });
});
