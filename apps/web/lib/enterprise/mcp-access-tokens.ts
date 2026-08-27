import { createHash, randomBytes } from "node:crypto";

import { getAuthDatabase } from "@/lib/auth/database";
import {
  withEnterpriseDatabaseContext,
  withEnterpriseTenantDatabaseContext,
} from "@/lib/enterprise/database-context";
import { consumeEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";
import type { EnterpriseContext } from "@/lib/enterprise/types";

export const MCP_ACCESS_TOKEN_SCOPES = [
  "external_data.catalog.read",
  "external_data.call",
] as const;

export type McpAccessTokenScope = (typeof MCP_ACCESS_TOKEN_SCOPES)[number];

export type McpAccessTokenView = {
  id: string;
  name: string;
  prefix: string;
  scopes: McpAccessTokenScope[];
  status: "active" | "revoked";
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  createdByUserId: string;
  createdByName: string | null;
};

export type CreatedMcpAccessToken = McpAccessTokenView & {
  token: string;
};

export type AuthenticatedMcpPrincipal = {
  tokenId: string;
  tenantId: string;
  workspaceId: string;
  userId: string;
  scopes: McpAccessTokenScope[];
};

type TokenRow = {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  status: "active" | "revoked";
  expires_at: Date | null;
  last_used_at: Date | null;
  created_at: Date;
  created_by_user_id: string;
  created_by_name: string | null;
};

export class McpAccessTokenError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "McpAccessTokenError";
  }
}

export async function listMcpAccessTokens(
  context: EnterpriseContext,
  includeWorkspaceTokens = false,
): Promise<McpAccessTokenView[]> {
  return withEnterpriseDatabaseContext(context, async (client) => {
    const result = await client.query<TokenRow>(
      `
        SELECT token.id, token.name, token.token_prefix, token.scopes, token.status,
               token.expires_at, token.last_used_at, token.created_at,
               token.created_by_user_id, owner.name AS created_by_name
        FROM commerce_mcp_access_token token
        LEFT JOIN "user" owner ON owner.id = token.created_by_user_id
        WHERE token.tenant_id = $1 AND token.workspace_id = $2
          AND ($4::boolean OR token.created_by_user_id = $3)
        ORDER BY token.created_at DESC
      `,
      [context.tenantId, context.workspaceId, context.userId, includeWorkspaceTokens],
    );
    return result.rows.map(toTokenView);
  });
}

export async function createMcpAccessToken(
  context: EnterpriseContext,
  input: { name: string; scopes: McpAccessTokenScope[]; expiresInDays: number | null },
): Promise<CreatedMcpAccessToken> {
  const tokenPrefix = `cp_${randomBytes(4).toString("hex")}`;
  const token = `${tokenPrefix}_${randomBytes(32).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(token).digest();
  return withEnterpriseTenantDatabaseContext(context, async (client) => {
    const activeCount = await client.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM commerce_mcp_access_token
        WHERE tenant_id = $1 AND workspace_id = $2 AND created_by_user_id = $3
          AND status = 'active' AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      `,
      [context.tenantId, context.workspaceId, context.userId],
    );
    if (Number.parseInt(activeCount.rows[0]?.count || "0", 10) >= 10) {
      throw new McpAccessTokenError("每个账号最多保留 10 个有效 MCP 访问令牌。", "MCP_TOKEN_LIMIT", 409);
    }
    const result = await client.query<TokenRow>(
      `
        INSERT INTO commerce_mcp_access_token (
          tenant_id, workspace_id, created_by_user_id, name,
          token_prefix, token_hash, scopes, expires_at
        )
        VALUES (
          $1, $2, $3, $4,
          $5, $6, $7::text[],
          CASE WHEN $8::integer IS NULL THEN NULL ELSE CURRENT_TIMESTAMP + make_interval(days => $8::integer) END
        )
        RETURNING id, name, token_prefix, scopes, status, expires_at, last_used_at,
                  created_at, created_by_user_id, NULL::text AS created_by_name
      `,
      [
        context.tenantId,
        context.workspaceId,
        context.userId,
        input.name,
        tokenPrefix,
        tokenHash,
        input.scopes,
        input.expiresInDays,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error("MCP access token insert returned no row.");
    await client.query(
      `
        INSERT INTO commerce_enterprise_audit_event (
          tenant_id, workspace_id, actor_user_id, action,
          target_type, target_id, outcome, metadata
        )
        VALUES ($1, $2, $3, 'mcp.access_token.create', 'mcp_access_token', $4, 'succeeded',
                jsonb_build_object('prefix', $5::text, 'scopes', $6::text[]))
      `,
      [context.tenantId, context.workspaceId, context.userId, row.id, tokenPrefix, input.scopes],
    );
    return { ...toTokenView(row), token };
  });
}

