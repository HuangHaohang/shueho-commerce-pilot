import assert from "node:assert/strict";
import test from "node:test";

import { readCommerceProviderConfig } from "./config.js";

test("production requires an explicit provider route instead of falling back to another host", () => {
  const previousEnvironment = process.env.NODE_ENV;
  const previousBaseUrl = process.env.COMMERCE_PROVIDER_BASE_URL;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.COMMERCE_PROVIDER_BASE_URL;
    assert.throws(() => readCommerceProviderConfig(), /COMMERCE_PROVIDER_BASE_URL is required/);

    process.env.COMMERCE_PROVIDER_BASE_URL = "http://host.docker.internal:8317/v1";
    const provider = readCommerceProviderConfig();
    assert.equal(provider.baseUrl, "http://host.docker.internal:8317/v1");
    assert.equal(provider.id, "luusmosh_cpa");
  } finally {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
    if (previousBaseUrl === undefined) delete process.env.COMMERCE_PROVIDER_BASE_URL;
    else process.env.COMMERCE_PROVIDER_BASE_URL = previousBaseUrl;
  }
});
