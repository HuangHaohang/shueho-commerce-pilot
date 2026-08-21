import { describe, expect, it } from "vitest";

import { loginBodySchema, registerBodySchema } from "./validation";

describe("authentication request validation", () => {
  it("accepts an email and a password containing letters and numbers", () => {
    expect(
      loginBodySchema.safeParse({
        identifierType: "email",
        identifier: "user@example.com",
        password: "StrongPass123",
      }).success,
    ).toBe(true);
  });

  it("rejects weak passwords", () => {
    expect(
      loginBodySchema.safeParse({
        identifierType: "phone",
        identifier: "13800138000",
        password: "password",
      }).success,
    ).toBe(false);
  });

  it("requires a registration name", () => {
    expect(
      registerBodySchema.safeParse({
        identifierType: "email",
        identifier: "user@example.com",
        password: "StrongPass123",
      }).success,
    ).toBe(false);
  });
});
