-- Invitation payloads store role keys, so a key must identify exactly one role
-- inside a tenant regardless of role scope.
CREATE UNIQUE INDEX IF NOT EXISTS commerce_enterprise_role_tenant_key_idx
ON commerce_enterprise_role (tenant_id, role_key);

ALTER TABLE commerce_agent_thread
  ADD COLUMN IF NOT EXISTS last_terminal_turn_id text,
  ADD COLUMN IF NOT EXISTS last_terminal_at timestamptz;

CREATE TABLE IF NOT EXISTS commerce_agent_turn_completion (
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  root_thread_id text NOT NULL,
  turn_id text NOT NULL,
  event_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('completed', 'interrupted', 'failed')),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, root_thread_id, turn_id),
  UNIQUE (tenant_id, event_id),
  FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS commerce_agent_turn_completion_scope_time_idx
ON commerce_agent_turn_completion (tenant_id, workspace_id, recorded_at DESC);

ALTER TABLE commerce_agent_turn_completion ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_agent_turn_completion FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_agent_turn_completion_isolation ON commerce_agent_turn_completion;
CREATE POLICY commerce_agent_turn_completion_isolation ON commerce_agent_turn_completion
USING (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
);
