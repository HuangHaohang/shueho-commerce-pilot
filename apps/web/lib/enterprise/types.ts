import type { EnterprisePermission } from "@/lib/enterprise/permissions";

export type EnterpriseContract = {
  status: "pending" | "active" | "suspended" | "terminated";
  seatLimit: number;
  workspaceLimit: number;
  monthlyTotalTokenLimit: number | null;
  monthlyModelRequestLimit: number | null;
  concurrentTurnLimit: number;
  concurrentTurnLimitPerWorkspace: number;
  concurrentTurnLimitPerUser: number;
  tokenReservationPerTurn: number;
  maxAgentThreadsPerSession: number;
  billingAnchorDay: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
};

export type EnterpriseContext = {
  userId: string;
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  organizationStatus: "pending" | "active" | "suspended" | "terminated";
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantStatus: "pending" | "active" | "suspended" | "terminated";
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  roleKeys: string[];
  permissions: ReadonlySet<EnterprisePermission>;
  tenantPermissions: ReadonlySet<EnterprisePermission>;
  contract: EnterpriseContract;
};

export type EnterpriseScope = Pick<EnterpriseContext, "tenantId" | "workspaceId" | "userId">;
