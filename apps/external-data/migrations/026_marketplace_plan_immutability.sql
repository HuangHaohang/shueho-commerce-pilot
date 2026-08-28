ALTER TABLE research_workflow_execution
  DROP CONSTRAINT IF EXISTS research_workflow_execution_research_plan_id_fkey;
ALTER TABLE research_workflow_execution
  ADD CONSTRAINT research_workflow_execution_research_plan_id_fkey
    FOREIGN KEY (research_plan_id) REFERENCES marketplace_research_plan(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE marketplace_research_plan
  DROP CONSTRAINT IF EXISTS marketplace_research_plan_workflow_execution_id_fkey;
ALTER TABLE marketplace_research_plan
  ADD CONSTRAINT marketplace_research_plan_workflow_execution_id_fkey
    FOREIGN KEY (workflow_execution_id) REFERENCES research_workflow_execution(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION external_data_enforce_marketplace_plan_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id
     OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.user_id <> OLD.user_id
     OR NEW.source <> OLD.source
     OR NEW.source_call_id <> OLD.source_call_id
     OR NEW.root_thread_id IS DISTINCT FROM OLD.root_thread_id
     OR NEW.thread_id IS DISTINCT FROM OLD.thread_id
     OR NEW.turn_id IS DISTINCT FROM OLD.turn_id
     OR NEW.workflow_id <> OLD.workflow_id
     OR NEW.workflow_version <> OLD.workflow_version
     OR NEW.workflow_definition_sha256 <> OLD.workflow_definition_sha256
     OR NEW.source_catalog_import_id <> OLD.source_catalog_import_id
     OR NEW.market_profile_id IS DISTINCT FROM OLD.market_profile_id
     OR NEW.market_profile_sha256 IS DISTINCT FROM OLD.market_profile_sha256
     OR NEW.plan_key <> OLD.plan_key
     OR NEW.request_text <> OLD.request_text
     OR NEW.requested_input <> OLD.requested_input
     OR NEW.normalized_input <> OLD.normalized_input
     OR NEW.market_context <> OLD.market_context
     OR NEW.business_intent <> OLD.business_intent
     OR NEW.plan_coverage <> OLD.plan_coverage
     OR NEW.step_templates <> OLD.step_templates
     OR NEW.detail_sample_size <> OLD.detail_sample_size
     OR NEW.estimated_provider_calls <> OLD.estimated_provider_calls
     OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION 'marketplace research plan identity is immutable';
  END IF;
  IF OLD.state IN ('completed','partial','failed','cancelled','expired') THEN
    RAISE EXCEPTION 'terminal marketplace research plans are immutable';
  END IF;
  IF NOT (
    (OLD.state='ready' AND NEW.state IN ('executing','cancelled','expired'))
    OR (OLD.state='executing' AND NEW.state IN ('executing','completed','partial','failed','cancelled'))
  ) THEN
    RAISE EXCEPTION 'invalid marketplace research plan transition % -> %',OLD.state,NEW.state;
  END IF;
  IF OLD.workflow_execution_id IS NOT NULL
     AND NEW.workflow_execution_id IS DISTINCT FROM OLD.workflow_execution_id THEN
    RAISE EXCEPTION 'marketplace research plan execution binding is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS marketplace_research_plan_update_guard
ON marketplace_research_plan;
CREATE TRIGGER marketplace_research_plan_update_guard
BEFORE UPDATE ON marketplace_research_plan
FOR EACH ROW EXECUTE FUNCTION external_data_enforce_marketplace_plan_update();

REVOKE ALL ON FUNCTION external_data_enforce_marketplace_plan_update() FROM PUBLIC;

CREATE OR REPLACE FUNCTION external_data_enforce_workflow_target_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'research workflow targets are immutable';
END;
$$;

DROP TRIGGER IF EXISTS research_workflow_target_immutable
ON research_workflow_target;
CREATE TRIGGER research_workflow_target_immutable
BEFORE UPDATE ON research_workflow_target
FOR EACH ROW EXECUTE FUNCTION external_data_enforce_workflow_target_immutability();

REVOKE ALL ON FUNCTION external_data_enforce_workflow_target_immutability() FROM PUBLIC;
