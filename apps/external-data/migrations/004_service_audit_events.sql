CREATE TABLE IF NOT EXISTS service_audit_event (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  research_request_id uuid REFERENCES research_request(id) ON DELETE RESTRICT,
  raw_call_id uuid REFERENCES external_api_call_raw(id) ON DELETE RESTRICT,
  action text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'succeeded', 'failed', 'unknown')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS service_audit_event_scope_time_idx
ON service_audit_event (tenant_id, workspace_id, occurred_at DESC);

ALTER TABLE service_audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_audit_event FORCE ROW LEVEL SECURITY;
CREATE POLICY external_data_scope ON service_audit_event
USING (
  tenant_id = NULLIF(current_setting('external_data.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('external_data.workspace_id', true), '')::uuid
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('external_data.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('external_data.workspace_id', true), '')::uuid
);

REVOKE ALL ON service_audit_event FROM PUBLIC;
REVOKE ALL ON SEQUENCE service_audit_event_id_seq FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'external_data_app') THEN
    GRANT SELECT, INSERT ON service_audit_event TO external_data_app;
    GRANT USAGE, SELECT ON SEQUENCE service_audit_event_id_seq TO external_data_app;
  END IF;
END;
$$;

COMMENT ON TABLE service_audit_event IS
  'Append-only redacted operational audit for external-data collection and processing. Raw requests, responses, prompts and credentials are excluded.';
