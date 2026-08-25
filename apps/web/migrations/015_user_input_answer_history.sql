CREATE TABLE IF NOT EXISTS commerce_agent_user_input_answer (
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES commerce_workspace(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  thread_id text NOT NULL REFERENCES commerce_agent_thread(thread_id) ON DELETE CASCADE,
  turn_id text NOT NULL,
  request_id text NOT NULL,
  item_id text NOT NULL,
  answer_message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (thread_id, request_id),
  CHECK (char_length(request_id) BETWEEN 1 AND 128),
  CHECK (char_length(turn_id) BETWEEN 8 AND 128),
  CHECK (char_length(item_id) BETWEEN 1 AND 128),
  CHECK (char_length(answer_message) BETWEEN 1 AND 8000)
);

CREATE INDEX IF NOT EXISTS commerce_agent_user_input_answer_order_idx
ON commerce_agent_user_input_answer (tenant_id, workspace_id, user_id, thread_id, created_at, request_id);

ALTER TABLE commerce_agent_user_input_answer ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_agent_user_input_answer FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_agent_user_input_answer_isolation ON commerce_agent_user_input_answer;
CREATE POLICY commerce_agent_user_input_answer_isolation ON commerce_agent_user_input_answer
USING (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
  AND user_id = NULLIF(current_setting('commerce.user_id', true), '')
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
  AND user_id = NULLIF(current_setting('commerce.user_id', true), '')
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_pilot_app') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE commerce_agent_user_input_answer TO commerce_pilot_app;
  END IF;
END;
$$;
