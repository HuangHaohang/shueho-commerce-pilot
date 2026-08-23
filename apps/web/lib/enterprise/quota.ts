import {
  withEnterpriseDatabaseContext,
  withEnterpriseTenantDatabaseContext,
} from "./database-context";
import type { EnterpriseContract, EnterpriseContext, EnterpriseScope } from "./types";
import { billingPeriodStart } from "./billing-period";

export type TurnLeaseReservation =
  | { ok: true; leaseId: string; duplicate: boolean }
  | { ok: false; status: number; code: string; error: string };

type CountRow = {
  tenant_count: string;
  workspace_count: string;
  user_count: string;
};

type UsageRow = {
  total_tokens: string | null;
  model_requests: string;
  missing_usage_events: string;
};

type AgentAdmissionScope = EnterpriseScope & { contract?: EnterpriseContract };

export async function reserveAgentTurn(
  context: AgentAdmissionScope,
  threadId: string,
  requestId: string,
  options: { allowReleasedRetry?: boolean } = {},
): Promise<TurnLeaseReservation> {
  return withEnterpriseTenantDatabaseContext(context, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`agent-turn:${context.tenantId}`]);
    const contractResult = await client.query<{
      status: EnterpriseContract["status"];
      seat_limit: number;
      workspace_limit: number;
      monthly_total_token_limit: string | number | null;
      monthly_model_request_limit: string | number | null;
      concurrent_turn_limit: number;
      concurrent_turn_limit_per_workspace: number;
      concurrent_turn_limit_per_user: number;
      token_reservation_per_turn: string | number;
      max_agent_threads_per_session: number;
      billing_anchor_day: number;
      effective_from: Date;
      effective_until: Date | null;
    }>(
      `
        SELECT status, seat_limit, workspace_limit, monthly_total_token_limit,
               monthly_model_request_limit, concurrent_turn_limit,
               concurrent_turn_limit_per_workspace, concurrent_turn_limit_per_user,
               token_reservation_per_turn, max_agent_threads_per_session,
               billing_anchor_day, effective_from, effective_until
        FROM commerce_enterprise_contract
        WHERE tenant_id = $1
        LIMIT 1
      `,
      [context.tenantId],
    );
    const contractRow = contractResult.rows[0];
    const now = Date.now();
    if (
      !contractRow ||
      contractRow.status !== "active" ||
      contractRow.effective_from.getTime() > now ||
      (contractRow.effective_until !== null && contractRow.effective_until.getTime() <= now)
    ) {
      return {
        ok: false,
        status: 402,
        code: "ENTERPRISE_CONTRACT_INACTIVE",
        error: "企业合同当前不可用。",
      };
    }
    const admissionContext: EnterpriseContext = {
      ...(context as EnterpriseContext),
      contract: {
        status: contractRow.status,
        seatLimit: contractRow.seat_limit,
        workspaceLimit: contractRow.workspace_limit,
        monthlyTotalTokenLimit: nullableSafeInteger(contractRow.monthly_total_token_limit),
        monthlyModelRequestLimit: nullableSafeInteger(contractRow.monthly_model_request_limit),
        concurrentTurnLimit: contractRow.concurrent_turn_limit,
        concurrentTurnLimitPerWorkspace: contractRow.concurrent_turn_limit_per_workspace,
        concurrentTurnLimitPerUser: contractRow.concurrent_turn_limit_per_user,
        tokenReservationPerTurn: nullableSafeInteger(contractRow.token_reservation_per_turn) ?? 50_000,
        maxAgentThreadsPerSession: contractRow.max_agent_threads_per_session,
        billingAnchorDay: contractRow.billing_anchor_day,
        effectiveFrom: contractRow.effective_from.toISOString(),
        effectiveUntil: contractRow.effective_until?.toISOString() ?? null,
      },
    };
    await client.query(
      `
        UPDATE commerce_agent_turn_lease
        SET state = 'expired', released_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1 AND state IN ('reserved', 'active') AND expires_at <= CURRENT_TIMESTAMP
      `,
      [context.tenantId],
    );

    const existing = await client.query<{ id: string; state: "reserved" | "active" | "released" | "expired" }>(
      `SELECT id, state FROM commerce_agent_turn_lease WHERE tenant_id = $1 AND request_id = $2 LIMIT 1`,
      [context.tenantId, requestId],
    );
    const previous = existing.rows[0];
    if (previous && options.allowReleasedRetry && (previous.state === "released" || previous.state === "expired")) {
      await client.query(
        `DELETE FROM commerce_agent_turn_lease WHERE id = $1 AND tenant_id = $2`,
        [previous.id, context.tenantId],
      );
    } else if (previous) {
      return { ok: true, leaseId: previous.id, duplicate: true };
    }

    const counts = await client.query<CountRow>(
      `
        SELECT
          count(*)::text AS tenant_count,
          count(*) FILTER (WHERE workspace_id = $2)::text AS workspace_count,
          count(*) FILTER (WHERE user_id = $3)::text AS user_count
        FROM commerce_agent_turn_lease
        WHERE tenant_id = $1 AND state IN ('reserved', 'active') AND expires_at > CURRENT_TIMESTAMP
      `,
      [context.tenantId, context.workspaceId, context.userId],
    );
    const active = counts.rows[0] ?? { tenant_count: "0", workspace_count: "0", user_count: "0" };
    const concurrencyFailure = checkConcurrency(admissionContext, active);
    if (concurrencyFailure) {
      await writeQuotaAudit(client, context, threadId, concurrencyFailure.code);
      return concurrencyFailure;
    }

    const periodStart = billingPeriodStart(admissionContext.contract.billingAnchorDay);
    const usage = await client.query<UsageRow>(
      `
        SELECT COALESCE(sum(total_tokens), 0)::text AS total_tokens,
               count(*)::text AS model_requests,
               count(*) FILTER (WHERE usage_status = 'missing')::text AS missing_usage_events
        FROM commerce_agent_usage_event
        WHERE tenant_id = $1 AND occurred_at >= $2
      `,
      [context.tenantId, periodStart],
    );
    const currentUsage = usage.rows[0] ?? {
      total_tokens: "0",
      model_requests: "0",
      missing_usage_events: "0",
    };
    const usageFailure = checkMonthlyUsage(
      admissionContext,
      currentUsage,
      Number.parseInt(active.tenant_count, 10),
    );
    if (usageFailure) {
      await writeQuotaAudit(client, context, threadId, usageFailure.code);
      return usageFailure;
    }

    const leaseLifetimeSeconds = Math.ceil(
      (Number.parseInt(process.env.COMMERCE_AGENT_MAX_TURN_DURATION_MS || "600000", 10) + 60_000) / 1_000,
    );
    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO commerce_agent_turn_lease
          (tenant_id, workspace_id, user_id, thread_id, request_id, state, expires_at)
        VALUES ($1, $2, $3, $4, $5, 'reserved', CURRENT_TIMESTAMP + make_interval(secs => $6))
        RETURNING id
      `,
      [context.tenantId, context.workspaceId, context.userId, threadId, requestId, leaseLifetimeSeconds],
    );
    const leaseId = inserted.rows[0]?.id;
    if (!leaseId) throw new Error("Turn lease reservation returned no id.");
    return { ok: true, leaseId, duplicate: false };
  });
}

function nullableSafeInteger(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function activateAgentTurnLease(
  context: EnterpriseContext,
  leaseId: string,
  turnId: string,
): Promise<void> {
  await withEnterpriseDatabaseContext(context, async (client) => {
    const result = await client.query(
      `
        UPDATE commerce_agent_turn_lease
        SET state = 'active', turn_id = $4, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3
          AND (state = 'reserved' OR (state = 'active' AND turn_id = $4))
      `,
      [leaseId, context.tenantId, context.workspaceId, turnId],
    );
    if (result.rowCount !== 1) throw new Error("Turn lease could not be activated.");
    await client.query(
      `
        UPDATE commerce_agent_turn_lease lease
        SET state = 'released', released_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE lease.id = $1 AND lease.tenant_id = $2 AND lease.workspace_id = $3
          AND lease.turn_id = $4 AND lease.state = 'active'
          AND EXISTS (
            SELECT 1 FROM commerce_agent_turn_completion completion
            WHERE completion.tenant_id = lease.tenant_id
              AND completion.workspace_id = lease.workspace_id
              AND completion.root_thread_id = lease.thread_id
              AND completion.turn_id = lease.turn_id
          )
      `,
      [leaseId, context.tenantId, context.workspaceId, turnId],
    );
  });
}

export async function releaseAgentTurnLease(context: EnterpriseContext, leaseId: string): Promise<void> {
  await withEnterpriseDatabaseContext(context, async (client) => {
    await client.query(
      `
        UPDATE commerce_agent_turn_lease
        SET state = 'released', released_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3 AND state IN ('reserved', 'active')
      `,
      [leaseId, context.tenantId, context.workspaceId],
    );
  });
}

export async function releaseAgentTurnLeaseForTurn(
  context: EnterpriseContext,
  threadId: string,
  turnId: string,
): Promise<void> {
  await withEnterpriseDatabaseContext(context, async (client) => {
    await client.query(
      `
        UPDATE commerce_agent_turn_lease
        SET state = 'released', released_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1 AND workspace_id = $2 AND thread_id = $3 AND turn_id = $4
          AND state IN ('reserved', 'active')
      `,
      [context.tenantId, context.workspaceId, threadId, turnId],
    );
  });
}

export async function releaseAgentTurnLeaseForRequest(
  context: EnterpriseScope,
  threadId: string,
  requestId: string,
): Promise<void> {
  await withEnterpriseDatabaseContext(context, async (client) => {
    await client.query(
      `
        UPDATE commerce_agent_turn_lease
        SET state = 'released', released_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1 AND workspace_id = $2 AND user_id = $3
          AND thread_id = $4 AND request_id = $5
          AND state IN ('reserved', 'active')
      `,
      [context.tenantId, context.workspaceId, context.userId, threadId, requestId],
    );
  });
}

export async function attachExistingAgentTurnLease(
  context: EnterpriseScope,
  threadId: string,
  turnId: string,
): Promise<boolean> {
  return withEnterpriseTenantDatabaseContext(context, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`agent-turn:${context.tenantId}`]);
    const result = await client.query<{ id: string; state: "reserved" | "active"; turn_id: string | null }>(
      `SELECT id, state, turn_id FROM commerce_agent_turn_lease
       WHERE tenant_id = $1 AND workspace_id = $2 AND user_id = $3
         AND thread_id = $4 AND state IN ('reserved', 'active')
         AND expires_at > CURRENT_TIMESTAMP
       ORDER BY CASE
         WHEN state = 'active' AND turn_id = $5 THEN 0
         WHEN state = 'reserved' THEN 1
         ELSE 2 END,
         created_at
       LIMIT 1 FOR UPDATE`,
      [context.tenantId, context.workspaceId, context.userId, threadId, turnId],
    );
    const lease = result.rows[0];
    if (!lease) return false;
    if (lease.state === "active") return lease.turn_id === turnId;
    const attached = await client.query(
      `UPDATE commerce_agent_turn_lease
       SET state = 'active', turn_id = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND state = 'reserved'`,
      [lease.id, turnId],
    );
    return attached.rowCount === 1;
  });
}

function checkConcurrency(
  context: EnterpriseContext,
  row: CountRow,
): Extract<TurnLeaseReservation, { ok: false }> | null {
  const tenantCount = Number.parseInt(row.tenant_count, 10);
  const workspaceCount = Number.parseInt(row.workspace_count, 10);
  const userCount = Number.parseInt(row.user_count, 10);
  if (tenantCount >= context.contract.concurrentTurnLimit) {
    return quotaFailure("TENANT_CONCURRENT_TURN_LIMIT", "企业并发任务已达到合同上限。");
  }
  if (workspaceCount >= context.contract.concurrentTurnLimitPerWorkspace) {
    return quotaFailure("WORKSPACE_CONCURRENT_TURN_LIMIT", "工作区并发任务已达到上限。");
  }
  if (userCount >= context.contract.concurrentTurnLimitPerUser) {
    return quotaFailure("USER_CONCURRENT_TURN_LIMIT", "您的并发任务已达到上限。");
  }
  return null;
}

function checkMonthlyUsage(
  context: EnterpriseContext,
  row: UsageRow,
  inFlightTurns: number,
): Extract<TurnLeaseReservation, { ok: false }> | null {
  const totalTokens = Number.parseInt(row.total_tokens || "0", 10);
  const modelRequests = Number.parseInt(row.model_requests, 10);
  const missingUsageEvents = Number.parseInt(row.missing_usage_events, 10);
  if (missingUsageEvents > 0) {
    return quotaFailure(
      "TENANT_USAGE_RECONCILIATION_REQUIRED",
      "企业存在尚未完成账单对账的 provider 用量，新的模型任务已暂停。",
    );
  }
  const projectedTokens = totalTokens + (inFlightTurns + 1) * context.contract.tokenReservationPerTurn;
  const projectedModelRequests = modelRequests + inFlightTurns + 1;
  if (
    context.contract.monthlyTotalTokenLimit !== null &&
    projectedTokens > context.contract.monthlyTotalTokenLimit
  ) {
    return quotaFailure("TENANT_MONTHLY_TOKEN_LIMIT", "企业本计费周期的 token 额度已用尽。");
  }
  if (
    context.contract.monthlyModelRequestLimit !== null &&
    projectedModelRequests > context.contract.monthlyModelRequestLimit
  ) {
    return quotaFailure("TENANT_MONTHLY_REQUEST_LIMIT", "企业本计费周期的模型请求额度已用尽。");
  }
  return null;
}

function quotaFailure(code: string, error: string): Extract<TurnLeaseReservation, { ok: false }> {
  return { ok: false, status: 429, code, error };
}

async function writeQuotaAudit(
  client: import("pg").PoolClient,
  context: EnterpriseScope,
  threadId: string,
  reasonCode: string,
): Promise<void> {
  await client.query(
    `
      INSERT INTO commerce_enterprise_audit_event
        (tenant_id, workspace_id, actor_user_id, action, target_type, target_id, outcome, metadata)
      VALUES ($1, $2, $3, 'agent.turn.reserve', 'thread', $4, 'denied',
              jsonb_build_object('reasonCode', $5::text))
    `,
    [context.tenantId, context.workspaceId, context.userId, threadId, reasonCode],
  );
}
