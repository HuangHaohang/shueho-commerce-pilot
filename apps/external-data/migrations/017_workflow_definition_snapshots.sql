ALTER TABLE research_workflow_execution
  ADD COLUMN IF NOT EXISTS workflow_definition_sha256 text;

UPDATE research_workflow_execution execution
SET workflow_definition_sha256 = workflow.definition_sha256
FROM provider_business_workflow workflow
WHERE workflow.workflow_id = execution.workflow_id
  AND execution.workflow_definition_sha256 IS NULL;

ALTER TABLE research_workflow_execution
  ALTER COLUMN workflow_definition_sha256 SET NOT NULL;

ALTER TABLE research_workflow_execution
  DROP CONSTRAINT IF EXISTS research_workflow_execution_definition_sha256_check;
ALTER TABLE research_workflow_execution
  ADD CONSTRAINT research_workflow_execution_definition_sha256_check
    CHECK (workflow_definition_sha256 ~ '^[a-f0-9]{64}$');

ALTER TABLE research_workflow_step_execution
  ADD COLUMN IF NOT EXISTS input_bindings jsonb,
  ADD COLUMN IF NOT EXISTS output_bindings jsonb;

UPDATE research_workflow_step_execution execution_step
SET input_bindings = definition.input_bindings,
    output_bindings = definition.output_bindings
FROM research_workflow_execution execution
JOIN provider_business_workflow_step definition
  ON definition.workflow_id = execution.workflow_id
WHERE execution.id = execution_step.workflow_execution_id
  AND definition.step_id = execution_step.step_id
  AND (execution_step.input_bindings IS NULL OR execution_step.output_bindings IS NULL);

ALTER TABLE research_workflow_step_execution
  ALTER COLUMN input_bindings SET NOT NULL,
  ALTER COLUMN output_bindings SET NOT NULL;

ALTER TABLE research_workflow_step_execution
  DROP CONSTRAINT IF EXISTS research_workflow_step_execution_input_bindings_check,
  DROP CONSTRAINT IF EXISTS research_workflow_step_execution_output_bindings_check;
ALTER TABLE research_workflow_step_execution
  ADD CONSTRAINT research_workflow_step_execution_input_bindings_check
    CHECK (jsonb_typeof(input_bindings) = 'object'),
  ADD CONSTRAINT research_workflow_step_execution_output_bindings_check
    CHECK (jsonb_typeof(output_bindings) = 'array');

COMMENT ON COLUMN research_workflow_execution.workflow_definition_sha256 IS
  'Exact immutable workflow definition selected during preflight; later catalog imports cannot change this execution.';
COMMENT ON COLUMN research_workflow_step_execution.output_bindings IS
  'Execution-time snapshot of identifier aliases and types used to prove downstream provider bindings.';
