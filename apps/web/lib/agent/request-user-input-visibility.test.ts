import { describe, expect, it } from "vitest";

import {
  shouldDisplayPersistedRequestUserInputAnswer,
  shouldDisplayRequestUserInputAnswer,
} from "./request-user-input-visibility";

describe("request_user_input answer visibility", () => {
  it("shows native Harness answers but hides application approval answers", () => {
    expect(shouldDisplayRequestUserInputAnswer("codex_app_server")).toBe(true);
    expect(shouldDisplayRequestUserInputAnswer("commerce_approval")).toBe(false);
    expect(shouldDisplayRequestUserInputAnswer(undefined)).toBe(false);
  });

  it("hides legacy persisted Commerce approval answer rows", () => {
    expect(shouldDisplayPersistedRequestUserInputAnswer("42")).toBe(true);
    expect(shouldDisplayPersistedRequestUserInputAnswer("external_data_call-1")).toBe(false);
    expect(shouldDisplayPersistedRequestUserInputAnswer("skill_call-1")).toBe(false);
  });
});
