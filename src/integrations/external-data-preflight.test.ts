import assert from "node:assert/strict";
import test from "node:test";

import { ExternalDataPreflightError, preflightExternalDataCall } from "./external-data-preflight.js";

test("returns normalized parameters before any reservation or dispatch", async () => {
  const service = {
    preflightEndpoint: async () => ({
      payload: {
        success: true,
        endpoint_id: "search.search_v1",
        platform: "search",
        normalized_params: { start: "2026-08-21 00:00:00", end: "2026-08-27 23:59:59" },
        request_sha256: "a".repeat(64),
      },
      resultBytes: 1,
      isError: false,
    }),
  };
  const result = await preflightExternalDataCall(service, "search.search_v1", { start: "2026-08-21", end: "2026-08-27" });
  assert.equal(result.platform, "search");
  assert.equal(result.normalizedParams.end, "2026-08-27 23:59:59");
});

test("marks invalid parameters as never dispatched", async () => {
  const service = {
    preflightEndpoint: async () => ({
      payload: { success: false, message: "invalid dates" },
      resultBytes: 1,
      isError: true,
    }),
  };
  await assert.rejects(
    () => preflightExternalDataCall(service, "search.search_v1", {}),
    (error: unknown) => error instanceof ExternalDataPreflightError && error.providerDispatched === false,
  );
});
