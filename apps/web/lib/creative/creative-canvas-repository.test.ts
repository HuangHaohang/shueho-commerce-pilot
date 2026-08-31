import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CreativeCanvasSourceNode } from "./creative-canvas-types";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withEnterpriseDatabaseContext: vi.fn(),
}));

vi.mock("@/lib/enterprise/database-context", () => ({
  withEnterpriseDatabaseContext: mocks.withEnterpriseDatabaseContext,
}));

import { reconcileCreativeCanvasState } from "./creative-canvas-repository";

const scope = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  userId: "user-1",
};
const threadId = "thread-creative-long-project";

describe("creative canvas source reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let nodeCounter = 0;
    mocks.query.mockImplementation(async (sql: string) => {
      if (/INSERT INTO commerce_creative_canvas_node\s/.test(sql)) {
        nodeCounter += 1;
        return { rows: [{ id: `node-${nodeCounter}` }] };
      }
      return { rows: [] };
    });
    mocks.withEnterpriseDatabaseContext.mockImplementation(
      async (_scope: unknown, task: (client: { query: typeof mocks.query }) => Promise<unknown>) =>
        task({ query: mocks.query }),
    );
  });

  it("upserts every one of 241 loaded sources without silently truncating the newest assets", async () => {
    const sources = Array.from({ length: 241 }, (_, index) => sourceNode(index));

    await reconcileCreativeCanvasState(scope, threadId, sources, {
      sourceHistoryComplete: true,
    });

    const nodeInsertCalls = mocks.query.mock.calls.filter(([sql]) =>
      /INSERT INTO commerce_creative_canvas_node\s/.test(String(sql)));
    expect(nodeInsertCalls).toHaveLength(241);
    const deleteCall = findDeleteCall();
    expect(deleteCall).toBeDefined();
    const activeSourceKeys = deleteCall?.[1]?.[4] as string[] | undefined;
    expect(activeSourceKeys).toHaveLength(241);
    expect(activeSourceKeys?.at(-1)).toBe("agent_message\u001fmessage-241\u001fblock-241");
  });

  it("never deletes an absent projection while Harness history is incomplete", async () => {
    await reconcileCreativeCanvasState(scope, threadId, [sourceNode(0)], {
      sourceHistoryComplete: false,
    });

    expect(findDeleteCall()).toBeUndefined();
  });

  it("deletes obsolete unedited projections only after complete history and retains every user revision", async () => {
    await reconcileCreativeCanvasState(scope, threadId, [sourceNode(0)], {
      sourceHistoryComplete: true,
    });

    const deleteCall = findDeleteCall();
    expect(deleteCall).toBeDefined();
    expect(String(deleteCall?.[0])).toMatch(
      /DELETE FROM commerce_creative_canvas_node[\s\S]*NOT EXISTS[\s\S]*revision\.origin = 'user'/,
    );
    expect(deleteCall?.[1]).toEqual([
      scope.tenantId,
      scope.workspaceId,
      scope.userId,
      threadId,
      ["agent_message\u001fmessage-1\u001fblock-1"],
    ]);
  });
});

function findDeleteCall(): [string, unknown[]] | undefined {
  return mocks.query.mock.calls.find(([sql]) =>
    String(sql).includes("DELETE FROM commerce_creative_canvas_node")) as [string, unknown[]] | undefined;
}

function sourceNode(index: number): CreativeCanvasSourceNode {
  const ordinal = index + 1;
  return {
    sourceKind: "agent_message",
    sourceItemId: `message-${ordinal}`,
    sourceBlockKey: `block-${ordinal}`,
    sourceTurnId: `turn-${ordinal}`,
    sourceSequence: ordinal,
    messageItemId: null,
    nodeType: "document",
    deliverableType: "listing_copy",
    channel: "天猫",
    title: `商品文案 ${ordinal}`,
    content: {
      kind: "document",
      title: `商品文案 ${ordinal}`,
      body: `第 ${ordinal} 份完整文案`,
      callToAction: "立即查看",
      complianceNotes: [],
    },
    layout: {
      x: ordinal * 20,
      y: 0,
      width: 420,
      height: 320,
      zIndex: ordinal,
      locked: false,
    },
  };
}
