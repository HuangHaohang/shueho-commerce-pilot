-- Append a corrected projection. Original indexes and snapshots remain readable.
CREATE TABLE research_record_index_v2 (
 research_request_id uuid NOT NULL REFERENCES research_request(id),ordinal integer NOT NULL,
 collection text NOT NULL,source_index integer NOT NULL,identity_key text NOT NULL,
 record jsonb NOT NULL,PRIMARY KEY(research_request_id,ordinal)
);
CREATE TABLE research_record_manifest_v2 (
 research_request_id uuid PRIMARY KEY REFERENCES research_request(id),pagination jsonb NOT NULL,
 record_count integer NOT NULL,truncated boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE research_record_snapshot_v2 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid NOT NULL REFERENCES research_task(id),
 revision text NOT NULL,record_count integer NOT NULL DEFAULT 0,duplicates integer NOT NULL DEFAULT 0,
 source_pages jsonb NOT NULL DEFAULT '[]',truncated boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(task_id,revision)
);
CREATE TABLE research_record_snapshot_item_v2 (
 snapshot_id uuid NOT NULL REFERENCES research_record_snapshot_v2(id),ordinal integer NOT NULL,
 research_request_id uuid NOT NULL,record_ordinal integer NOT NULL,
 PRIMARY KEY(snapshot_id,ordinal),FOREIGN KEY(research_request_id,record_ordinal) REFERENCES research_record_index_v2(research_request_id,ordinal)
);
DO $$ DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['research_record_index_v2','research_record_manifest_v2'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',n);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',n);
 EXECUTE format('CREATE POLICY %I_scope ON %I USING(EXISTS(SELECT 1 FROM research_request WHERE id=research_request_id)) WITH CHECK(EXISTS(SELECT 1 FROM research_request WHERE id=research_request_id))',n,n);
 EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',n);EXECUTE format('GRANT SELECT,INSERT ON %I TO external_data_app',n);
 END LOOP;
END $$;
ALTER TABLE research_record_snapshot_v2 ENABLE ROW LEVEL SECURITY;ALTER TABLE research_record_snapshot_v2 FORCE ROW LEVEL SECURITY;
CREATE POLICY research_record_snapshot_scope ON research_record_snapshot_v2 USING(EXISTS(SELECT 1 FROM research_task WHERE id=task_id)) WITH CHECK(EXISTS(SELECT 1 FROM research_task WHERE id=task_id));
ALTER TABLE research_record_snapshot_item_v2 ENABLE ROW LEVEL SECURITY;ALTER TABLE research_record_snapshot_item_v2 FORCE ROW LEVEL SECURITY;
CREATE POLICY research_record_snapshot_item_scope ON research_record_snapshot_item_v2 USING(EXISTS(SELECT 1 FROM research_record_snapshot_v2 WHERE id=snapshot_id)) WITH CHECK(EXISTS(SELECT 1 FROM research_record_snapshot_v2 WHERE id=snapshot_id));
REVOKE ALL ON research_record_snapshot_v2,research_record_snapshot_item_v2 FROM PUBLIC;
GRANT SELECT,INSERT ON research_record_snapshot_v2,research_record_snapshot_item_v2 TO external_data_app;
DO $$ DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['research_record_index_v2','research_record_manifest_v2','research_record_snapshot_v2','research_record_snapshot_item_v2'] LOOP
  EXECUTE format('CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION justoneapi_guard_immutable_records()',n,n);
 END LOOP;
END $$;
