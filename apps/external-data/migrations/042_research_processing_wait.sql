ALTER TABLE research_task ADD COLUMN processing_wait_started_at timestamptz,ADD COLUMN recovery_failures integer NOT NULL DEFAULT 0 CHECK(recovery_failures>=0);
CREATE OR REPLACE FUNCTION guard_research_task_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR
 (to_jsonb(NEW)-ARRAY['state','lease_id','lease_until','attempts','next_run_at','result','updated_at','cancel_requested_at','approval','last_error_code','processing_wait_started_at','recovery_failures']) IS DISTINCT FROM
 (to_jsonb(OLD)-ARRAY['state','lease_id','lease_until','attempts','next_run_at','result','updated_at','cancel_requested_at','approval','last_error_code','processing_wait_started_at','recovery_failures'])
 THEN RAISE EXCEPTION 'Research task input is immutable'; END IF;
 IF OLD.state IN ('completed','partial','failed','reconciliation_required','cancelled') THEN RAISE EXCEPTION 'Research task terminal receipt is immutable'; END IF;
 RETURN NEW;
END $$;
