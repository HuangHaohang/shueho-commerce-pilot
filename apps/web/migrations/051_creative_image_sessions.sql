CREATE TABLE commerce_creative_image_session (
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id text NOT NULL,
  project_thread_id text NOT NULL REFERENCES commerce_agent_thread(thread_id) ON DELETE CASCADE,
  source_filename text NOT NULL,
  thread_id text NOT NULL UNIQUE REFERENCES commerce_agent_thread(thread_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_thread_id, source_filename)
);
ALTER TABLE commerce_creative_image_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_creative_image_session FORCE ROW LEVEL SECURITY;
CREATE POLICY image_session_isolation ON commerce_creative_image_session USING (
 tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
 AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
 AND user_id = NULLIF(current_setting('commerce.user_id', true), '')
) WITH CHECK (
 tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
 AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
 AND user_id = NULLIF(current_setting('commerce.user_id', true), '')
);
REVOKE ALL ON commerce_creative_image_session FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_pilot_app') THEN
  GRANT SELECT, INSERT, DELETE ON commerce_creative_image_session TO commerce_pilot_app;
 END IF;
END $$;