export async function revokeMcpAccessToken(
  context: EnterpriseContext,
  tokenId: string,
  allowWorkspaceToken = false,
): Promise<void> {
  await withEnterpriseTenantDatabaseContext(context, async (client) => {
    const result = await client.query<{ token_prefix: string }>(
      `
        UPDATE commerce_mcp_access_token
        SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3
          AND ($5::boolean OR created_by_user_id = $4) AND status = 'active'
        RETURNING token_prefix
      `,
      [tokenId, context.tenantId, context.workspaceId, context.userId, allowWorkspaceToken],
    );
    const prefix = result.rows[0]?.token_prefix;
    if (!prefix) {
      throw new McpAccessTokenError("MCP 访问令牌不存在或已经撤销。", "MCP_TOKEN_NOT_FOUND", 404);
    }
    await client.query(
      `
        INSERT INTO commerce_enterprise_audit_event (
          tenant_id, workspace_id, actor_user_id, action,
          target_type, target_id, outcome, metadata
        )
        VALUES ($1, $2, $3, 'mcp.access_token.revoke', 'mcp_access_token', $4, 'succeeded',
                jsonb_build_object('prefix', $5::text))
      `,
      [context.tenantId, context.workspaceId, context.userId, tokenId, prefix],
    );
  });
}

export async function authenticateMcpAccessTokenDigest(
  prefix: string,
  hashHex: string,
): Promise<AuthenticatedMcpPrincipal | null> {
  if (!/^cp_[A-Za-z0-9]{8}$/.test(prefix) || !/^[a-f0-9]{64}$/.test(hashHex)) return null;
  const result = await getAuthDatabase().query<{
    token_id: string;
    tenant_id: string;
    workspace_id: string;
    user_id: string;
    scopes: string[];
  }>(
    `SELECT * FROM commerce_authenticate_mcp_access_token($1, $2)`,
    [prefix, hashHex],
  );
  const row = result.rows[0];
  if (!row) return null;
  const scopes = row.scopes.filter(
    (scope): scope is McpAccessTokenScope => MCP_ACCESS_TOKEN_SCOPES.includes(scope as McpAccessTokenScope),
  );
  if (!scopes.length) return null;
  return {
    tokenId: row.token_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    scopes,
  };
}

export async function consumeMcpAccessTokenRateLimit(
  principal: AuthenticatedMcpPrincipal,
  limit = 120,
  windowSeconds = 60,
): Promise<boolean> {
  const result = await consumeEnterpriseRateLimit(
    principal,
    `mcp.access.${principal.tokenId}`,
    limit,
    windowSeconds,
  );
  return result.allowed;
}

function toTokenView(row: TokenRow): McpAccessTokenView {
  return {
    id: row.id,
    name: row.name,
    prefix: row.token_prefix,
    scopes: row.scopes.filter(
      (scope): scope is McpAccessTokenScope => MCP_ACCESS_TOKEN_SCOPES.includes(scope as McpAccessTokenScope),
    ),
    status: row.status,
    expiresAt: row.expires_at?.toISOString() ?? null,
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
  };
}
