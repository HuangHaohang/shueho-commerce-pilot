import { describe, expect, it } from "vitest";

import { mayAssignInvitationRoles } from "./invitation-authorization";

describe("Enterprise invitation role boundaries", () => {
  it("allows an owner to assign the owner role", () => {
    expect(
      mayAssignInvitationRoles(["tenant_owner"], new Set(["tenant.manage"]), [
        { role_key: "tenant_owner", allowed_permissions: ["tenant.manage"], denied_permissions: [], is_system: true },
      ]),
    ).toBe(true);
  });

  it("prevents an administrator from granting owner-equivalent permissions", () => {
    expect(
      mayAssignInvitationRoles(["tenant_admin"], new Set(["members.manage"]), [
        {
          role_key: "custom_owner",
          allowed_permissions: ["tenant.manage", "members.manage"],
          denied_permissions: [],
          is_system: false,
        },
      ]),
    ).toBe(false);
  });

  it("allows an administrator to grant ordinary tenant and workspace roles", () => {
    expect(
      mayAssignInvitationRoles(["tenant_admin"], new Set(["members.manage"]), [
        {
          role_key: "tenant_member",
          allowed_permissions: ["tenant.read"],
          denied_permissions: [],
          is_system: true,
        },
        {
          role_key: "workspace_operator",
          allowed_permissions: ["agent.run", "thread.create"],
          denied_permissions: [],
          is_system: true,
        },
      ]),
    ).toBe(true);
  });

  it("requires a custom delegable role to stay within the inviter's effective permissions", () => {
    expect(
      mayAssignInvitationRoles(["custom_manager"], new Set(["members.manage"]), [
        {
          role_key: "custom_admin",
          allowed_permissions: ["members.manage", "roles.manage"],
          denied_permissions: [],
          is_system: false,
        },
      ]),
    ).toBe(false);
  });
});
