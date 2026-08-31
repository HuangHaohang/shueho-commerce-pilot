import { afterEach, describe, expect, it, vi } from "vitest";

import { createProductSource, getProductConnectors, testProductSource } from "./sources";

afterEach(() => {
  vi.unstubAllGlobals();
});

const source = {
  id: "source-1",
  name: "文件导入",
  connectorKey: "file.v1",
  connectorVersion: "1",
  kind: "file_upload",
  status: "active",
  connectionState: "ready",
  adapterAvailability: "ready",
  publicConfig: {},
  secretReference: { configured: false, scheme: null, displayHint: null },
  lastTest: null,
  lastSync: null,
  sync: { available: false, reason: "按批次导入" },
  updatedAt: "2026-08-30T10:00:00.000Z",
};

describe("product source client", () => {
  it("reads closed connector definitions and availability from the server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      connectors: [{
        key: "file.v1",
        version: "1",
        displayName: "文件导入",
        description: "上传 CSV 或 JSON",
        kind: "file_upload",
        adapterAvailability: "ready",
        availabilityReason: null,
        capabilities: { testConnection: false, sync: false },
        publicConfigFields: [],
        secretReference: { required: false, allowedSchemes: [] },
      }],
      permission: { canManageSources: true },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const result = await getProductConnectors();
    expect(result.connectors[0]).toMatchObject({ kind: "file_upload", adapterAvailability: "ready" });
  });

  it("creates a source with references and public config only", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ source }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await createProductSource({
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      name: "只读商品库",
      connectorKey: "postgres-readonly.v1",
      connectorVersion: "1.0.0",
      publicConfig: { schema: "commerce", timeoutSeconds: 10 },
      secretReference: "broker:psh_12345678901234567890123456789012",
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      name: "只读商品库",
      connectorKey: "postgres-readonly.v1",
      connectorVersion: "1.0.0",
      publicConfig: { schema: "commerce", timeoutSeconds: 10 },
      secretReference: "broker:psh_12345678901234567890123456789012",
    });
    expect(String(request.body)).not.toMatch(/password|token|connectionString/i);
  });

  it("returns the server's read-only connection proof", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      test: {
        id: "test-1",
        status: "succeeded",
        testedAt: "2026-08-30T10:05:00.000Z",
        code: "READ_ONLY_OK",
        message: "只读测试通过",
        proof: { readOnly: true, selectAllowed: true, writePrivileges: false },
      },
      source: { ...source, kind: "database", connectionState: "ready" },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const result = await testProductSource("source-1", "22222222-2222-4222-8222-222222222222");
    expect(result.test.proof).toEqual({ readOnly: true, selectAllowed: true, writePrivileges: false });
  });

  it("rejects raw or non-conforming secret material before network dispatch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createProductSource({
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      name: "Unsafe source",
      connectorKey: "postgres_readonly",
      connectorVersion: "1.0.0",
      publicConfig: { schema: "public", table: "products" },
      secretReference: "postgresql://user:password@example.com/catalog",
    })).rejects.toMatchObject({ code: "PRODUCT_SOURCE_REQUEST_INVALID" });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
