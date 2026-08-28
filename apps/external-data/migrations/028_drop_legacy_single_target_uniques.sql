ALTER TABLE research_workflow_step_execution
  DROP CONSTRAINT IF EXISTS research_workflow_step_execut_workflow_execution_id_step_id_key;

ALTER TABLE research_workflow_binding_evidence
  DROP CONSTRAINT IF EXISTS research_workflow_binding_evi_workflow_execution_id_binding_key;

COMMENT ON INDEX research_workflow_binding_target_unique IS
  'Each selected workflow target owns one immutable value per provider binding name; multiple representative targets are permitted.';
