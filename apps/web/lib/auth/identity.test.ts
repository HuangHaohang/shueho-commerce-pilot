import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createPhoneEmailAlias,
  isPhoneEmailAlias,
  maskPhoneNumber,
  normalizeEmail,
  normalizePhoneNumber,
} from "./identity";

const originalSecret = process.env.BETTER_AUTH_SECRET;

describe("authentication identity normalization", () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "test-secret-with-at-least-thirty-two-characters";
  });

  afterEach(() => {
    process.env.BETTER_AUTH_SECRET = originalSecret;
  });

  it("normalizes email casing and whitespace", () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
  });

  it("normalizes Chinese mobile input and E.164 input", () => {
    expect(normalizePhoneNumber("138 0013 8000")).toBe("+8613800138000");
    expect(normalizePhoneNumber("0086 13800138000")).toBe("+8613800138000");
    expect(normalizePhoneNumber("+1 (415) 555-2671")).toBe("+14155552671");
    expect(normalizePhoneNumber("12345")).toBeNull();
  });

  it("derives a deterministic alias without embedding the phone number", () => {
    const alias = createPhoneEmailAlias("+8613800138000");
    expect(alias).toBe(createPhoneEmailAlias("+8613800138000"));
    expect(alias).not.toContain("13800138000");
    expect(isPhoneEmailAlias(alias)).toBe(true);
  });

  it("masks phone numbers for public session display", () => {
    expect(maskPhoneNumber("+8613800138000")).toBe("+86138****8000");
  });
});
