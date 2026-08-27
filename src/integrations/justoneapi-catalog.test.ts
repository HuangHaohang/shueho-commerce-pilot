import assert from "node:assert/strict";
import test from "node:test";

import { justOneApiEndpointIdentity } from "./justoneapi-catalog.js";

test("derives stable endpoint ids from official JustOneAPI REST paths", () => {
  assert.deepEqual(justOneApiEndpointIdentity("/api/search/v1"), {
    apiPath: "/api/search/v1",
    endpointId: "search.search_v1",
    platformId: "search",
    version: "v1",
  });
  assert.equal(
    justOneApiEndpointIdentity("/api/taobao/get-item-comment/v3").endpointId,
    "taobao.get_item_comment_v3",
  );
  assert.equal(
    justOneApiEndpointIdentity("/api/xiaohongshu-pgy/api/solar/kol/dataV2/costEffective/v1").endpointId,
    "xiaohongshu_pgy.api_solar_kol_data_v2_cost_effective_v1",
  );
  assert.equal(
    justOneApiEndpointIdentity("/api/xiaohongshu/ask-dots").endpointId,
    "xiaohongshu.ask_dots_v1",
  );
});

test("rejects malformed or unversioned API paths", () => {
  assert.throws(() => justOneApiEndpointIdentity("/search/v1"));
  assert.throws(() => justOneApiEndpointIdentity("/api/search/../v1"));
});
