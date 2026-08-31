import { describe, expect, it } from "vitest";

import { SYSTEM_ENTERPRISE_ROLES } from "./permissions";

describe("system enterprise role boundaries", () => {
  it("lets ordinary workspace operators import files without granting source administration or review", () => {
    const operator = SYSTEM_ENTERPRISE_ROLES.find((role) => role.key === "workspace_operator");

    expect(operator?.allowedPermissions).toContain("product_catalog.read");
    expect(operator?.allowedPermissions).toContain("product_catalog.import");
    expect(operator?.allowedPermissions).not.toContain("product_catalog.review");
    expect(operator?.allowedPermissions).not.toContain("product_catalog.sources.manage");
  });

  it("keeps product-source administration on workspace owners and tenant administrators", () => {
    const workspaceOwner = SYSTEM_ENTERPRISE_ROLES.find((role) => role.key === "workspace_owner");
    const tenantAdmin = SYSTEM_ENTERPRISE_ROLES.find((role) => role.key === "tenant_admin");
    const analyst = SYSTEM_ENTERPRISE_ROLES.find((role) => role.key === "workspace_analyst");

    expect(workspaceOwner?.allowedPermissions).toContain("product_catalog.sources.manage");
    expect(tenantAdmin?.allowedPermissions).toContain("product_catalog.sources.manage");
    expect(analyst?.allowedPermissions).toEqual(expect.arrayContaining(["product_catalog.read"]));
    expect(analyst?.allowedPermissions).not.toContain("product_catalog.import");
  });
});
