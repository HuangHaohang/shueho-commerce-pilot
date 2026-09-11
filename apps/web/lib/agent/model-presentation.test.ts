import { describe, it, expect } from "vitest";
import { supportsReasoningControl, formatModelName } from "./model-presentation";

describe("model controls", () => {
  it("keeps reasoning enabled for Astra and Luna without sending it to Gemini variants", () => {
    expect(supportsReasoningControl("gpt-6-astra")).toBe(true);
    expect(supportsReasoningControl("gpt-5.6-luna")).toBe(true);
    expect(supportsReasoningControl("gemini-3.8-flash-high")).toBe(false);
    expect(supportsReasoningControl("unknown-model")).toBe(false);
    expect(formatModelName("gpt-6-astra")).toBe("GPT-6 Astra");
    expect(formatModelName("gemini-3.8-flash-high")).toBe("Gemini 3.8 Flash High");
  });
});
