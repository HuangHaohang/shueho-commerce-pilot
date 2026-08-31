import { describe, expect, it } from "vitest";

import {
  COMPACT_COMPOSER_CONTROLS_MAX_WIDTH,
  shouldCompactComposerControls,
} from "./composer-layout";

describe("shouldCompactComposerControls", () => {
  it("compacts a 390px mobile composer before toolbar actions can clip", () => {
    expect(shouldCompactComposerControls(358)).toBe(true);
    expect(shouldCompactComposerControls(COMPACT_COMPOSER_CONTROLS_MAX_WIDTH)).toBe(true);
  });

  it("keeps labels in a normal desktop composer", () => {
    expect(shouldCompactComposerControls(820)).toBe(false);
    expect(shouldCompactComposerControls(0)).toBe(false);
  });
});
