ALTER TABLE commerce_agent_usage_event
  ADD COLUMN IF NOT EXISTS usage_status text NOT NULL DEFAULT 'reported';

ALTER TABLE commerce_agent_usage_event
  DROP CONSTRAINT IF EXISTS commerce_agent_usage_status_check;
ALTER TABLE commerce_agent_usage_event
  ADD CONSTRAINT commerce_agent_usage_status_check
  CHECK (usage_status IN ('reported', 'missing'));

DROP POLICY IF EXISTS commerce_enterprise_invitation_manage ON commerce_enterprise_invitation;
CREATE POLICY commerce_enterprise_invitation_manage ON commerce_enterprise_invitation
FOR ALL USING (
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
