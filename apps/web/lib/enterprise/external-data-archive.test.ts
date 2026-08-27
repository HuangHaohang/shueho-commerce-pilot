import { describe, expect, it } from "vitest";

import {
  ExternalDataArchiveError,
  assertExternalDataArchiveRequestSafe,
} from "./external-data-archive";

describe("external data SQL archive request safety", () => {
  it("accepts complete business parameters without service credentials", () => {
    expect(() => assertExternalDataArchiveRequestSafe({
      endpoint_id: "search.search_v1",
      params: {
        keyword: "中东服装",
        source: "XIAOHONGSHU",
        start: "2026-08-20 00:00:00",
        end: "2026-08-26 23:59:59",
      },
    })).not.toThrow();
  });

  it("rejects credential-like fields at any nesting level", () => {
    expect(() => assertExternalDataArchiveRequestSafe({
      endpoint_id: "search.search_v1",
      params: { nested: { token: "must-not-persist" } },
    })).toThrowError(ExternalDataArchiveError);
  });
});
