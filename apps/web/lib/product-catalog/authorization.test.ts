import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withEnterpriseDatabaseContext: vi.fn(),
}));

vi.mock("@/lib/enterprise/database-context", () => ({
  withEnterpriseDatabaseContext: mocks.withEnterpriseDatabaseContext,
}));

import {
  authorizeProductCatalogAction,
  recordProductCatalogApprovalEvidence,
} from "./authorization";

const scope = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  userId: "user-1",
  rootThreadId: "thread-product-1",
};

describe("product catalog live authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withEnterpriseDatabaseContext.mockImplementation(
      async (_scope: unknown, task: (client: { query: typeof mocks.query }) => Promise<unknown>) =>
        task({ query: mocks.query }),
    );
  });

  it("passes the exact product permission and bound Harness thread to the deny-precedence query", async () => {
    mocks.query.mockResolvedValue({ rows: [{ authorized: true }] });
    await expect(authorizeProductCatalogAction(scope, "product_catalog.import")).resolves.toBe(true);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringMatching(/tenant\.status = 'active'[\s\S]*NOT permission_state\.denied/),
      [scope.tenantId, scope.workspaceId, scope.userId, "product_catalog.import", scope.rootThreadId],
    );
  });

  it("fails closed when no authorized principal row is returned", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await expect(authorizeProductCatalogAction(scope, "product_catalog.read")).resolves.toBe(false);
  });

  it("records bounded approval evidence without product payloads", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await recordProductCatalogApprovalEvidence(scope, {
      importId: "33333333-3333-4333-8333-333333333333",
      mappingRevisionId: "44444444-4444-4444-8444-444444444444",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
      approvalRequestId: "product_call-12345678",
      approvalItemId: "call_12345678",
      turnId: "turn_12345678",
      approvedAt: "2026-08-30T10:00:00.000Z",
    });
    const call = mocks.query.mock.calls[0];
    expect(call?.[0]).toContain("product_catalog.import.approval");
    expect(String(call?.[1]?.[4])).toContain("product_call-12345678");
    expect(String(call?.[1]?.[4])).not.toContain("raw_payload");
  });
});
