import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNativeHarnessRetryHistoryRequest,
  isHarnessMessageItemId,
  readHarnessRetryContract,
} from "./harness-turn-retry.js";

test("accepts short Harness Item ids without weakening thread id validation", () => {
  assert.equal(isHarnessMessageItemId("item-8"), true);
  assert.equal(isHarnessMessageItemId("agent-final-1"), true);
  assert.equal(isHarnessMessageItemId("item/8"), false);
  assert.equal(isHarnessMessageItemId(""), false);
});

test("uses the native Harness history operation supported by each history mode", () => {
  assert.deepEqual(buildNativeHarnessRetryHistoryRequest({
    historyMode: "paginated",
    threadId: "thread-retry-1234",
    sourceTurnId: "turn-source-1234",
    revertedTurnCount: 3,
  }), {
    method: "thread/revert",
    params: { threadId: "thread-retry-1234", beforeTurnId: "turn-source-1234" },
  });
  assert.deepEqual(buildNativeHarnessRetryHistoryRequest({
    historyMode: "legacy",
    threadId: "thread-retry-1234",
    sourceTurnId: "turn-source-1234",
    revertedTurnCount: 3,
  }), {
    method: "thread/rollback",
    params: { threadId: "thread-retry-1234", numTurns: 3 },
  });
});

test("recovers the managed creative method and selected product mode from authoritative UserInput", () => {
  assert.deepEqual(readHarnessRetryContract([
      { type: "text", text: "生成商品主图" },
      { type: "skill", name: "commerce-creative-project", path: "/managed/base" },
      { type: "skill", name: "commerce-product-main-image", path: "/managed/method" },
      { type: "text", text: "<commerce_product_context>\nmode=selected; selected_count=1\n</commerce_product_context>" },
      { type: "localImage", path: "/tenant-artifacts/content.jpg" },
    ]), {
      workflow: "commerce-creative-project",
      creativeMethod: "main_image",
      insightMethod: null,
      explicitSkillName: null,
      productContextMode: "selected",
  });
});

test("recovers product-insight specialist identity without treating it as an explicit Skill", () => {
  assert.deepEqual(readHarnessRetryContract([
      { type: "skill", name: "commerce-product-insight", path: "/managed/base" },
      { type: "skill", name: "commerce-product-retrospective", path: "/managed/method" },
      { type: "text", text: "<commerce_product_context>\nmode=auto\n</commerce_product_context>" },
    ]), {
      workflow: "commerce-product-insight",
      creativeMethod: null,
      insightMethod: "product_retrospective",
      explicitSkillName: null,
      productContextMode: "auto",
  });
});

test("preserves an ordinary explicit Skill and defaults to no product context", () => {
  assert.deepEqual(readHarnessRetryContract([
      { type: "text", text: "$inventory-audit 检查库存" },
      { type: "skill", name: "inventory-audit", path: "/approved/skill" },
    ]), {
      workflow: null,
      creativeMethod: null,
      insightMethod: null,
      explicitSkillName: "inventory-audit",
      productContextMode: "none",
  });
});
