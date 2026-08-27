import { describe, expect, it } from "vitest";

import { assertServiceAuditMetadataSafe } from "./audit.js";

describe("service audit metadata", () => {
  it("allows identifiers and aggregate counts", () => {
    expect(() => assertServiceAuditMetadataSafe({ endpointId: "taobao.search_item_list_v1", promoted: 8 })).not.toThrow();
  });

  it("rejects raw parameters, prompts, responses and credentials", () => {
    for (const metadata of [
      { token: "secret" },
      { requestParams: { keyword: "蘑菇勺" } },
      { prompt: "full user prompt" },
      { responsePayload: { code: 0 } },
    ]) {
      expect(() => assertServiceAuditMetadataSafe(metadata)).toThrow(/forbidden/);
    }
  });
});
