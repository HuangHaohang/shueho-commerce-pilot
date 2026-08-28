ALTER TABLE research_workflow_execution
  DROP CONSTRAINT IF EXISTS research_workflow_execution_research_plan_id_fkey;
ALTER TABLE research_workflow_execution
  ADD CONSTRAINT research_workflow_execution_research_plan_id_fkey
    FOREIGN KEY (research_plan_id) REFERENCES marketplace_research_plan(id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE marketplace_research_plan
  DROP CONSTRAINT IF EXISTS marketplace_research_plan_workflow_execution_id_fkey;
ALTER TABLE marketplace_research_plan
  ADD CONSTRAINT marketplace_research_plan_workflow_execution_id_fkey
    FOREIGN KEY (workflow_execution_id) REFERENCES research_workflow_execution(id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

COMMENT ON CONSTRAINT marketplace_research_plan_workflow_execution_id_fkey
ON marketplace_research_plan IS
  'Deferred bidirectional plan/execution ownership link; both rows can be transactionally removed by owner-only maintenance.';
