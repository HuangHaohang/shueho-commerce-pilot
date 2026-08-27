CREATE TABLE IF NOT EXISTS provider_business_workflow_import_receipt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'justoneapi' CHECK (provider = 'justoneapi'),
  source_catalog_import_id uuid NOT NULL
    REFERENCES provider_catalog_import_receipt(id) ON DELETE RESTRICT,
  definition_sha256 text NOT NULL CHECK (definition_sha256 ~ '^[a-f0-9]{64}$'),
  workflow_count integer NOT NULL CHECK (workflow_count > 0),
  step_count integer NOT NULL CHECK (step_count >= workflow_count),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'array'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, source_catalog_import_id, definition_sha256)
);

CREATE TABLE IF NOT EXISTS provider_business_workflow (
  workflow_id text PRIMARY KEY CHECK (workflow_id ~ '^[a-z0-9_]+\.[a-z0-9_.-]+$'),
  provider text NOT NULL DEFAULT 'justoneapi' CHECK (provider = 'justoneapi'),
  business_tool text NOT NULL CHECK (business_tool IN ('research_marketplace_products')),
  platform_id text NOT NULL CHECK (platform_id ~ '^[a-z0-9_]+$'),
  display_name text NOT NULL,
  capability text NOT NULL,
  workflow_version text NOT NULL,
  input_schema jsonb NOT NULL CHECK (jsonb_typeof(input_schema) = 'object'),
  maximum_provider_calls integer NOT NULL CHECK (maximum_provider_calls BETWEEN 1 AND 10),
  definition_sha256 text NOT NULL CHECK (definition_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('active', 'disabled')),
  source_workflow_import_id uuid NOT NULL
    REFERENCES provider_business_workflow_import_receipt(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS provider_business_workflow_lookup_idx
ON provider_business_workflow (business_tool, platform_id, status, workflow_id);

CREATE TABLE IF NOT EXISTS provider_business_workflow_step (
  workflow_id text NOT NULL
    REFERENCES provider_business_workflow(workflow_id) ON DELETE CASCADE,
  step_id text NOT NULL CHECK (step_id ~ '^[a-z][a-z0-9_]{1,63}$'),
  step_order integer NOT NULL CHECK (step_order BETWEEN 0 AND 9),
  role text NOT NULL CHECK (role IN ('discovery', 'detail', 'price', 'reviews', 'sku')),
  endpoint_id text NOT NULL REFERENCES provider_endpoint(endpoint_id) ON DELETE RESTRICT,
  input_bindings jsonb NOT NULL CHECK (jsonb_typeof(input_bindings) = 'object'),
  output_bindings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(output_bindings) = 'array'),
  required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workflow_id, step_id),
  UNIQUE (workflow_id, step_order)
);

CREATE INDEX IF NOT EXISTS provider_business_workflow_step_endpoint_idx
ON provider_business_workflow_step (endpoint_id, workflow_id);

CREATE TABLE IF NOT EXISTS research_workflow_execution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('codex_harness', 'external_mcp')),
  source_call_id text NOT NULL CHECK (char_length(source_call_id) BETWEEN 8 AND 160),
  root_thread_id text,
  thread_id text,
  turn_id text,
  workflow_id text NOT NULL
    REFERENCES provider_business_workflow(workflow_id) ON DELETE RESTRICT,
  workflow_version text NOT NULL,
  plan_key text NOT NULL CHECK (plan_key ~ '^[a-f0-9]{64}$'),
  request_text text NOT NULL CHECK (char_length(request_text) BETWEEN 1 AND 50000),
  business_input jsonb NOT NULL CHECK (jsonb_typeof(business_input) = 'object'),
  business_intent jsonb NOT NULL CHECK (jsonb_typeof(business_intent) = 'object'),
  plan_coverage jsonb NOT NULL CHECK (jsonb_typeof(plan_coverage) = 'object'),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'running', 'completed', 'partial', 'failed', 'cancelled', 'unknown')),
  compact_result jsonb CHECK (compact_result IS NULL OR jsonb_typeof(compact_result) = 'object'),
  failure_code text,
  failure_message text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, source, source_call_id)
);

