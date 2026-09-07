-- Service-owned provider credentials are represented only by opaque fingerprints.
-- Plain tokens remain in the protected service configuration, never in SQL.
CREATE TABLE justoneapi_token (
  token_id text PRIMARY KEY CHECK (token_id ~ '^token-[a-f0-9]{24}$'),
  fingerprint text NOT NULL UNIQUE CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','invalid','disabled')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE justoneapi_quota_import (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_sha256 text NOT NULL UNIQUE CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_reference text NOT NULL CHECK (char_length(source_reference) BETWEEN 1 AND 500),
  observed_at timestamptz NOT NULL,
  entries jsonb NOT NULL CHECK (jsonb_typeof(entries)='array'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE justoneapi_token_selection_seq;
CREATE TABLE justoneapi_token_endpoint_quota (
  token_id text NOT NULL REFERENCES justoneapi_token(token_id) ON DELETE RESTRICT,
  api_path text NOT NULL CHECK (api_path LIKE '/api/%' AND char_length(api_path)<=500),
  remaining_calls bigint CHECK (remaining_calls>=0),
  reserved_calls bigint NOT NULL DEFAULT 0 CHECK (reserved_calls>=0),
  used_calls bigint NOT NULL DEFAULT 0 CHECK (used_calls>=0),
  state text NOT NULL DEFAULT 'unknown' CHECK (state IN ('unknown','active','exhausted','permission_denied')),
  cooldown_until timestamptz,
  last_selected_seq bigint NOT NULL DEFAULT 0,
  source_import_id uuid REFERENCES justoneapi_quota_import(id) ON DELETE RESTRICT,
  observed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (token_id,api_path),
  CHECK (state<>'active' OR remaining_calls IS NOT NULL)
);

CREATE UNIQUE INDEX external_api_call_raw_token_scope_idx
  ON external_api_call_raw(id,tenant_id,workspace_id);
CREATE TABLE justoneapi_dispatch (
  raw_call_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  execution_id uuid NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','completed','failed','unknown')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz,
  UNIQUE (raw_call_id,tenant_id,workspace_id),
  FOREIGN KEY (raw_call_id,tenant_id,workspace_id)
    REFERENCES external_api_call_raw(id,tenant_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE justoneapi_token_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_call_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  token_id text NOT NULL,
  api_path text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 64),
  state text NOT NULL CHECK (state IN ('reserved','dispatched','succeeded','business_failed','unknown','cancelled')),
  proxy_node_id text,
  http_status integer CHECK (http_status BETWEEN 100 AND 599),
  provider_code integer,
  response_payload jsonb,
  response_body_text text,
  response_raw_bytes bytea,
  response_sha256 text CHECK (response_sha256 ~ '^[a-f0-9]{64}$'),
  response_content_type text,
  response_bytes integer CHECK (response_bytes BETWEEN 0 AND 67108864),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dispatched_at timestamptz,
  completed_at timestamptz,
  UNIQUE (raw_call_id,ordinal),
  UNIQUE (raw_call_id,token_id),
  FOREIGN KEY (raw_call_id,tenant_id,workspace_id)
    REFERENCES justoneapi_dispatch(raw_call_id,tenant_id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (token_id,api_path)
    REFERENCES justoneapi_token_endpoint_quota(token_id,api_path) ON DELETE RESTRICT,
  CHECK ((response_raw_bytes IS NULL)=(response_sha256 IS NULL)),
  CHECK ((response_raw_bytes IS NULL)=(response_bytes IS NULL)),
  CHECK ((response_raw_bytes IS NULL)=(response_body_text IS NULL))
);
CREATE INDEX justoneapi_token_attempt_quota_time_idx
  ON justoneapi_token_attempt(token_id,api_path,dispatched_at);

CREATE FUNCTION justoneapi_guard_immutable_records() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'JustOneAPI import and attempt history must be retained';
END;
$$;
CREATE TRIGGER justoneapi_quota_import_immutable BEFORE UPDATE OR DELETE ON justoneapi_quota_import
  FOR EACH ROW EXECUTE FUNCTION justoneapi_guard_immutable_records();
CREATE TRIGGER justoneapi_dispatch_no_delete BEFORE DELETE ON justoneapi_dispatch
  FOR EACH ROW EXECUTE FUNCTION justoneapi_guard_immutable_records();
CREATE TRIGGER justoneapi_attempt_no_delete BEFORE DELETE ON justoneapi_token_attempt
  FOR EACH ROW EXECUTE FUNCTION justoneapi_guard_immutable_records();

CREATE FUNCTION justoneapi_guard_attempt_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.raw_call_id<>OLD.raw_call_id OR NEW.tenant_id<>OLD.tenant_id
     OR NEW.workspace_id<>OLD.workspace_id OR NEW.token_id<>OLD.token_id
     OR NEW.api_path<>OLD.api_path OR NEW.ordinal<>OLD.ordinal OR NEW.created_at<>OLD.created_at
     OR OLD.state IN ('succeeded','business_failed','unknown','cancelled')
     OR NOT ((OLD.state='reserved' AND NEW.state IN ('dispatched','cancelled'))
       OR (OLD.state='dispatched' AND NEW.state IN ('succeeded','business_failed','unknown'))) THEN
    RAISE EXCEPTION 'Invalid JustOneAPI attempt mutation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER justoneapi_attempt_update_guard BEFORE UPDATE ON justoneapi_token_attempt
  FOR EACH ROW EXECUTE FUNCTION justoneapi_guard_attempt_update();

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['justoneapi_dispatch','justoneapi_token_attempt'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY %I_scope ON %I USING (
      tenant_id=NULLIF(current_setting(''external_data.tenant_id'',true),'''')::uuid
      AND workspace_id=NULLIF(current_setting(''external_data.workspace_id'',true),'''')::uuid
    ) WITH CHECK (
      tenant_id=NULLIF(current_setting(''external_data.tenant_id'',true),'''')::uuid
      AND workspace_id=NULLIF(current_setting(''external_data.workspace_id'',true),'''')::uuid
    )',table_name,table_name);
  END LOOP;
END $$;

REVOKE ALL ON justoneapi_token,justoneapi_quota_import,justoneapi_token_endpoint_quota,
  justoneapi_dispatch,justoneapi_token_attempt FROM PUBLIC;
REVOKE ALL ON SEQUENCE justoneapi_token_selection_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION justoneapi_guard_immutable_records(),justoneapi_guard_attempt_update() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='external_data_app') THEN
    GRANT SELECT,INSERT,UPDATE ON justoneapi_token,justoneapi_token_endpoint_quota,
      justoneapi_dispatch,justoneapi_token_attempt TO external_data_app;
    GRANT SELECT ON justoneapi_quota_import TO external_data_app;
    GRANT USAGE,SELECT ON SEQUENCE justoneapi_token_selection_seq TO external_data_app;
  END IF;
END $$;

COMMENT ON TABLE justoneapi_token_endpoint_quota IS
  'Service-owned per-token, exact endpoint-version quota; NULL remaining is unknown and must not dispatch.';
COMMENT ON TABLE justoneapi_token_attempt IS
  'SQL-only, tenant-scoped transport attempts, including complete rejected responses before token rotation. No secrets or public raw-read route.';
