import { describe, expect, it } from "vitest";

import {
  CURRENT_AGENT_TOOL_CONTRACT_VERSION,
  isSupportedAgentToolContractVersion,
} from "./thread-ownership";

describe("agent dynamic tool contract", () => {
  it("accepts only the product-catalog-aware contract", () => {
    expect(CURRENT_AGENT_TOOL_CONTRACT_VERSION).toBe(6);
    expect(isSupportedAgentToolContractVersion(6)).toBe(true);
    expect(isSupportedAgentToolContractVersion(5)).toBe(false);
  });
});
