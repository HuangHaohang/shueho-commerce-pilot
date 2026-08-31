import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withEnterpriseDatabaseContext: vi.fn(),
}));

vi.mock("@/lib/enterprise/database-context", () => ({
  withEnterpriseDatabaseContext: mocks.withEnterpriseDatabaseContext,
}));

import { listBoundProductContextsByTurnIds } from "./repository";

const scope = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  userId: "user-1",
};

describe("bound Product context history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withEnterpriseDatabaseContext.mockImplementation(
      async (_scope: unknown, task: (client: { query: typeof mocks.query }) => Promise<unknown>) =>
        task({ query: mocks.query }),
    );
  });

  it("reads all requested Turns in one scoped exact-revision query", async () => {
    mocks.query.mockResolvedValue({
      rows: [{
        turn_id: "turn-history-1",
        ordinal: 0,
        id: "33333333-3333-4333-8333-333333333333",
        title: "发送时的极简双肩包",
        internal_product_key: "BAG-001",
        status: "active",
        variant_count: "2",
        source_name: "ERP 产品库",
        updated_at: new Date("2026-08-30T00:00:00.000Z"),
        primary_image_url: "https://assets.example.com/bag.png",
      }],
    });

    const result = await listBoundProductContextsByTurnIds(scope, {
      threadId: "thread-history-1",
      turnIds: ["turn-history-1", "turn-history-2", "turn-history-1"],
    });

    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /context_set\.tenant_id=\$1[\s\S]*context_set\.workspace_id=\$2[\s\S]*context_set\.user_id=\$3[\s\S]*context_set\.thread_id=\$4[\s\S]*revision\.id=item\.product_revision_id/,
      ),
      [
        scope.tenantId,
        scope.workspaceId,
        scope.userId,
        "thread-history-1",
        ["turn-history-1", "turn-history-2"],
      ],
    );
    expect(result.get("turn-history-1")).toEqual([{
      id: "33333333-3333-4333-8333-333333333333",
      title: "发送时的极简双肩包",
      spu: "BAG-001",
      status: "active",
      variantCount: 2,
      sourceName: "ERP 产品库",
      updatedAt: "2026-08-30T00:00:00.000Z",
      imageUrl: "https://assets.example.com/bag.png",
    }]);
  });

  it("rejects malformed Turn ids before opening a scoped database context", async () => {
    await expect(listBoundProductContextsByTurnIds(scope, {
      threadId: "thread-history-1",
      turnIds: ["../other-tenant"],
    })).rejects.toMatchObject({ code: "PRODUCT_CONTEXT_TURN_INVALID", status: 400 });
    expect(mocks.withEnterpriseDatabaseContext).not.toHaveBeenCalled();
  });
});
