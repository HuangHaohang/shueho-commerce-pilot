CREATE TABLE IF NOT EXISTS commerce_agent_message_feedback (
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES commerce_workspace(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  thread_id text NOT NULL REFERENCES commerce_agent_thread(thread_id) ON DELETE CASCADE,
  turn_id text NOT NULL,
  message_item_id text NOT NULL,
  rating text NOT NULL CHECK (rating IN ('positive', 'negative')),
  message_content_hash text NOT NULL CHECK (message_content_hash ~ '^[a-f0-9]{64}$'),
  model text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (thread_id, user_id, message_item_id),
  CHECK (char_length(turn_id) BETWEEN 8 AND 128),
  CHECK (char_length(message_item_id) BETWEEN 1 AND 128),
  CHECK (model IS NULL OR char_length(model) BETWEEN 1 AND 128)
);

CREATE TABLE IF NOT EXISTS commerce_agent_message_feedback_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES commerce_workspace(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  thread_id text NOT NULL REFERENCES commerce_agent_thread(thread_id) ON DELETE CASCADE,
  turn_id text NOT NULL,
  message_item_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('set', 'clear')),
  rating text CHECK (rating IN ('positive', 'negative')),
  message_content_hash text NOT NULL CHECK (message_content_hash ~ '^[a-f0-9]{64}$'),
  model text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (action = 'set' AND rating IS NOT NULL)
    OR (action = 'clear' AND rating IS NULL)
  ),
  CHECK (char_length(turn_id) BETWEEN 8 AND 128),
  CHECK (char_length(message_item_id) BETWEEN 1 AND 128),
  CHECK (model IS NULL OR char_length(model) BETWEEN 1 AND 128)
);

CREATE INDEX IF NOT EXISTS commerce_agent_message_feedback_analysis_idx
ON commerce_agent_message_feedback (tenant_id, workspace_id, rating, model, updated_at DESC);

CREATE INDEX IF NOT EXISTS commerce_agent_message_feedback_event_order_idx
ON commerce_agent_message_feedback_event
  (tenant_id, workspace_id, user_id, thread_id, message_item_id, created_at DESC);

DROP TRIGGER IF EXISTS commerce_agent_message_feedback_updated_at
ON commerce_agent_message_feedback;
CREATE TRIGGER commerce_agent_message_feedback_updated_at
BEFORE UPDATE ON commerce_agent_message_feedback
FOR EACH ROW EXECUTE FUNCTION commerce_set_updated_at();

ALTER TABLE commerce_agent_message_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_agent_message_feedback FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_agent_message_feedback_isolation
ON commerce_agent_message_feedback;
CREATE POLICY commerce_agent_message_feedback_isolation
ON commerce_agent_message_feedback
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

ALTER TABLE commerce_agent_message_feedback_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_agent_message_feedback_event FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_agent_message_feedback_event_isolation
ON commerce_agent_message_feedback_event;
CREATE POLICY commerce_agent_message_feedback_event_isolation
ON commerce_agent_message_feedback_event
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
    GRANT SELECT, INSERT, UPDATE, DELETE
    ON commerce_agent_message_feedback TO commerce_pilot_app;
    GRANT SELECT, INSERT
    ON commerce_agent_message_feedback_event TO commerce_pilot_app;
  END IF;
END;
$$;
