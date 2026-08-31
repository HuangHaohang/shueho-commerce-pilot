import { afterEach, describe, expect, it } from "vitest";

import {
  connectorRuntimeAvailability,
  testProductConnector,
} from "@/lib/product-catalog/connector-adapters";

describe("product connector adapters", () => {
  afterEach(() => {
    delete process.env.COMMERCE_PRODUCT_SOURCE_TEST_DB;
  });

  it("reports database sources without a scope-resolved secret as requiring operator configuration", () => {
    expect(connectorRuntimeAvailability("postgres_readonly_v1", false))
      .toMatchObject({ availability: "requires_operator_configuration", testConnection: true, sync: false });
    expect(connectorRuntimeAvailability("postgres_readonly_v1", true))
      .toMatchObject({ availability: "ready" });
  });

  it("returns unavailable for unconfigured REST/ERP/PIM instead of claiming success", async () => {
    await expect(testProductConnector({
      adapterKey: "managed_erp_v1",
      resolvedSecret: "operator-owned-secret",
      publicConfig: { systemProfile: "erp_a", entity: "products" },
    })).resolves.toMatchObject({ status: "unavailable", code: "CONNECTOR_ADAPTER_NOT_CONFIGURED" });
  });

  it("rejects a non-loopback database secret without required TLS before network access", async () => {
    await expect(testProductConnector({
      adapterKey: "postgres_readonly_v1",
      resolvedSecret: "postgresql://reader:password@db.example.test/catalog",
      publicConfig: { schema: "public", table: "products" },
    })).resolves.toMatchObject({ status: "failed", code: "DATABASE_SECRET_INVALID" });

    await expect(testProductConnector({
      adapterKey: "postgres_readonly_v1",
      resolvedSecret: "postgresql://reader:password@db.example.test/catalog?sslmode=disable",
      publicConfig: { schema: "public", table: "products" },
    })).resolves.toMatchObject({ status: "failed", code: "DATABASE_SECRET_INVALID" });
  });

  it("does not treat file upload as a network connection test", async () => {
    await expect(testProductConnector({
      adapterKey: "file_upload_v1",
      resolvedSecret: null,
      publicConfig: {},
    })).resolves.toMatchObject({ status: "unavailable", code: "CONNECTION_TEST_NOT_REQUIRED" });
  });
});
