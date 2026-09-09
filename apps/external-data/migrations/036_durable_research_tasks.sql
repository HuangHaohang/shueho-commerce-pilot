CREATE TABLE research_task (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, user_id text NOT NULL,
 source text NOT NULL CHECK(source IN ('external_mcp','codex_harness')), idempotency_key uuid NOT NULL,
 input_hash text NOT NULL, kind text NOT NULL CHECK(kind IN ('marketplace','social','data')),
 inputs jsonb NOT NULL, principal jsonb NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','completed','partial','failed','reconciliation_required')),
 lease_id uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0,
 next_run_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, result jsonb,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,user_id,source,idempotency_key)
);
CREATE TABLE research_task_operation (
 task_id uuid NOT NULL REFERENCES research_task(id) ON DELETE RESTRICT,
 operation_key text NOT NULL, input_hash text NOT NULL, operation_name text NOT NULL,
 state text NOT NULL CHECK(state IN ('started','completed')), result jsonb,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at timestamptz,
 PRIMARY KEY(task_id,operation_key)
);
CREATE INDEX research_task_ready ON research_task(next_run_at,created_at) WHERE state IN ('queued','running');
ALTER TABLE research_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_task FORCE ROW LEVEL SECURITY;
CREATE POLICY research_task_scope ON research_task USING (
 tenant_id=NULLIF(current_setting('external_data.tenant_id',true),'')::uuid AND workspace_id=NULLIF(current_setting('external_data.workspace_id',true),'')::uuid
) WITH CHECK (
 tenant_id=NULLIF(current_setting('external_data.tenant_id',true),'')::uuid AND workspace_id=NULLIF(current_setting('external_data.workspace_id',true),'')::uuid
);
ALTER TABLE research_task_operation ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_task_operation FORCE ROW LEVEL SECURITY;
CREATE POLICY research_task_operation_scope ON research_task_operation USING (EXISTS(SELECT 1 FROM research_task WHERE id=task_id)) WITH CHECK (EXISTS(SELECT 1 FROM research_task WHERE id=task_id));
-- Only the trusted service worker can claim across tenants; no source/raw records are exposed.
CREATE FUNCTION claim_research_task(worker_lease uuid) RETURNS SETOF research_task LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 RETURN QUERY UPDATE research_task SET state='running',lease_id=worker_lease,lease_until=clock_timestamp()+INTERVAL '90 seconds',attempts=attempts+1,updated_at=clock_timestamp()
 WHERE id=(SELECT id FROM research_task WHERE next_run_at<=clock_timestamp() AND (state='queued' OR (state='running' AND lease_until<clock_timestamp())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *;
END $$;
CREATE FUNCTION guard_research_task_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['state','lease_id','lease_until','attempts','next_run_at','result','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','lease_id','lease_until','attempts','next_run_at','result','updated_at']) THEN RAISE EXCEPTION 'Research task input is immutable'; END IF;
 IF OLD.state IN ('completed','partial','failed','reconciliation_required') THEN RAISE EXCEPTION 'Research task terminal receipt is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER research_task_immutable BEFORE UPDATE OR DELETE ON research_task FOR EACH ROW EXECUTE FUNCTION guard_research_task_scope();
REVOKE ALL ON research_task,research_task_operation FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_research_task(uuid),guard_research_task_scope() FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON research_task,research_task_operation TO external_data_app;
GRANT EXECUTE ON FUNCTION claim_research_task(uuid) TO external_data_app;
CREATE FUNCTION guard_research_task_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.state='completed' OR NEW.task_id<>OLD.task_id OR NEW.operation_key<>OLD.operation_key OR NEW.input_hash<>OLD.input_hash OR NEW.operation_name<>OLD.operation_name OR NEW.created_at<>OLD.created_at OR NEW.state<>'completed' THEN RAISE EXCEPTION 'Task operation history is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER research_task_operation_immutable BEFORE UPDATE OR DELETE ON research_task_operation FOR EACH ROW EXECUTE FUNCTION guard_research_task_operation();
REVOKE ALL ON FUNCTION guard_research_task_operation() FROM PUBLIC;
