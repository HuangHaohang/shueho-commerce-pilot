CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS commerce_tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  edition text NOT NULL DEFAULT 'enterprise' CHECK (edition = 'enterprise'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'suspended', 'terminated')),
  data_region text NOT NULL DEFAULT 'default',
  created_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, slug)
);

CREATE UNIQUE INDEX IF NOT EXISTS commerce_tenant_slug_lower_idx
ON commerce_tenant (lower(slug));

CREATE TABLE IF NOT EXISTS commerce_workspace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  is_default boolean NOT NULL DEFAULT false,
  created_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS commerce_workspace_slug_lower_idx
ON commerce_workspace (tenant_id, lower(slug));
CREATE UNIQUE INDEX IF NOT EXISTS commerce_workspace_default_idx
ON commerce_workspace (tenant_id) WHERE is_default AND status = 'active';

CREATE TABLE IF NOT EXISTS commerce_tenant_membership (
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended', 'removed')),
  seat_type text NOT NULL DEFAULT 'enterprise' CHECK (seat_type = 'enterprise'),
  is_default boolean NOT NULL DEFAULT false,
  invited_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS commerce_tenant_membership_user_idx
ON commerce_tenant_membership (user_id, status, is_default DESC);
CREATE UNIQUE INDEX IF NOT EXISTS commerce_tenant_membership_default_idx
ON commerce_tenant_membership (user_id) WHERE is_default AND status = 'active';

CREATE TABLE IF NOT EXISTS commerce_workspace_membership (
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'removed')),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, workspace_id, user_id),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, user_id) REFERENCES commerce_tenant_membership(tenant_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS commerce_workspace_membership_user_idx
ON commerce_workspace_membership (user_id, status, is_default DESC);
CREATE UNIQUE INDEX IF NOT EXISTS commerce_workspace_membership_default_idx
ON commerce_workspace_membership (tenant_id, user_id)
WHERE is_default AND status = 'active';

CREATE TABLE IF NOT EXISTS commerce_enterprise_role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('tenant', 'workspace')),
  role_key text NOT NULL,
  name text NOT NULL,
  description text,
  allowed_permissions text[] NOT NULL DEFAULT '{}',
  denied_permissions text[] NOT NULL DEFAULT '{}',
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, scope, role_key),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS commerce_user_role_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id text NOT NULL,
  role_id uuid NOT NULL,
  workspace_id uuid,
  assigned_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id, user_id) REFERENCES commerce_tenant_membership(tenant_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, role_id) REFERENCES commerce_enterprise_role(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS commerce_user_tenant_role_assignment_idx
ON commerce_user_role_assignment (tenant_id, user_id, role_id)
WHERE workspace_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS commerce_user_workspace_role_assignment_idx
ON commerce_user_role_assignment (tenant_id, workspace_id, user_id, role_id)
WHERE workspace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS commerce_enterprise_group (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  name text NOT NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'scim')),
  external_id text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS commerce_enterprise_group_name_idx
