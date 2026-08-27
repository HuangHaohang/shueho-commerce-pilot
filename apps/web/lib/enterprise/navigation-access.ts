import type { EnterprisePermission } from "./permissions";

const ENTERPRISE_ADMIN_NAVIGATION_PERMISSIONS = new Set<EnterprisePermission>([
  "tenant.read",
  "tenant.manage",
  "contract.read",
  "members.read",
  "members.manage",
  "groups.read",
  "groups.manage",
  "roles.read",
  "roles.manage",
  "workspaces.read",
  "workspaces.manage",
  "quota.read",
  "quota.manage",
  "usage.read",
  "usage.export",
  "audit.read",
  "audit.export",
  "external_data.policy.manage",
  "external_data.usage.read",
  "mcp.access_token.manage",
]);

export function canAccessEnterpriseAdmin(permissions: Iterable<string>): boolean {
  for (const permission of permissions) {
    if (ENTERPRISE_ADMIN_NAVIGATION_PERMISSIONS.has(permission as EnterprisePermission)) {
      return true;
    }
  }
  return false;
}

export function canManageExternalDataPolicy(permissions: Iterable<string>): boolean {
  for (const permission of permissions) {
    if (permission === "external_data.policy.manage") return true;
  }
  return false;
}
