CREATE TABLE research_task_failure_resolution(
 task_id uuid PRIMARY KEY REFERENCES research_task(id),failure_code text NOT NULL CHECK(failure_code ~ '^[A-Z0-9_]+$'),message text NOT NULL,
 evidence jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE research_task_failure_resolution ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_task_failure_resolution FORCE ROW LEVEL SECURITY;
CREATE POLICY task_failure_resolution_scope ON research_task_failure_resolution USING(EXISTS(SELECT 1 FROM research_task WHERE id=task_id));
REVOKE ALL ON research_task_failure_resolution FROM PUBLIC;
GRANT SELECT ON research_task_failure_resolution TO external_data_app;
CREATE TRIGGER task_failure_resolution_immutable BEFORE UPDATE OR DELETE ON research_task_failure_resolution FOR EACH ROW EXECUTE FUNCTION justoneapi_guard_immutable_records();
CREATE OR REPLACE FUNCTION research_queue_health() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('queued',count(*) FILTER(WHERE state='queued'),'running',count(*) FILTER(WHERE state='running'),
 'expiredLeases',count(*) FILTER(WHERE state='running' AND lease_until<clock_timestamp()),
 'waitingApproval',count(*) FILTER(WHERE state='waiting_approval'),
 'reconciliationRequired',count(*) FILTER(WHERE (state='reconciliation_required' OR id IN(SELECT task_id FROM research_task_readback_correction)) AND id NOT IN(SELECT task_id FROM research_task_failure_resolution)),
 'oldestQueuedSeconds',COALESCE(EXTRACT(EPOCH FROM clock_timestamp()-min(created_at) FILTER(WHERE state='queued')),0),
 'secondsSinceWorkerPoll',(SELECT EXTRACT(EPOCH FROM clock_timestamp()-max(created_at)) FROM research_task_claim_receipt)) FROM research_task;
$$;
REVOKE ALL ON FUNCTION research_queue_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION research_queue_health() TO external_data_app;
CREATE FUNCTION guard_non_dispatch_resolution() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM research_task WHERE id=NEW.task_id AND state IN ('failed','reconciliation_required'))
 OR NOT EXISTS(SELECT 1 FROM research_task_operation WHERE task_id=NEW.task_id AND operation_name='control.reserve' AND state='started')
 OR EXISTS(SELECT 1 FROM research_task_operation WHERE task_id=NEW.task_id AND (operation_name LIKE 'upstream.%' OR operation_name='control.dispatch'))
 OR EXISTS(SELECT 1 FROM research_request r JOIN research_task t ON r.tenant_id=t.tenant_id AND r.workspace_id=t.workspace_id
 JOIN research_task_operation o ON o.task_id=t.id AND r.source_call_id=o.operation_context->>'callId' WHERE t.id=NEW.task_id)
 THEN RAISE EXCEPTION 'NON_DISPATCH_NOT_PROVEN';END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_non_dispatch_resolution() FROM PUBLIC;
CREATE TRIGGER task_failure_resolution_proof BEFORE INSERT ON research_task_failure_resolution FOR EACH ROW EXECUTE FUNCTION guard_non_dispatch_resolution();
