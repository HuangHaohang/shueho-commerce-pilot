import type { EnterprisePermission } from "./permissions";

const TENANT_ADMIN_SYSTEM_ROLE_ALLOWLIST = new Set([
  "tenant_admin",
  "tenant_member",
  "analytics_viewer",
  "workspace_owner",
  "workspace_operator",
  "workspace_analyst",
  "workspace_viewer",
]);

export type AssignableInvitationRole = {
  role_key: string;
  allowed_permissions: string[];
  denied_permissions: string[];
  is_system: boolean;
};

export function mayAssignInvitationRoles(
  inviterRoleKeys: readonly string[],
  inviterPermissions: ReadonlySet<string>,
  roles: readonly AssignableInvitationRole[],
): boolean {
  if (inviterRoleKeys.includes("tenant_owner")) return true;
  return roles.every((role) => {
    if (
      inviterRoleKeys.includes("tenant_admin") &&
      role.is_system &&
      TENANT_ADMIN_SYSTEM_ROLE_ALLOWLIST.has(role.role_key)
    ) {
      return true;
    }
    const denied = new Set(role.denied_permissions);
    return role.allowed_permissions
      .filter((permission) => !denied.has(permission))
      .every((permission) => inviterPermissions.has(permission as EnterprisePermission));
  });
}