CREATE INDEX IF NOT EXISTS research_workflow_execution_scope_idx
ON research_workflow_execution (tenant_id, workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS research_workflow_step_execution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  workflow_execution_id uuid NOT NULL
    REFERENCES research_workflow_execution(id) ON DELETE RESTRICT,
  step_id text NOT NULL,
  step_order integer NOT NULL CHECK (step_order BETWEEN 0 AND 9),
  role text NOT NULL CHECK (role IN ('discovery', 'detail', 'price', 'reviews', 'sku')),
  endpoint_id text NOT NULL REFERENCES provider_endpoint(endpoint_id) ON DELETE RESTRICT,
  research_request_id uuid REFERENCES research_request(id) ON DELETE RESTRICT,
  parameter_sha256 text CHECK (parameter_sha256 IS NULL OR parameter_sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'planned'
    CHECK (state IN ('planned', 'running', 'completed', 'business_failed', 'processing_failed', 'unknown', 'skipped', 'cancelled')),
  provider_completed boolean,
  processing_state text,
  failure_code text,
  failure_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workflow_execution_id, step_id),
  UNIQUE (research_request_id)
);

CREATE TABLE IF NOT EXISTS research_workflow_binding_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  workflow_execution_id uuid NOT NULL
    REFERENCES research_workflow_execution(id) ON DELETE RESTRICT,
  source_step_id text NOT NULL,
  source_research_request_id uuid NOT NULL
    REFERENCES research_request(id) ON DELETE RESTRICT,
  source_record_type text NOT NULL CHECK (source_record_type IN ('generic_source_record', 'taobao_search_item')),
  source_record_id uuid NOT NULL,
  source_json_pointer text NOT NULL,
  source_field_name text NOT NULL,
  binding_name text NOT NULL CHECK (binding_name ~ '^[a-z][a-z0-9_]{1,63}$'),
  binding_value text NOT NULL CHECK (char_length(binding_value) BETWEEN 1 AND 500),
  binding_value_sha256 text NOT NULL CHECK (binding_value_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workflow_execution_id, binding_name)
);

CREATE INDEX IF NOT EXISTS research_workflow_binding_source_idx
ON research_workflow_binding_evidence (tenant_id, workspace_id, source_research_request_id);

CREATE OR REPLACE FUNCTION external_data_reject_workflow_receipt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'provider business workflow import receipts are immutable';
END;
$$;

DROP TRIGGER IF EXISTS provider_business_workflow_import_receipt_immutable
ON provider_business_workflow_import_receipt;
CREATE TRIGGER provider_business_workflow_import_receipt_immutable
BEFORE UPDATE OR DELETE ON provider_business_workflow_import_receipt
FOR EACH ROW EXECUTE FUNCTION external_data_reject_workflow_receipt_mutation();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'research_workflow_execution',
    'research_workflow_step_execution',
    'research_workflow_binding_evidence'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS external_data_scope ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY external_data_scope ON %I USING (
        tenant_id = NULLIF(current_setting(''external_data.tenant_id'', true), '''')::uuid
        AND workspace_id = NULLIF(current_setting(''external_data.workspace_id'', true), '''')::uuid
      ) WITH CHECK (
        tenant_id = NULLIF(current_setting(''external_data.tenant_id'', true), '''')::uuid
        AND workspace_id = NULLIF(current_setting(''external_data.workspace_id'', true), '''')::uuid
      )',
      table_name
    );
  END LOOP;
END;
$$;

REVOKE ALL ON provider_business_workflow_import_receipt,
  provider_business_workflow, provider_business_workflow_step,
  research_workflow_execution, research_workflow_step_execution,
  research_workflow_binding_evidence FROM PUBLIC;
REVOKE ALL ON FUNCTION external_data_reject_workflow_receipt_mutation() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'external_data_app') THEN
    GRANT SELECT ON provider_business_workflow_import_receipt,
      provider_business_workflow, provider_business_workflow_step TO external_data_app;
    GRANT SELECT, INSERT, UPDATE ON research_workflow_execution,
      research_workflow_step_execution, research_workflow_binding_evidence TO external_data_app;
  END IF;
END;
$$;

COMMENT ON TABLE provider_business_workflow IS
  'Database-driven business workflows that compose provider endpoints without exposing provider identifiers to Harness.';
COMMENT ON TABLE research_workflow_binding_evidence IS
  'SQL-only evidence proving which quality-checked source record supplied each downstream provider identifier.';
