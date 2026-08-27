import { describe, expect, it } from "vitest";

import {
  canAccessEnterpriseAdmin,
  canManageExternalDataPolicy,
} from "./navigation-access";

describe("enterprise admin navigation access", () => {
  it("hides navigation without an enterprise permission context", () => {
    expect(canAccessEnterpriseAdmin([])).toBe(false);
  });

  it("hides navigation for agent-only permissions", () => {
    expect(canAccessEnterpriseAdmin(["agent.run", "thread.create", "queue.manage"])).toBe(false);
  });

  it("shows navigation for read-only enterprise administration surfaces", () => {
    expect(canAccessEnterpriseAdmin(["usage.read"])).toBe(true);
    expect(canAccessEnterpriseAdmin(["workspaces.read"])).toBe(true);
  });

  it("shows navigation for management permissions", () => {
    expect(canAccessEnterpriseAdmin(["members.manage"])).toBe(true);
  });
});

describe("external data policy navigation", () => {
  it("shows enterprise settings only to the policy manager", () => {
    expect(canManageExternalDataPolicy(["external_data.policy.manage"])).toBe(true);
    expect(canManageExternalDataPolicy(["usage.read", "external_data.usage.read"])).toBe(false);
    expect(canManageExternalDataPolicy(["agent.run", "mcp.access_token.manage"])).toBe(false);
  });
});
