ALTER TABLE commerce_external_data_call
  ADD COLUMN IF NOT EXISTS marketplace_plan_id uuid,
  ADD COLUMN IF NOT EXISTS workflow_step_instance_id uuid,
  ADD COLUMN IF NOT EXISTS workflow_target_id uuid,
  ADD COLUMN IF NOT EXISTS workflow_role text;

ALTER TABLE commerce_external_data_call
  DROP CONSTRAINT IF EXISTS commerce_external_data_call_workflow_role_check;
ALTER TABLE commerce_external_data_call
  ADD CONSTRAINT commerce_external_data_call_workflow_role_check
    CHECK (workflow_role IS NULL OR workflow_role IN ('discovery','detail','price','reviews','sku'));

CREATE INDEX IF NOT EXISTS commerce_external_data_call_plan_idx
ON commerce_external_data_call (tenant_id,workspace_id,marketplace_plan_id,created_at)
WHERE marketplace_plan_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS commerce_external_data_call_step_instance_unique
ON commerce_external_data_call (tenant_id,source,workflow_step_instance_id)
WHERE workflow_step_instance_id IS NOT NULL;

COMMENT ON COLUMN commerce_external_data_call.marketplace_plan_id IS
  'Opaque independent-warehouse plan UUID used to correlate the no-reservation quote, per-step reservations and settlements.';
COMMENT ON COLUMN commerce_external_data_call.workflow_step_instance_id IS
  'Opaque target-specific workflow step UUID; one provider reservation and exact-once dispatch per instance.';
