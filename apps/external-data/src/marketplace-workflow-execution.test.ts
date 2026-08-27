import { describe, expect, it } from "vitest";

import { extractBindings } from "./marketplace-workflow-execution.js";

describe("marketplace workflow binding extraction", () => {
  it("extracts identifiers from one quality-selected product record", () => {
    expect(extractBindings({
      title: "轻量通勤双肩包",
      product: { skuId: "100012345", shopId: 88221 },
    }, [
      { name: "item_id", aliases: ["itemId", "skuId"], value_type: "string" },
      { name: "shop_id", aliases: ["shopId"], value_type: "integer" },
    ])).toEqual({ item_id: "100012345", shop_id: 88221 });
  });

  it("fails closed when any required identifier is absent or malformed", () => {
    expect(extractBindings({ itemId: "abc 123" }, [
      { name: "item_id", aliases: ["itemId"], value_type: "string" },
    ])).toBeNull();
    expect(extractBindings({ itemId: "123" }, [
      { name: "item_id", aliases: ["itemId"], value_type: "string" },
      { name: "shop_id", aliases: ["shopId"], value_type: "integer" },
    ])).toBeNull();
  });
});