ON commerce_enterprise_group (tenant_id, lower(name)) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS commerce_enterprise_group_external_idx
ON commerce_enterprise_group (tenant_id, source, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS commerce_enterprise_group_member (
  tenant_id uuid NOT NULL,
  group_id uuid NOT NULL,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, group_id, user_id),
  FOREIGN KEY (tenant_id, group_id) REFERENCES commerce_enterprise_group(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, user_id) REFERENCES commerce_tenant_membership(tenant_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS commerce_group_role_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  group_id uuid NOT NULL,
  role_id uuid NOT NULL,
  workspace_id uuid,
  assigned_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id, group_id) REFERENCES commerce_enterprise_group(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, role_id) REFERENCES commerce_enterprise_role(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS commerce_group_tenant_role_assignment_idx
ON commerce_group_role_assignment (tenant_id, group_id, role_id)
WHERE workspace_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS commerce_group_workspace_role_assignment_idx
ON commerce_group_role_assignment (tenant_id, workspace_id, group_id, role_id)
WHERE workspace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS commerce_enterprise_contract (
  tenant_id uuid PRIMARY KEY REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'terminated')),
  seat_limit integer NOT NULL CHECK (seat_limit > 0),
  workspace_limit integer NOT NULL CHECK (workspace_limit > 0),
  monthly_total_token_limit bigint CHECK (monthly_total_token_limit IS NULL OR monthly_total_token_limit > 0),
  monthly_model_request_limit bigint CHECK (monthly_model_request_limit IS NULL OR monthly_model_request_limit > 0),
  concurrent_turn_limit integer NOT NULL CHECK (concurrent_turn_limit > 0),
  concurrent_turn_limit_per_workspace integer NOT NULL CHECK (concurrent_turn_limit_per_workspace > 0),
  concurrent_turn_limit_per_user integer NOT NULL CHECK (concurrent_turn_limit_per_user > 0),
  billing_anchor_day integer NOT NULL DEFAULT 1 CHECK (billing_anchor_day BETWEEN 1 AND 28),
  effective_from timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  effective_until timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE TABLE IF NOT EXISTS commerce_tenant_runtime (
  tenant_id uuid PRIMARY KEY REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  isolation_mode text NOT NULL DEFAULT 'dedicated' CHECK (isolation_mode = 'dedicated'),
  runtime_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning', 'ready', 'degraded', 'disabled')),
  region text NOT NULL DEFAULT 'default',
  last_heartbeat_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS commerce_enterprise_invitation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid,
  normalized_email text NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  role_keys text[] NOT NULL DEFAULT '{}',
  invited_by_user_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  accepted_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS commerce_enterprise_invitation_lookup_idx
ON commerce_enterprise_invitation (tenant_id, lower(normalized_email), status, expires_at);

ALTER TABLE commerce_agent_thread
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS workspace_id uuid,
  ADD COLUMN IF NOT EXISTS created_by_user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';

ALTER TABLE commerce_agent_thread
  DROP CONSTRAINT IF EXISTS commerce_agent_thread_visibility_check;
ALTER TABLE commerce_agent_thread
  ADD CONSTRAINT commerce_agent_thread_visibility_check
  CHECK (visibility IN ('private', 'workspace'));

ALTER TABLE commerce_agent_thread
  DROP CONSTRAINT IF EXISTS commerce_agent_thread_workspace_fk;
ALTER TABLE commerce_agent_thread
  ADD CONSTRAINT commerce_agent_thread_workspace_fk
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE
  NOT VALID;

CREATE INDEX IF NOT EXISTS commerce_agent_thread_tenant_workspace_user_idx
ON commerce_agent_thread (tenant_id, workspace_id, created_by_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS commerce_agent_thread_tenant_workspace_status_idx
ON commerce_agent_thread (tenant_id, workspace_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS commerce_agent_usage_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  root_thread_id text NOT NULL,
  thread_id text NOT NULL,
  parent_thread_id text,
  turn_id text NOT NULL,
  response_id text NOT NULL,
  provider_id text NOT NULL,
  model text,
  total_tokens bigint NOT NULL CHECK (total_tokens >= 0),
  input_tokens bigint NOT NULL CHECK (input_tokens >= 0),
  cached_input_tokens bigint NOT NULL CHECK (cached_input_tokens >= 0),
  cache_write_input_tokens bigint NOT NULL CHECK (cache_write_input_tokens >= 0),
  output_tokens bigint NOT NULL CHECK (output_tokens >= 0),
  reasoning_output_tokens bigint NOT NULL CHECK (reasoning_output_tokens >= 0),
  occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, provider_id, response_id),
  CHECK (cached_input_tokens + cache_write_input_tokens <= input_tokens),
  CHECK (reasoning_output_tokens <= output_tokens)
);

CREATE INDEX IF NOT EXISTS commerce_agent_usage_scope_time_idx
ON commerce_agent_usage_event (tenant_id, workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS commerce_agent_usage_user_time_idx
ON commerce_agent_usage_event (tenant_id, user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS commerce_agent_usage_root_thread_idx
ON commerce_agent_usage_event (tenant_id, root_thread_id, occurred_at);

CREATE TABLE IF NOT EXISTS commerce_agent_turn_lease (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  thread_id text NOT NULL,
  turn_id text,
  request_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'active', 'released', 'expired')),
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS commerce_agent_turn_lease_turn_idx
ON commerce_agent_turn_lease (tenant_id, thread_id, turn_id)
WHERE turn_id IS NOT NULL AND state IN ('reserved', 'active');
CREATE INDEX IF NOT EXISTS commerce_agent_turn_lease_active_scope_idx
ON commerce_agent_turn_lease (tenant_id, workspace_id, user_id, expires_at)
WHERE state IN ('reserved', 'active');

CREATE TABLE IF NOT EXISTS commerce_enterprise_audit_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid,
  actor_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied', 'succeeded', 'failed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE,
  CHECK (octet_length(metadata::text) <= 16384)
);

CREATE INDEX IF NOT EXISTS commerce_enterprise_audit_scope_time_idx
ON commerce_enterprise_audit_event (tenant_id, workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS commerce_enterprise_audit_actor_time_idx
ON commerce_enterprise_audit_event (tenant_id, actor_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS commerce_idempotency_record (
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  operation text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  response_status integer,
  response_body jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, operation, idempotency_key),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS commerce_idempotency_expiry_idx
ON commerce_idempotency_record (expires_at);

CREATE OR REPLACE FUNCTION commerce_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'commerce_tenant',
    'commerce_workspace',
    'commerce_tenant_membership',
    'commerce_workspace_membership',
    'commerce_enterprise_role',
    'commerce_enterprise_group',
    'commerce_enterprise_contract',
    'commerce_tenant_runtime',
    'commerce_agent_turn_lease',
    'commerce_idempotency_record'
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

ALTER TABLE commerce_agent_thread ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_agent_thread FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_agent_thread_isolation ON commerce_agent_thread;
CREATE POLICY commerce_agent_thread_isolation ON commerce_agent_thread
USING (
  (
    tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
    AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
  )
  OR (
    tenant_id IS NULL
    AND user_id = NULLIF(current_setting('commerce.user_id', true), '')
  )
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
);

ALTER TABLE commerce_agent_usage_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_agent_usage_event FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_agent_usage_isolation ON commerce_agent_usage_event;
CREATE POLICY commerce_agent_usage_isolation ON commerce_agent_usage_event
USING (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
);

ALTER TABLE commerce_agent_turn_lease ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_agent_turn_lease FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_agent_turn_lease_isolation ON commerce_agent_turn_lease;
CREATE POLICY commerce_agent_turn_lease_isolation ON commerce_agent_turn_lease
USING (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
);

ALTER TABLE commerce_enterprise_audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_enterprise_audit_event FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_enterprise_audit_isolation ON commerce_enterprise_audit_event;
CREATE POLICY commerce_enterprise_audit_isolation ON commerce_enterprise_audit_event
USING (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND (
    workspace_id IS NULL
    OR workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
  )
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND (
    workspace_id IS NULL
    OR workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
  )
);
