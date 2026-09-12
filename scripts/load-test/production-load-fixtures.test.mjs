import assert from "node:assert/strict";
import test from "node:test";

import { readProductionFixtureConfig } from "./production-load-fixtures.mjs";

const valid = {
  PRODUCTION_LOAD_AUTHORIZATION: "server244-company-load-and-image-comparison-2026-09-12",
  COMMERCE_RUNTIME_TENANT_ID: "00000000-0000-4000-8000-000000000001",
  MIGRATION_DATABASE_URL: "postgresql://owner:secret@database:5432/commerce_pilot",
  BETTER_AUTH_SECRET: "fixture-auth-secret-at-least-32-characters",
  PRODUCTION_LOAD_BASE_URL: "https://commerce.shueho.com",
  PRODUCTION_LOAD_OUTPUT_DIR: "/tmp/production-load-receipts",
};

test("requires the exact authorized production tenant, database and public BFF", () => {
  const config = readProductionFixtureConfig(valid);
  assert.equal(config.tenantId, valid.COMMERCE_RUNTIME_TENANT_ID);
  assert.equal(config.baseUrl, "https://commerce.shueho.com");
  for (const changed of [
    { PRODUCTION_LOAD_AUTHORIZATION: "wrong" },
    { COMMERCE_RUNTIME_TENANT_ID: "not-a-uuid" },
    { MIGRATION_DATABASE_URL: "postgresql://owner:secret@database/other" },
    { PRODUCTION_LOAD_BASE_URL: "http://commerce.shueho.com" },
    { PRODUCTION_LOAD_BASE_URL: "https://example.com" },
    { PRODUCTION_LOAD_OUTPUT_DIR: "/tmp/general" },
  ]) assert.throws(() => readProductionFixtureConfig({ ...valid, ...changed }));
});
