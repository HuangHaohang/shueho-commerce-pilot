import { describe, expect, it } from "vitest";

import {
  CURRENT_AGENT_TOOL_CONTRACT_VERSION,
  isSupportedAgentToolContractVersion,
} from "./thread-ownership";

describe("agent dynamic tool contract", () => {
  it("accepts only the semantic-scope-aware contract", () => {
    expect(CURRENT_AGENT_TOOL_CONTRACT_VERSION).toBe(12);
    expect(isSupportedAgentToolContractVersion(12)).toBe(true);
    expect(isSupportedAgentToolContractVersion(11)).toBe(false);
  });
});
