import { describe, expect, it } from "vitest";

import {
  readRuntimeTenantPin,
  runtimeTenantAllows,
  RuntimeTenantConfigurationError,
} from "./runtime-tenant";

const tenantA = "11111111-1111-4111-8111-111111111111";
const tenantB = "22222222-2222-4222-8222-222222222222";

describe("Web/BFF runtime tenant pin", () => {
  it("requires a valid pin in production", () => {
    expect(() => readRuntimeTenantPin({ NODE_ENV: "production" })).toThrow(RuntimeTenantConfigurationError);
    expect(() => readRuntimeTenantPin({
      NODE_ENV: "production",
      COMMERCE_RUNTIME_TENANT_ID: "not-a-uuid",
    })).toThrow(RuntimeTenantConfigurationError);
  });

  it("allows an unpinned development process for explicit isolation tests", () => {
    expect(readRuntimeTenantPin({ NODE_ENV: "development" })).toBeNull();
    expect(runtimeTenantAllows(tenantA, { NODE_ENV: "development" })).toBe(true);
  });

  it("rejects a different tenant whenever a pin is configured", () => {
    const environment = { NODE_ENV: "development", COMMERCE_RUNTIME_TENANT_ID: tenantA };
    expect(runtimeTenantAllows(tenantA, environment)).toBe(true);
    expect(runtimeTenantAllows(tenantB, environment)).toBe(false);
  });
});
