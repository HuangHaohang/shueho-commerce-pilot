export const ENTERPRISE_PERMISSIONS = [
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
  "thread.create",
  "thread.read.own",
  "thread.read.workspace",
  "thread.interrupt",
  "thread.delete",
  "thread.compact",
  "queue.manage",
  "artifact.read",
  "agent.run",
  "external_data.catalog.read",
  "external_data.call",
  "external_data.policy.manage",
  "external_data.usage.read",
  "mcp.access_token.manage",
  "product_catalog.read",
  "product_catalog.import",
  "product_catalog.review",
  "product_catalog.sources.manage",
] as const;

export type EnterprisePermission = (typeof ENTERPRISE_PERMISSIONS)[number];
export type EnterpriseRoleScope = "tenant" | "workspace";

export type SystemEnterpriseRole = {
  key: string;
  name: string;
  description: string;
  scope: EnterpriseRoleScope;
  allowedPermissions: EnterprisePermission[];
};

const tenantReadPermissions: EnterprisePermission[] = [
  "tenant.read",
  "contract.read",
  "workspaces.read",
];
const workspaceRunPermissions: EnterprisePermission[] = [
  "thread.create",
  "thread.read.own",
  "thread.interrupt",
  "thread.delete",
  "thread.compact",
  "queue.manage",
  "artifact.read",
  "agent.run",
  "external_data.catalog.read",
  "external_data.call",
  "external_data.usage.read",
  "mcp.access_token.manage",
  "product_catalog.read",
];

export const SYSTEM_ENTERPRISE_ROLES: SystemEnterpriseRole[] = [
  {
    key: "tenant_owner",
    name: "企业所有者",
    description: "管理企业、成员、工作区、角色、额度、用量和审计。",
    scope: "tenant",
    allowedPermissions: [...ENTERPRISE_PERMISSIONS],
  },
  {
    key: "tenant_admin",
    name: "企业管理员",
    description: "管理成员、组、角色和工作区，但不能替代合同所有者。",
    scope: "tenant",
    allowedPermissions: [
      ...tenantReadPermissions,
      "members.read",
      "members.manage",
      "groups.read",
      "groups.manage",
      "roles.read",
      "roles.manage",
      "workspaces.manage",
      "quota.read",
      "quota.manage",
      "usage.read",
      "audit.read",
      "external_data.catalog.read",
      "external_data.call",
      "external_data.policy.manage",
      "external_data.usage.read",
      "mcp.access_token.manage",
      "product_catalog.read",
      "product_catalog.import",
      "product_catalog.review",
      "product_catalog.sources.manage",
    ],
  },
  {
    key: "tenant_member",
    name: "企业成员",
    description: "企业席位成员；具体 Agent 能力由工作区角色授予。",
    scope: "tenant",
    allowedPermissions: tenantReadPermissions,
  },
  {
    key: "analytics_viewer",
    name: "用量分析员",
    description: "只读查看企业用量与审计概览。",
    scope: "tenant",
    allowedPermissions: [
      ...tenantReadPermissions,
      "usage.read",
      "audit.read",
      "quota.read",
      "external_data.usage.read",
    ],
  },
  {
    key: "workspace_owner",
    name: "工作区所有者",
    description: "运行和管理自己的工作区 Agent；租户成员与工作区生命周期由企业管理员管理。",
    scope: "workspace",
    allowedPermissions: [
      ...workspaceRunPermissions,
      "workspaces.read",
      "usage.read",
      "product_catalog.import",
      "product_catalog.review",
      "product_catalog.sources.manage",
    ],
  },
  {
    key: "workspace_operator",
    name: "Agent 操作员",
    description: "在工作区中创建和管理自己的 Agent 任务。",
    scope: "workspace",
    allowedPermissions: [
      ...workspaceRunPermissions,
      "workspaces.read",
      "usage.read",
      "product_catalog.import",
    ],
  },
  {
    key: "workspace_analyst",
    name: "工作区分析员",
    description: "只读查看工作区元数据和用量；对话共享将在独立授权面上线。",
    scope: "workspace",
    allowedPermissions: [
      "workspaces.read",
      "usage.read",
      "external_data.catalog.read",
      "external_data.usage.read",
      "product_catalog.read",
    ],
  },
  {
    key: "workspace_viewer",
    name: "工作区访客",
    description: "只读查看工作区元数据，不授予对话或产物访问。",
    scope: "workspace",
    allowedPermissions: ["workspaces.read"],
  },
];

export function hasEnterprisePermission(
  permissions: ReadonlySet<string>,
  permission: EnterprisePermission,
): boolean {
  return permissions.has(permission);
}
