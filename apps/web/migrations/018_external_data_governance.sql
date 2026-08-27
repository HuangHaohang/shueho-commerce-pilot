CREATE TABLE IF NOT EXISTS commerce_external_data_policy (
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'justoneapi' CHECK (provider = 'justoneapi'),
  status text NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
  approval_mode text NOT NULL DEFAULT 'always_ask'
    CHECK (approval_mode IN ('always_ask', 'task', 'policy')),
  allowed_platforms text[] NOT NULL DEFAULT ARRAY['taobao', 'xiaohongshu', 'douyin', 'jd']::text[],
  allowed_endpoint_ids text[] NOT NULL DEFAULT '{}'::text[],
  monthly_call_limit integer NOT NULL DEFAULT 100 CHECK (monthly_call_limit > 0),
  monthly_spend_limit_micros bigint CHECK (monthly_spend_limit_micros IS NULL OR monthly_spend_limit_micros > 0),
  per_call_auto_approval_micros bigint
    CHECK (per_call_auto_approval_micros IS NULL OR per_call_auto_approval_micros >= 0),
  currency text NOT NULL DEFAULT 'CNY' CHECK (currency ~ '^[A-Z]{3}$'),
  retention_days integer NOT NULL DEFAULT 180 CHECK (retention_days BETWEEN 30 AND 730),
  updated_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, workspace_id, provider),
  FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS commerce_external_data_rate_card (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'justoneapi' CHECK (provider = 'justoneapi'),
  endpoint_id text NOT NULL CHECK (endpoint_id ~ '^[a-z0-9_]+\.[a-zA-Z0-9_.-]+$'),
  vendor_unit_cost_micros bigint CHECK (vendor_unit_cost_micros IS NULL OR vendor_unit_cost_micros >= 0),
  customer_unit_price_micros bigint NOT NULL CHECK (customer_unit_price_micros >= 0),
  currency text NOT NULL DEFAULT 'CNY' CHECK (currency ~ '^[A-Z]{3}$'),
  effective_from timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  effective_until timestamptz,
  created_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE,
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS commerce_external_data_rate_card_current_idx
ON commerce_external_data_rate_card (tenant_id, workspace_id, provider, endpoint_id)
WHERE effective_until IS NULL;

CREATE TABLE IF NOT EXISTS commerce_mcp_access_token (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  created_by_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  token_prefix text NOT NULL CHECK (token_prefix ~ '^cp_[a-zA-Z0-9]{8}$'),
  token_hash bytea NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT ARRAY['external_data.catalog.read']::text[],
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE,
  CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS commerce_mcp_access_token_owner_idx
ON commerce_mcp_access_token (tenant_id, workspace_id, created_by_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS commerce_external_data_call (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  mcp_access_token_id uuid REFERENCES commerce_mcp_access_token(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'justoneapi' CHECK (provider = 'justoneapi'),
  source text NOT NULL CHECK (source IN ('codex_harness', 'external_mcp')),
  root_thread_id text,
  thread_id text,
  turn_id text,
  call_id text NOT NULL CHECK (char_length(call_id) BETWEEN 8 AND 128),
  endpoint_id text NOT NULL CHECK (endpoint_id ~ '^[a-z0-9_]+\.[a-zA-Z0-9_.-]+$'),
  platform text NOT NULL CHECK (platform ~ '^[a-z0-9_]+$'),
  parameter_hash text NOT NULL CHECK (parameter_hash ~ '^[a-f0-9]{64}$'),
  parameter_keys text[] NOT NULL DEFAULT '{}'::text[],
  requested_approval_mode text NOT NULL
    CHECK (requested_approval_mode IN ('always_ask', 'task', 'policy')),
  approval_state text NOT NULL DEFAULT 'pending'
    CHECK (approval_state IN ('pending', 'approved', 'denied', 'not_required')),
  state text NOT NULL DEFAULT 'reserved'
    CHECK (state IN ('reserved', 'dispatched', 'succeeded', 'business_failed', 'unknown', 'cancelled')),
  pricing_status text NOT NULL DEFAULT 'unpriced'
    CHECK (pricing_status IN ('priced', 'unpriced')),
  currency text NOT NULL DEFAULT 'CNY' CHECK (currency ~ '^[A-Z]{3}$'),
  vendor_cost_micros bigint CHECK (vendor_cost_micros IS NULL OR vendor_cost_micros >= 0),
  billable_amount_micros bigint CHECK (billable_amount_micros IS NULL OR billable_amount_micros >= 0),
  upstream_code integer,
  upstream_message text,
  result_bytes integer CHECK (result_bytes IS NULL OR result_bytes >= 0),
  approved_at timestamptz,
  dispatched_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, source, call_id),
  CHECK (
    (source = 'codex_harness' AND root_thread_id IS NOT NULL AND thread_id IS NOT NULL AND turn_id IS NOT NULL)
    OR source = 'external_mcp'
  )
);

CREATE INDEX IF NOT EXISTS commerce_external_data_call_scope_time_idx
ON commerce_external_data_call (tenant_id, workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS commerce_external_data_call_user_time_idx
ON commerce_external_data_call (tenant_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS commerce_external_data_call_billing_idx
ON commerce_external_data_call (tenant_id, workspace_id, state, completed_at)
WHERE state IN ('succeeded', 'business_failed', 'unknown');

INSERT INTO commerce_external_data_policy (tenant_id, workspace_id)
SELECT workspace.tenant_id, workspace.id
FROM commerce_workspace workspace
ON CONFLICT (tenant_id, workspace_id, provider) DO NOTHING;

ALTER TABLE commerce_agent_thread
  DROP CONSTRAINT IF EXISTS commerce_agent_thread_recipe_id_check;
ALTER TABLE commerce_agent_thread
  ADD CONSTRAINT commerce_agent_thread_recipe_id_check
  CHECK (recipe_id IS NULL OR recipe_id IN ('copywriting', 'market_research'));

UPDATE commerce_enterprise_role
SET allowed_permissions = (
      SELECT ARRAY(
        SELECT DISTINCT permission
        FROM unnest(
          allowed_permissions ||
          CASE role_key
            WHEN 'tenant_owner' THEN ARRAY[
              'external_data.catalog.read', 'external_data.call', 'external_data.policy.manage',
              'external_data.usage.read', 'mcp.access_token.manage'
            ]::text[]
            WHEN 'tenant_admin' THEN ARRAY[
              'external_data.catalog.read', 'external_data.call', 'external_data.policy.manage',
              'external_data.usage.read', 'mcp.access_token.manage'
            ]::text[]
            WHEN 'analytics_viewer' THEN ARRAY['external_data.usage.read']::text[]
            WHEN 'workspace_owner' THEN ARRAY[
              'external_data.catalog.read', 'external_data.call',
              'external_data.usage.read', 'mcp.access_token.manage'
            ]::text[]
            WHEN 'workspace_operator' THEN ARRAY[
              'external_data.catalog.read', 'external_data.call',
              'external_data.usage.read', 'mcp.access_token.manage'
            ]::text[]
            WHEN 'workspace_analyst' THEN ARRAY[
              'external_data.catalog.read', 'external_data.usage.read'
            ]::text[]
            ELSE '{}'::text[]
          END
        ) AS permission
        ORDER BY permission
      )
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE is_system = true
  AND role_key IN (
    'tenant_owner', 'tenant_admin', 'analytics_viewer',
    'workspace_owner', 'workspace_operator', 'workspace_analyst'
  );

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'commerce_external_data_policy',
    'commerce_external_data_rate_card',
    'commerce_mcp_access_token',
    'commerce_external_data_call'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', table_name || '_updated_at', table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION commerce_set_updated_at()',
      table_name || '_updated_at',
      table_name
    );
  END LOOP;
END;
$$;

ALTER TABLE commerce_external_data_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_external_data_policy FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_external_data_policy_isolation ON commerce_external_data_policy;
CREATE POLICY commerce_external_data_policy_isolation ON commerce_external_data_policy
USING (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND (
    workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
    OR current_setting('commerce.tenant_wide', true) = 'on'
  )
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND (
    workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
    OR current_setting('commerce.tenant_wide', true) = 'on'
  )
);

ALTER TABLE commerce_external_data_rate_card ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_external_data_rate_card FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_external_data_rate_card_isolation ON commerce_external_data_rate_card;
CREATE POLICY commerce_external_data_rate_card_isolation ON commerce_external_data_rate_card
USING (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND (
    workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
    OR current_setting('commerce.tenant_wide', true) = 'on'
  )
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND (
    workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
    OR current_setting('commerce.tenant_wide', true) = 'on'
  )
);

ALTER TABLE commerce_mcp_access_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_mcp_access_token FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_mcp_access_token_isolation ON commerce_mcp_access_token;
CREATE POLICY commerce_mcp_access_token_isolation ON commerce_mcp_access_token
USING (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND (
    workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
    OR current_setting('commerce.tenant_wide', true) = 'on'
  )
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND (
    workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
    OR current_setting('commerce.tenant_wide', true) = 'on'
  )
);

ALTER TABLE commerce_external_data_call ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_external_data_call FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_external_data_call_isolation ON commerce_external_data_call;
CREATE POLICY commerce_external_data_call_isolation ON commerce_external_data_call
USING (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND (
    workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
    OR current_setting('commerce.tenant_wide', true) = 'on'
  )
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND (
    workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
    OR current_setting('commerce.tenant_wide', true) = 'on'
  )
);

CREATE OR REPLACE FUNCTION commerce_authenticate_mcp_access_token(
  p_token_prefix text,
  p_token_hash_hex text
)
RETURNS TABLE (
  token_id uuid,
  tenant_id uuid,
  workspace_id uuid,
  user_id text,
  scopes text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_token_prefix !~ '^cp_[a-zA-Z0-9]{8}$' OR p_token_hash_hex !~ '^[a-f0-9]{64}$' THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH token_record AS (
    SELECT token.id, token.tenant_id, token.workspace_id,
           token.created_by_user_id, token.scopes
    FROM commerce_mcp_access_token token
    INNER JOIN commerce_tenant tenant
      ON tenant.id = token.tenant_id AND tenant.status = 'active'
    INNER JOIN commerce_organization organization
      ON organization.id = tenant.organization_id AND organization.status = 'active'
    INNER JOIN commerce_workspace workspace
      ON workspace.tenant_id = token.tenant_id
     AND workspace.id = token.workspace_id
     AND workspace.status = 'active'
    INNER JOIN commerce_tenant_membership tenant_member
      ON tenant_member.tenant_id = token.tenant_id
     AND tenant_member.user_id = token.created_by_user_id
     AND tenant_member.status = 'active'
    INNER JOIN commerce_workspace_membership workspace_member
      ON workspace_member.tenant_id = token.tenant_id
     AND workspace_member.workspace_id = token.workspace_id
     AND workspace_member.user_id = token.created_by_user_id
     AND workspace_member.status = 'active'
    INNER JOIN commerce_enterprise_contract contract
      ON contract.tenant_id = token.tenant_id
     AND contract.status = 'active'
     AND contract.effective_from <= CURRENT_TIMESTAMP
     AND (contract.effective_until IS NULL OR contract.effective_until > CURRENT_TIMESTAMP)
    WHERE token.token_prefix = p_token_prefix
      AND token.token_hash = decode(p_token_hash_hex, 'hex')
      AND token.status = 'active'
      AND (token.expires_at IS NULL OR token.expires_at > CURRENT_TIMESTAMP)
    LIMIT 1
  ), effective_roles AS (
    SELECT token.id AS token_id, role.allowed_permissions, role.denied_permissions
    FROM token_record token
    INNER JOIN commerce_user_role_assignment assignment
      ON assignment.tenant_id = token.tenant_id
     AND assignment.user_id = token.created_by_user_id
     AND (assignment.workspace_id IS NULL OR assignment.workspace_id = token.workspace_id)
    INNER JOIN commerce_enterprise_role role
      ON role.tenant_id = assignment.tenant_id AND role.id = assignment.role_id
    UNION ALL
    SELECT token.id AS token_id, role.allowed_permissions, role.denied_permissions
    FROM token_record token
    INNER JOIN commerce_enterprise_group_member member
      ON member.tenant_id = token.tenant_id AND member.user_id = token.created_by_user_id
    INNER JOIN commerce_enterprise_group "group"
      ON "group".tenant_id = member.tenant_id
     AND "group".id = member.group_id
     AND "group".status = 'active'
    INNER JOIN commerce_group_role_assignment assignment
      ON assignment.tenant_id = member.tenant_id
     AND assignment.group_id = member.group_id
     AND (assignment.workspace_id IS NULL OR assignment.workspace_id = token.workspace_id)
    INNER JOIN commerce_enterprise_role role
      ON role.tenant_id = assignment.tenant_id AND role.id = assignment.role_id
  ), permission_state AS (
    SELECT effective_role.token_id,
           array_agg(DISTINCT allowed.value)
             FILTER (WHERE allowed.value IS NOT NULL) AS allowed_permissions,
           array_agg(DISTINCT denied.value)
             FILTER (WHERE denied.value IS NOT NULL) AS denied_permissions
    FROM effective_roles effective_role
    LEFT JOIN LATERAL unnest(effective_role.allowed_permissions) AS allowed(value) ON true
    LEFT JOIN LATERAL unnest(effective_role.denied_permissions) AS denied(value) ON true
    GROUP BY effective_role.token_id
  ), authorized AS (
    SELECT token.id, token.tenant_id, token.workspace_id, token.created_by_user_id,
           ARRAY(
             SELECT requested_scope
             FROM unnest(token.scopes) requested_scope
             WHERE requested_scope = ANY(COALESCE(permission.allowed_permissions, '{}'::text[]))
               AND NOT requested_scope = ANY(COALESCE(permission.denied_permissions, '{}'::text[]))
             ORDER BY requested_scope
           ) AS effective_scopes
    FROM token_record token
    LEFT JOIN permission_state permission ON permission.token_id = token.id
  ), touched AS (
    UPDATE commerce_mcp_access_token token
    SET last_used_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    FROM authorized
    WHERE token.id = authorized.id
      AND cardinality(authorized.effective_scopes) > 0
    RETURNING token.id
  )
  SELECT authorized.id, authorized.tenant_id, authorized.workspace_id,
         authorized.created_by_user_id, authorized.effective_scopes
  FROM authorized
  INNER JOIN touched ON touched.id = authorized.id;
END;
$$;

REVOKE ALL ON FUNCTION commerce_authenticate_mcp_access_token(text, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_pilot_app') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE
      commerce_external_data_policy,
      commerce_external_data_rate_card,
      commerce_mcp_access_token,
      commerce_external_data_call
    TO commerce_pilot_app;
    GRANT DELETE ON TABLE
      commerce_external_data_rate_card,
      commerce_mcp_access_token
    TO commerce_pilot_app;
    GRANT EXECUTE ON FUNCTION commerce_authenticate_mcp_access_token(text, text)
    TO commerce_pilot_app;
  END IF;
END;
$$;
