import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), release: vi.fn(), authenticate: vi.fn() }));
vi.mock("@/lib/auth/database", () => ({ getAuthDatabase: () => ({ connect: mocks.connect }) }));
vi.mock("@/lib/auth/require-session", () => ({ getAuthenticatedUserId: mocks.authenticate }));

import { requireEnterprisePermission, resolveEnterpriseContext } from "./context";

const tenantId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const organizationId = "33333333-3333-4333-8333-333333333333";
const userId = "synthetic-context-user";
const row = {
  organization_id: organizationId, organization_slug: "synthetic", organization_name: "Synthetic", organization_status: "active",
  tenant_id: tenantId, tenant_slug: "synthetic", tenant_name: "Synthetic", tenant_status: "active",
  workspace_id: workspaceId, workspace_slug: "synthetic", workspace_name: "Synthetic", contract_status: "active",
  seat_limit: 100, workspace_limit: 1, monthly_total_token_limit: 1000000, monthly_model_request_limit: 1000,
  concurrent_turn_limit: 25, concurrent_turn_limit_per_workspace: 25, concurrent_turn_limit_per_user: 1,
  token_reservation_per_turn: 50000, max_agent_threads_per_session: 4, billing_anchor_day: 1,
  effective_from: new Date("2020-01-01T00:00:00Z"), effective_until: null,
};
const allowedRole = { role_key: "operator", scope: "workspace", allowed_permissions: ["agent.run", "thread.read.own"], denied_permissions: [] };
const request = () => new Request("http://127.0.0.1:3100/api/agent/threads", { headers: { "x-commerce-workspace-id": workspaceId } });

describe("live Enterprise context reads", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("COMMERCE_RUNTIME_TENANT_ID", tenantId);
    mocks.authenticate.mockResolvedValue(userId);
    mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT tenant_member.tenant_id")) return { rows: [{ tenant_id: tenantId, workspace_id: workspaceId }] };
      if (sql.includes("SELECT organization_id")) return { rows: [{ organization_id: organizationId }] };
      if (sql.includes("organization.id AS organization_id")) return { rows: [row] };
      if (sql.includes("WITH direct_roles")) return { rows: [allowedRole] };
      return { rows: [] };
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses nine round trips while preserving the ordered transaction-local RLS boundaries", async () => {
    const result = await resolveEnterpriseContext(request());
    expect(result.ok).toBe(true);
    expect(mocks.query).toHaveBeenCalledTimes(9);
    const calls = mocks.query.mock.calls;
    expect(calls[0]).toEqual(["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"]);
    expect(calls[1]![0]).toContain("set_config('commerce.user_id', $1, true)");
    expect(calls[1]![0]).toContain("set_config('commerce.tenant_wide', 'off', true)");
    expect(calls[1]![1]).toEqual([userId]);
    expect(calls[2]![0]).toContain("SELECT tenant_member.tenant_id");
    expect(calls[2]![1]).toEqual([userId, workspaceId, tenantId]);
    expect(calls[3]![0]).toContain("set_config('commerce.tenant_id', $1, true)");
    expect(calls[3]![0]).toContain("set_config('commerce.workspace_id', $2, true)");
    expect(calls[3]![1]).toEqual([tenantId, workspaceId]);
    expect(calls[4]![0]).toContain("SELECT organization_id");
    expect(calls[5]).toEqual(["SELECT set_config('commerce.organization_id', $1, true)", [organizationId]]);
    expect(calls[6]![0]).toContain("organization.id AS organization_id");
    expect(calls[7]![0]).toContain("WITH direct_roles");
    expect(calls[7]![1]).toEqual([tenantId, workspaceId, userId]);
    expect(calls[8]).toEqual(["COMMIT"]);
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("reauthenticates and re-reads roles on every request, so an immediate explicit deny takes effect", async () => {
    const first = await resolveEnterpriseContext(request());
    expect(first.ok && first.context.permissions.has("agent.run")).toBe(true);
    const original = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (sql: string, ...args: unknown[]) => sql.includes("WITH direct_roles")
      ? { rows: [allowedRole, { ...allowedRole, role_key: "revoked", allowed_permissions: [], denied_permissions: ["agent.run"] }] }
      : original(sql, ...args));
    const second = await resolveEnterpriseContext(request());
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("Expected a live context.");
    expect(requireEnterprisePermission(second.context, "agent.run")?.status).toBe(403);
    expect(second.context.permissions.has("thread.read.own")).toBe(true);
    expect(mocks.authenticate).toHaveBeenCalledTimes(2);
    expect(mocks.connect).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls.filter(([sql]) => sql.includes("WITH direct_roles"))).toHaveLength(2);
  });

  it("does not borrow a database connection for an unauthenticated request", async () => {
    mocks.authenticate.mockResolvedValue(null);
    const result = await resolveEnterpriseContext(request());
    expect(!result.ok && result.response.status).toBe(401);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("does not widen scope when no currently active membership candidate exists", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    const result = await resolveEnterpriseContext(request());
    expect(!result.ok && result.response.status).toBe(403);
    expect(mocks.query).toHaveBeenCalledTimes(4);
    expect(mocks.query).toHaveBeenLastCalledWith("COMMIT");
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("set_config('commerce.tenant_id'"))).toBe(false);
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("discards a connection if rollback fails and preserves the original read failure without retry", async () => {
    const originalFailure = new Error("scope read failed");
    const original = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (sql: string, ...args: unknown[]) => {
      if (sql.includes("SELECT tenant_member.tenant_id")) throw originalFailure;
      if (sql === "ROLLBACK") throw new Error("connection unavailable");
      return original(sql, ...args);
    });
    await expect(resolveEnterpriseContext(request())).rejects.toBe(originalFailure);
    expect(mocks.query.mock.calls.filter(([sql]) => sql.includes("SELECT tenant_member.tenant_id"))).toHaveLength(1);
    expect(mocks.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith(true);
  });
});
