import { afterEach, describe, expect, it } from "vitest";

import {
  redactSecretReference,
  validateConnectorPublicConfig,
  validateSecretReference,
} from "@/lib/product-catalog/connector-validation";

describe("product connector validation", () => {
  afterEach(() => {
    delete process.env.COMMERCE_PRODUCT_SOURCE_TEST_DB;
  });

  it("accepts only the closed read-only database public config", () => {
    expect(validateConnectorPublicConfig("postgres_readonly_v1", { schema: "public", table: "products" }))
      .toEqual({ schema: "public", table: "products" });
    expect(() => validateConnectorPublicConfig("postgres_readonly_v1", {
      schema: "public",
      table: "products",
      host: "10.0.0.1",
    })).toThrowError(/禁止包含凭据或网络位置字段/);
    expect(() => validateConnectorPublicConfig("postgres_readonly_v1", {
      schema: "public",
      table: "products",
      password: "secret",
    })).toThrowError(/禁止包含凭据或网络位置字段/);
  });

  it("accepts only server-issued opaque handles", () => {
    const handle = "broker:psh_12345678901234567890123456789012";
    expect(validateSecretReference(handle, true)).toBe(handle);
    expect(() => validateSecretReference("env:COMMERCE_PRODUCT_SOURCE_ERP_A", true)).toThrow();
    expect(() => validateSecretReference("broker:tenant-catalog-source-1", true)).toThrow();
    expect(() => validateSecretReference("env:DATABASE_URL", true)).toThrow();
    expect(() => validateSecretReference("postgresql://user:pass@example.test/db", true)).toThrow();
  });

  it("never returns a complete secret reference to the browser", () => {
    expect(redactSecretReference("broker:psh_12345678901234567890123456789012")).toEqual({
      configured: true,
      scheme: "broker",
      displayHint: "安全连接已绑定",
    });
  });
});
