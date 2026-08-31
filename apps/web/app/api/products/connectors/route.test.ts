import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listProductConnectors: vi.fn(),
  requireAgentContext: vi.fn(),
}));

vi.mock("@/lib/agent/http", () => ({ requireAgentContext: mocks.requireAgentContext }));
vi.mock("@/lib/product-catalog/connector-repository", () => ({
  listProductConnectors: mocks.listProductConnectors,
}));

import { GET } from "./route";

describe("product connector catalog route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgentContext.mockResolvedValue({
      ok: true,
      context: {
        tenantId: "11111111-1111-4111-8111-111111111111",
        workspaceId: "22222222-2222-4222-8222-222222222222",
        userId: "user-1",
        permissions: new Set(["product_catalog.read", "product_catalog.sources.manage"]),
      },
    });
    mocks.listProductConnectors.mockResolvedValue([{
      key: "file_upload",
      version: "1.0.0",
      displayName: "CSV / JSON 文件",
      description: "导入文件",
      kind: "file_upload",
      adapterAvailability: "ready",
      availabilityReason: null,
      capabilities: { testConnection: false, sync: false },
      publicConfigFields: [],
      secretReference: { required: false, allowedSchemes: [] },
    }]);
  });

  it("returns application-owned connector definitions and management permission", async () => {
    const response = await GET(new Request("http://localhost/api/products/connectors"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.connectors[0]).toMatchObject({ key: "file_upload", adapterAvailability: "ready" });
    expect(body.permission).toEqual({ canManageSources: true });
  });
});
