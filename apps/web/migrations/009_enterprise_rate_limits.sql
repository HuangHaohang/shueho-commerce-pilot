CREATE TABLE IF NOT EXISTS commerce_enterprise_rate_limit (
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  bucket text NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, workspace_id, user_id, bucket),
  FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE commerce_enterprise_rate_limit ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_enterprise_rate_limit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_enterprise_rate_limit_isolation ON commerce_enterprise_rate_limit;
CREATE POLICY commerce_enterprise_rate_limit_isolation ON commerce_enterprise_rate_limit
USING (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_pilot_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE commerce_enterprise_rate_limit TO commerce_pilot_app;
  END IF;
END;
$$;
