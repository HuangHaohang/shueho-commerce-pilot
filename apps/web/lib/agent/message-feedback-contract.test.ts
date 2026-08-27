import { describe, expect, it } from "vitest";

import {
  isAgentMessageFeedbackRating,
  toggleAgentMessageFeedback,
} from "./message-feedback-contract";

describe("agent message feedback contract", () => {
  it("accepts only the two persisted rating values", () => {
    expect(isAgentMessageFeedbackRating("positive")).toBe(true);
    expect(isAgentMessageFeedbackRating("negative")).toBe(true);
    expect(isAgentMessageFeedbackRating("excellent")).toBe(false);
    expect(isAgentMessageFeedbackRating(null)).toBe(false);
  });

  it("clears an active rating and replaces the opposite rating", () => {
    expect(toggleAgentMessageFeedback("positive", "positive")).toBeNull();
    expect(toggleAgentMessageFeedback("negative", "positive")).toBe("positive");
    expect(toggleAgentMessageFeedback(null, "negative")).toBe("negative");
  });
});
