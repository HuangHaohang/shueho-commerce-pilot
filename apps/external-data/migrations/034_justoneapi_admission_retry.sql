-- Global provider operational state, containing no tenant content or credentials.
CREATE TABLE justoneapi_admission_bucket (
  bucket_key text PRIMARY KEY,
  next_start_at timestamptz NOT NULL DEFAULT '-infinity',
  cooldown_until timestamptz NOT NULL DEFAULT '-infinity',
  consecutive_throttles integer NOT NULL DEFAULT 0 CHECK (consecutive_throttles>=0)
);
CREATE TABLE justoneapi_admission_lease (
  id uuid PRIMARY KEY,
  api_path text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX justoneapi_admission_lease_endpoint_idx ON justoneapi_admission_lease(api_path,expires_at);

ALTER TABLE justoneapi_dispatch
  ADD COLUMN deadline_at timestamptz,
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN wait_reason text,
  ADD COLUMN failure_code text,
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE justoneapi_token_attempt ADD COLUMN retry_after_ms bigint CHECK (retry_after_ms>=0);
ALTER TABLE justoneapi_dispatch ADD CONSTRAINT justoneapi_dispatch_attempt_count_check CHECK (attempt_count BETWEEN 0 AND 64);
CREATE OR REPLACE FUNCTION justoneapi_guard_dispatch_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.raw_call_id<>OLD.raw_call_id OR NEW.tenant_id<>OLD.tenant_id
     OR NEW.workspace_id<>OLD.workspace_id OR NEW.execution_id<>OLD.execution_id
     OR NEW.created_at<>OLD.created_at OR NEW.deadline_at IS DISTINCT FROM OLD.deadline_at
     OR NEW.attempt_count<OLD.attempt_count OR OLD.state<>'active'
     OR NEW.state NOT IN ('active','completed','failed','unknown')
     OR (NEW.state='active' AND (NEW.completed_at IS DISTINCT FROM OLD.completed_at
       OR NEW.failure_code IS DISTINCT FROM OLD.failure_code)) THEN
    RAISE EXCEPTION 'Invalid JustOneAPI execution mutation';
  END IF;
  RETURN NEW;
END;
$$;
-- A token can be reused only after a cancelled/explicitly retryable attempt.
-- Execution fencing and immutable attempts remain in place.
ALTER TABLE justoneapi_token_attempt DROP CONSTRAINT justoneapi_token_attempt_raw_call_id_token_id_key;
CREATE INDEX justoneapi_token_attempt_call_token_idx ON justoneapi_token_attempt(raw_call_id,token_id);

REVOKE ALL ON justoneapi_admission_bucket,justoneapi_admission_lease FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='external_data_app') THEN
    GRANT SELECT,INSERT,UPDATE ON justoneapi_admission_bucket TO external_data_app;
    GRANT SELECT,INSERT,DELETE ON justoneapi_admission_lease TO external_data_app;
  END IF;
END $$;
COMMENT ON TABLE justoneapi_admission_bucket IS
  'Service-wide operational admission/cooldown across tokens and tenants, not official provider rate or pricing master data.';
