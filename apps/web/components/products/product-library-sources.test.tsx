import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ProductConnector, ProductSource } from "@/lib/products/sources";

import { ConnectorSelection, ProductSourcesList } from "./product-library-workspace";

const connectors: ProductConnector[] = [
  {
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
  },
  {
    key: "postgres-readonly.v1",
    version: "1",
    displayName: "PostgreSQL 只读",
    description: "由运维预置只读数据库引用",
    kind: "database",
    adapterAvailability: "ready",
    availabilityReason: null,
    capabilities: { testConnection: true, sync: false },
    publicConfigFields: [{ key: "schema", label: "Schema", type: "text", required: true }],
    secretReference: { required: true, allowedSchemes: ["env", "broker"] },
  },
  ...(["rest_api", "erp", "pim"] as const).map((kind, index): ProductConnector => ({
    key: `${kind}.v1`,
    version: "1",
    displayName: ["托管 REST API", "ERP", "PIM"][index] ?? kind,
    description: "当前未配置服务端适配器",
    kind,
    adapterAvailability: "unavailable",
    availabilityReason: "需运维配置",
    capabilities: { testConnection: true, sync: false },
    publicConfigFields: [],
    secretReference: { required: true, allowedSchemes: ["broker"] },
  })),
];

function source(overrides: Partial<ProductSource>): ProductSource {
  return {
    id: "source-file",
    name: "运营文件导入",
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
    sync: { available: false, reason: "文件导入按批次执行" },
    updatedAt: "2026-08-30T10:00:00.000Z",
    ...overrides,
  };
}

describe("ConnectorSelection", () => {
  it("enables file import while fail-closing unavailable managed connectors", () => {
    const html = renderToStaticMarkup(<ConnectorSelection connectors={connectors} onSelect={vi.fn()} />);

    expect(html).toContain("文件上传");
    expect(html).toContain("托管 API");
    expect(html).toContain("只读数据库");
    expect(html).toContain("ERP / PIM");
    expect(html).toContain("立即上传");
    expect(html.match(/由管理员配置/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain("普通用户只选择已经授权的连接");
    expect(html).not.toContain("env 或 broker");
    expect(html.match(/disabled=""/g)?.length).toBe(4);
  });
});

describe("ProductSourcesList", () => {
  it("renders real source, adapter, sync, and connection-test states", () => {
    const sources: ProductSource[] = [
      source({}),
      source({
        id: "source-db",
        name: "只读商品库",
        connectorKey: "postgres-readonly.v1",
        kind: "database",
        status: "draft",
        connectionState: "unavailable",
        adapterAvailability: "requires_operator_configuration",
        secretReference: { configured: true, scheme: "env", displayHint: "env:…_CATALOG" },
        lastTest: { status: "unavailable", testedAt: "2026-08-30T10:01:00.000Z", code: "OPERATOR_CONFIG_REQUIRED", message: "密钥引用尚未挂载" },
        sync: { available: false, reason: "连接测试通过后才可配置同步" },
      }),
    ];
    const html = renderToStaticMarkup(
      <ProductSourcesList
        sources={sources}
        connectors={connectors}
        canManageSources
        testingSourceId={null}
        onTest={vi.fn()}
      />,
    );

    expect(html).toContain("运营文件导入");
    expect(html).toContain("只读商品库");
    expect(html).toContain("无需连接测试");
    expect(html).toContain("等待管理员配置");
    expect(html).toContain("凭据已由管理员安全配置");
    expect(html).not.toContain("env:…_CATALOG");
    expect(html).not.toContain("密钥引用尚未挂载");
    expect(html).toContain("连接测试通过后才可配置同步");
    expect(html).toContain("min-w-0");
  });
});
