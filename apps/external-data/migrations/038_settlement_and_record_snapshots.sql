CREATE TABLE research_settlement_outbox (
 reservation_id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES research_task(id),
 tenant_id uuid NOT NULL,workspace_id uuid NOT NULL,user_id text NOT NULL,
 payload jsonb NOT NULL,payload_hash text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','completed','attention_required')),
 attempts integer NOT NULL DEFAULT 0,next_run_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
 lease_id uuid,lease_until timestamptz,last_error_code text,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,completed_at timestamptz
);
CREATE TABLE research_settlement_claim (id uuid PRIMARY KEY,reservation_id uuid REFERENCES research_settlement_outbox(reservation_id));
CREATE INDEX research_settlement_ready ON research_settlement_outbox(next_run_at) WHERE state IN ('pending','running');
CREATE FUNCTION claim_research_settlement(claim_id uuid) RETURNS TABLE(reservation_id uuid,task_id uuid,payload jsonb,principal jsonb,lease_id uuid)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE selected uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('settlement-claim:'||claim_id::text,0));
 IF EXISTS(SELECT 1 FROM research_settlement_claim WHERE id=claim_id) THEN
  RETURN QUERY SELECT o.reservation_id,o.task_id,o.payload,t.principal,o.lease_id FROM research_settlement_outbox o
   JOIN research_task t ON t.id=o.task_id JOIN research_settlement_claim c ON c.reservation_id=o.reservation_id
   WHERE c.id=claim_id AND o.lease_id=claim_id AND o.state='running';RETURN;
 END IF;
 SELECT o.reservation_id INTO selected FROM research_settlement_outbox o WHERE o.next_run_at<=clock_timestamp()
  AND (o.state='pending' OR (o.state='running' AND o.lease_until<clock_timestamp())) ORDER BY o.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 INSERT INTO research_settlement_claim(id,reservation_id) VALUES(claim_id,selected);
 IF selected IS NULL THEN RETURN; END IF;
 UPDATE research_settlement_outbox o SET state='running',lease_id=claim_id,lease_until=clock_timestamp()+INTERVAL '120 seconds',attempts=attempts+1 WHERE o.reservation_id=selected;
 RETURN QUERY SELECT o.reservation_id,o.task_id,o.payload,t.principal,o.lease_id FROM research_settlement_outbox o JOIN research_task t ON t.id=o.task_id WHERE o.reservation_id=selected;
END $$;
ALTER TABLE research_settlement_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_settlement_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY research_settlement_scope ON research_settlement_outbox USING (
 tenant_id=NULLIF(current_setting('external_data.tenant_id',true),'')::uuid AND workspace_id=NULLIF(current_setting('external_data.workspace_id',true),'')::uuid
) WITH CHECK(tenant_id=NULLIF(current_setting('external_data.tenant_id',true),'')::uuid AND workspace_id=NULLIF(current_setting('external_data.workspace_id',true),'')::uuid);
CREATE FUNCTION guard_research_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.state='completed' OR (to_jsonb(NEW)-ARRAY['state','attempts','next_run_at','lease_id','lease_until','last_error_code','completed_at']) IS DISTINCT FROM
 (to_jsonb(OLD)-ARRAY['state','attempts','next_run_at','lease_id','lease_until','last_error_code','completed_at']) THEN RAISE EXCEPTION 'Settlement receipt is immutable'; END IF;RETURN NEW;END $$;
CREATE TRIGGER research_settlement_guard BEFORE UPDATE OR DELETE ON research_settlement_outbox FOR EACH ROW EXECUTE FUNCTION guard_research_settlement();
REVOKE ALL ON research_settlement_outbox,research_settlement_claim FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON research_settlement_outbox TO external_data_app;
REVOKE ALL ON FUNCTION claim_research_settlement(uuid),guard_research_settlement() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_research_settlement(uuid) TO external_data_app;
CREATE FUNCTION research_settlement_health() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('settlementPending',count(*) FILTER(WHERE state IN ('pending','running')),
 'settlementAttentionRequired',count(*) FILTER(WHERE state='attention_required'),
 'oldestSettlementSeconds',COALESCE(EXTRACT(EPOCH FROM clock_timestamp()-min(created_at) FILTER(WHERE state IN ('pending','running'))),0)) FROM research_settlement_outbox;
$$;
REVOKE ALL ON FUNCTION research_settlement_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION research_settlement_health() TO external_data_app;

CREATE TABLE research_record_index (
 research_request_id uuid NOT NULL REFERENCES research_request(id),ordinal integer NOT NULL,
 collection text NOT NULL,source_index integer NOT NULL,identity_key text NOT NULL,
 record jsonb NOT NULL,PRIMARY KEY(research_request_id,ordinal)
);
CREATE TABLE research_record_manifest (
 research_request_id uuid PRIMARY KEY REFERENCES research_request(id),pagination jsonb NOT NULL,
 record_count integer NOT NULL,truncated boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE research_record_snapshot (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid NOT NULL REFERENCES research_task(id),
 revision text NOT NULL,record_count integer NOT NULL DEFAULT 0,duplicates integer NOT NULL DEFAULT 0,
 source_pages jsonb NOT NULL DEFAULT '[]',truncated boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(task_id,revision)
);
CREATE TABLE research_record_snapshot_item (
 snapshot_id uuid NOT NULL REFERENCES research_record_snapshot(id),ordinal integer NOT NULL,
 research_request_id uuid NOT NULL,record_ordinal integer NOT NULL,
 PRIMARY KEY(snapshot_id,ordinal),FOREIGN KEY(research_request_id,record_ordinal) REFERENCES research_record_index(research_request_id,ordinal)
);
DO $$ DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['research_record_index','research_record_manifest'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',n);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',n);
 EXECUTE format('CREATE POLICY %I_scope ON %I USING(EXISTS(SELECT 1 FROM research_request WHERE id=research_request_id)) WITH CHECK(EXISTS(SELECT 1 FROM research_request WHERE id=research_request_id))',n,n);
 EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',n);EXECUTE format('GRANT SELECT,INSERT ON %I TO external_data_app',n);
 END LOOP;
END $$;
ALTER TABLE research_record_snapshot ENABLE ROW LEVEL SECURITY;ALTER TABLE research_record_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY research_record_snapshot_scope ON research_record_snapshot USING(EXISTS(SELECT 1 FROM research_task WHERE id=task_id)) WITH CHECK(EXISTS(SELECT 1 FROM research_task WHERE id=task_id));
ALTER TABLE research_record_snapshot_item ENABLE ROW LEVEL SECURITY;ALTER TABLE research_record_snapshot_item FORCE ROW LEVEL SECURITY;
CREATE POLICY research_record_snapshot_item_scope ON research_record_snapshot_item USING(EXISTS(SELECT 1 FROM research_record_snapshot WHERE id=snapshot_id)) WITH CHECK(EXISTS(SELECT 1 FROM research_record_snapshot WHERE id=snapshot_id));
REVOKE ALL ON research_record_snapshot,research_record_snapshot_item FROM PUBLIC;
GRANT SELECT,INSERT ON research_record_snapshot,research_record_snapshot_item TO external_data_app;
DO $$ DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['research_record_index','research_record_manifest','research_record_snapshot','research_record_snapshot_item'] LOOP
  EXECUTE format('CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION justoneapi_guard_immutable_records()',n,n);
 END LOOP;
END $$;
