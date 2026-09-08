CREATE TABLE provider_data_request_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id text NOT NULL,
  source text NOT NULL CHECK(source IN ('codex_harness','external_mcp')),
  source_call_id text NOT NULL,
  root_thread_id text,
  thread_id text,
  turn_id text,
  endpoint_id text NOT NULL REFERENCES provider_endpoint(endpoint_id),
  catalog_revision text NOT NULL,
  plan_key text NOT NULL,
  request_text text NOT NULL,
  normalized_input jsonb NOT NULL,
  max_fields integer NOT NULL CHECK(max_fields BETWEEN 1 AND 100),
  state text NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','executing','completed','failed','unknown','cancelled')),
  research_request_id uuid REFERENCES research_request(id) ON DELETE RESTRICT,
  run_claim_id uuid,
  claim_source_call_id text,
  execution_started_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id,source,source_call_id),
  UNIQUE(id,tenant_id,workspace_id)
);
CREATE TABLE provider_data_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  research_request_id uuid NOT NULL REFERENCES research_request(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL,
  field_path text NOT NULL,
  field_name text NOT NULL,
  value_type text NOT NULL,
  normalized_value jsonb,
  quality_status text NOT NULL CHECK(quality_status IN ('valid','held','rejected')),
  reason_codes text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(research_request_id,ordinal)
);
CREATE FUNCTION guard_provider_data_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.state IN ('completed','failed','unknown','cancelled') THEN
    RAISE EXCEPTION 'Provider data plan receipt is immutable';
  END IF;
  IF (to_jsonb(NEW)-ARRAY['state','research_request_id','updated_at','run_claim_id','execution_started_at','claim_source_call_id']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['state','research_request_id','updated_at','run_claim_id','execution_started_at','claim_source_call_id'])
     OR (OLD.research_request_id IS NOT NULL AND NEW.research_request_id IS DISTINCT FROM OLD.research_request_id)
     OR (OLD.run_claim_id IS NOT NULL AND (NEW.run_claim_id IS DISTINCT FROM OLD.run_claim_id OR NEW.execution_started_at IS DISTINCT FROM OLD.execution_started_at))
     OR (OLD.claim_source_call_id IS NOT NULL AND NEW.claim_source_call_id IS DISTINCT FROM OLD.claim_source_call_id)
     OR NOT ((OLD.state='ready' AND NEW.state IN ('executing','cancelled'))
       OR (OLD.state='executing' AND NEW.state IN ('executing','completed','failed','unknown','cancelled'))) THEN
    RAISE EXCEPTION 'Invalid provider data plan transition';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER provider_data_plan_guard BEFORE UPDATE OR DELETE ON provider_data_request_plan
FOR EACH ROW EXECUTE FUNCTION guard_provider_data_plan();
CREATE TRIGGER provider_data_observation_immutable BEFORE UPDATE OR DELETE ON provider_data_observation
FOR EACH ROW EXECUTE FUNCTION justoneapi_guard_immutable_records();
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['provider_data_request_plan','provider_data_observation'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY %I_scope ON %I USING (
      tenant_id=NULLIF(current_setting(''external_data.tenant_id'',true),'''')::uuid
      AND workspace_id=NULLIF(current_setting(''external_data.workspace_id'',true),'''')::uuid
    ) WITH CHECK (
      tenant_id=NULLIF(current_setting(''external_data.tenant_id'',true),'''')::uuid
      AND workspace_id=NULLIF(current_setting(''external_data.workspace_id'',true),'''')::uuid
    )',table_name,table_name);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',table_name);
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='external_data_app') THEN
    GRANT SELECT,INSERT,UPDATE ON provider_data_request_plan TO external_data_app;
    GRANT SELECT,INSERT ON provider_data_observation TO external_data_app;
  END IF;
END $$;
REVOKE ALL ON FUNCTION guard_provider_data_plan() FROM PUBLIC;
