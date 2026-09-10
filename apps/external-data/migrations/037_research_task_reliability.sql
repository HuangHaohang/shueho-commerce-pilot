ALTER TABLE research_task ADD COLUMN execution_version integer NOT NULL DEFAULT 1,
 ADD COLUMN cancel_requested_at timestamptz, ADD COLUMN approval jsonb,
 ADD COLUMN last_error_code text, ADD COLUMN expires_at timestamptz;
ALTER TABLE research_task ALTER COLUMN execution_version SET DEFAULT 2;
ALTER TABLE research_task DROP CONSTRAINT research_task_state_check;
ALTER TABLE research_task ADD CONSTRAINT research_task_state_check CHECK(state IN
 ('queued','running','waiting_approval','completed','partial','failed','reconciliation_required','cancelled'));
CREATE TABLE research_task_claim_receipt (
 lease_id uuid PRIMARY KEY, task_id uuid REFERENCES research_task(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
REVOKE ALL ON research_task_claim_receipt FROM PUBLIC,external_data_app;
CREATE OR REPLACE FUNCTION claim_research_task(worker_lease uuid) RETURNS SETOF research_task
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE claimed_id uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('research-claim:'||worker_lease::text,0));
 IF EXISTS(SELECT 1 FROM research_task_claim_receipt WHERE lease_id=worker_lease) THEN
  RETURN QUERY SELECT t.* FROM research_task t JOIN research_task_claim_receipt c ON c.task_id=t.id
   WHERE c.lease_id=worker_lease AND t.lease_id=worker_lease AND t.state='running' AND t.lease_until>clock_timestamp();
  RETURN;
 END IF;
 SELECT id INTO claimed_id FROM research_task WHERE cancel_requested_at IS NULL AND next_run_at<=clock_timestamp()
  AND (state='queued' OR (state='running' AND lease_until<clock_timestamp())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 INSERT INTO research_task_claim_receipt(lease_id,task_id) VALUES(worker_lease,claimed_id);
 IF claimed_id IS NULL THEN RETURN; END IF;
 RETURN QUERY UPDATE research_task SET state='running',lease_id=worker_lease,lease_until=clock_timestamp()+INTERVAL '90 seconds',
  attempts=attempts+1,updated_at=clock_timestamp() WHERE id=claimed_id RETURNING *;
END $$;
CREATE OR REPLACE FUNCTION guard_research_task_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR
 (to_jsonb(NEW)-ARRAY['state','lease_id','lease_until','attempts','next_run_at','result','updated_at','cancel_requested_at','approval','last_error_code']) IS DISTINCT FROM
 (to_jsonb(OLD)-ARRAY['state','lease_id','lease_until','attempts','next_run_at','result','updated_at','cancel_requested_at','approval','last_error_code'])
 THEN RAISE EXCEPTION 'Research task input is immutable'; END IF;
 IF OLD.state IN ('completed','partial','failed','reconciliation_required','cancelled') THEN RAISE EXCEPTION 'Research task terminal receipt is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TABLE research_task_readback_correction (
 task_id uuid PRIMARY KEY REFERENCES research_task(id), state text NOT NULL CHECK(state='reconciliation_required'),
 reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO research_task_readback_correction(task_id,state,reason)
 SELECT id,'reconciliation_required','Unknown provider outcome was previously classified as a generic failure'
 FROM research_task WHERE state='failed' AND result#>>'{error,code}' IN ('DATA_EXECUTION_UNCERTAIN','DATA_RESULT_UNKNOWN','UPSTREAM_RESULT_UNKNOWN','RESULT_UNKNOWN');
ALTER TABLE research_task_readback_correction ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_task_readback_correction FORCE ROW LEVEL SECURITY;
CREATE POLICY research_task_correction_scope ON research_task_readback_correction USING(EXISTS(SELECT 1 FROM research_task WHERE id=task_id));
REVOKE ALL ON research_task_readback_correction FROM PUBLIC;
GRANT SELECT ON research_task_readback_correction TO external_data_app;
CREATE TRIGGER research_task_correction_immutable BEFORE UPDATE OR DELETE ON research_task_readback_correction
 FOR EACH ROW EXECUTE FUNCTION justoneapi_guard_immutable_records();
CREATE FUNCTION research_queue_health() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('queued',count(*) FILTER(WHERE state='queued'),'running',count(*) FILTER(WHERE state='running'),
 'expiredLeases',count(*) FILTER(WHERE state='running' AND lease_until<clock_timestamp()),
 'waitingApproval',count(*) FILTER(WHERE state='waiting_approval'),
 'reconciliationRequired',count(*) FILTER(WHERE state='reconciliation_required' OR id IN(SELECT task_id FROM research_task_readback_correction)),
 'oldestQueuedSeconds',COALESCE(EXTRACT(EPOCH FROM clock_timestamp()-min(created_at) FILTER(WHERE state='queued')),0),
 'secondsSinceWorkerPoll',(SELECT EXTRACT(EPOCH FROM clock_timestamp()-max(created_at)) FROM research_task_claim_receipt)) FROM research_task;
$$;
REVOKE ALL ON FUNCTION research_queue_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION research_queue_health() TO external_data_app;
