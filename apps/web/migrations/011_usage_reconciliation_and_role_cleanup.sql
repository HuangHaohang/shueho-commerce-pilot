ALTER TABLE commerce_agent_usage_event
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reconciliation_reason text;

ALTER TABLE commerce_agent_usage_event
  DROP CONSTRAINT IF EXISTS commerce_agent_usage_reconciliation_check;
ALTER TABLE commerce_agent_usage_event
  ADD CONSTRAINT commerce_agent_usage_reconciliation_check
  CHECK (
    (reconciled_at IS NULL AND reconciled_by_user_id IS NULL AND reconciliation_reason IS NULL)
    OR (reconciled_at IS NOT NULL AND reconciliation_reason IS NOT NULL)
  );

UPDATE commerce_enterprise_role
SET allowed_permissions = ARRAY[
      'thread.create', 'thread.read.own', 'thread.interrupt', 'thread.compact',
      'queue.manage', 'artifact.read', 'agent.run', 'workspaces.read', 'usage.read'
    ]::text[],
    description = '运行和管理自己的工作区 Agent；租户成员与工作区生命周期由企业管理员管理。',
    updated_at = CURRENT_TIMESTAMP
WHERE is_system AND role_key = 'workspace_owner' AND scope = 'workspace';
