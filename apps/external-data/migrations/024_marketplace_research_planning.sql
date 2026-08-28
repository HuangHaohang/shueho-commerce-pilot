CREATE TABLE IF NOT EXISTS provider_market_profile_import_receipt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'justoneapi' CHECK (provider = 'justoneapi'),
  source_name text NOT NULL CHECK (char_length(source_name) BETWEEN 1 AND 200),
  source_version text NOT NULL CHECK (char_length(source_version) BETWEEN 1 AND 40),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  profile_count integer NOT NULL CHECK (profile_count > 0),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, source_sha256)
);

CREATE TABLE IF NOT EXISTS provider_market_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'justoneapi' CHECK (provider = 'justoneapi'),
  platform_id text NOT NULL CHECK (platform_id ~ '^[a-z0-9_]+$'),
  market_code text NOT NULL CHECK (market_code ~ '^[A-Z0-9_-]{2,32}$'),
  display_locale text NOT NULL CHECK (display_locale ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$'),
  preferred_query_locale text NOT NULL
    CHECK (preferred_query_locale ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$'),
  query_locales text[] NOT NULL CHECK (cardinality(query_locales) BETWEEN 1 AND 8),
  accepted_query_languages text[] NOT NULL
    CHECK (cardinality(accepted_query_languages) BETWEEN 1 AND 8),
  timezone text NOT NULL CHECK (char_length(timezone) BETWEEN 3 AND 100),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  keyword_localization_policy text NOT NULL
    CHECK (keyword_localization_policy IN ('none', 'agent_generated_validated')),
  script_policy jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(script_policy) = 'object'),
  quality_policy jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(quality_policy) = 'object'),
  definition_sha256 text NOT NULL CHECK (definition_sha256 ~ '^[a-f0-9]{64}$'),
  source_profile_import_id uuid NOT NULL
    REFERENCES provider_market_profile_import_receipt(id) ON DELETE RESTRICT,
  source_catalog_import_id uuid NOT NULL
    REFERENCES provider_catalog_import_receipt(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, platform_id, market_code),
  CHECK (preferred_query_locale = ANY(query_locales))
);

CREATE INDEX IF NOT EXISTS provider_market_profile_lookup_idx
ON provider_market_profile (platform_id, market_code, enabled);

ALTER TABLE provider_market_option
  ADD COLUMN IF NOT EXISTS market_profile_id uuid
    REFERENCES provider_market_profile(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS localization_ready boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS provider_market_option_profile_idx
ON provider_market_option (market_profile_id)
WHERE market_profile_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS marketplace_research_plan (
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
  workflow_definition_sha256 text NOT NULL
    CHECK (workflow_definition_sha256 ~ '^[a-f0-9]{64}$'),
  source_catalog_import_id uuid NOT NULL
    REFERENCES provider_catalog_import_receipt(id) ON DELETE RESTRICT,
  market_profile_id uuid REFERENCES provider_market_profile(id) ON DELETE RESTRICT,
  market_profile_sha256 text CHECK (
    market_profile_sha256 IS NULL OR market_profile_sha256 ~ '^[a-f0-9]{64}$'
  ),
  plan_key text NOT NULL CHECK (plan_key ~ '^[a-f0-9]{64}$'),
  request_text text NOT NULL CHECK (char_length(request_text) BETWEEN 1 AND 50000),
  requested_input jsonb NOT NULL CHECK (jsonb_typeof(requested_input) = 'object'),
  normalized_input jsonb NOT NULL CHECK (jsonb_typeof(normalized_input) = 'object'),
  market_context jsonb NOT NULL CHECK (jsonb_typeof(market_context) = 'object'),
  business_intent jsonb NOT NULL CHECK (jsonb_typeof(business_intent) = 'object'),
  plan_coverage jsonb NOT NULL CHECK (jsonb_typeof(plan_coverage) = 'object'),
  step_templates jsonb NOT NULL CHECK (jsonb_typeof(step_templates) = 'array'),
  detail_sample_size integer NOT NULL CHECK (detail_sample_size BETWEEN 1 AND 10),
  estimated_provider_calls integer NOT NULL CHECK (estimated_provider_calls BETWEEN 1 AND 100),
  state text NOT NULL DEFAULT 'ready'
    CHECK (state IN ('ready', 'executing', 'completed', 'partial', 'failed', 'cancelled', 'expired')),
  expires_at timestamptz NOT NULL,
  workflow_execution_id uuid,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, source, source_call_id),
  UNIQUE (tenant_id, workspace_id, plan_key, source_call_id)
);

CREATE INDEX IF NOT EXISTS marketplace_research_plan_scope_idx
ON marketplace_research_plan (tenant_id, workspace_id, created_at DESC);

ALTER TABLE research_workflow_execution
  ADD COLUMN IF NOT EXISTS research_plan_id uuid
    REFERENCES marketplace_research_plan(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS market_profile_id uuid
    REFERENCES provider_market_profile(id) ON DELETE RESTRICT;

ALTER TABLE marketplace_research_plan
  DROP CONSTRAINT IF EXISTS marketplace_research_plan_workflow_execution_id_fkey;
ALTER TABLE marketplace_research_plan
  ADD CONSTRAINT marketplace_research_plan_workflow_execution_id_fkey
    FOREIGN KEY (workflow_execution_id) REFERENCES research_workflow_execution(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS research_workflow_target (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  workflow_execution_id uuid NOT NULL
    REFERENCES research_workflow_execution(id) ON DELETE RESTRICT,
  target_ordinal integer NOT NULL CHECK (target_ordinal BETWEEN 0 AND 99),
  source_step_id text NOT NULL,
  source_research_request_id uuid NOT NULL
    REFERENCES research_request(id) ON DELETE RESTRICT,
  source_record_type text NOT NULL
    CHECK (source_record_type IN ('generic_source_record', 'taobao_search_item')),
  source_record_id uuid NOT NULL,
  source_json_pointer text NOT NULL,
  provider_entity_id text,
  title text,
  title_fingerprint text NOT NULL CHECK (title_fingerprint ~ '^[a-f0-9]{64}$'),
  relevance_score double precision NOT NULL CHECK (relevance_score BETWEEN 0 AND 1),
  selection_score double precision NOT NULL CHECK (selection_score BETWEEN 0 AND 1),
  selection_reason text NOT NULL CHECK (char_length(selection_reason) BETWEEN 1 AND 200),
  binding_values jsonb NOT NULL CHECK (jsonb_typeof(binding_values) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (workflow_execution_id, target_ordinal),
  UNIQUE (workflow_execution_id, source_record_type, source_record_id)
);

CREATE INDEX IF NOT EXISTS research_workflow_target_source_idx
ON research_workflow_target (tenant_id, workspace_id, source_research_request_id);

ALTER TABLE research_workflow_binding_evidence
  ADD COLUMN IF NOT EXISTS target_id uuid
    REFERENCES research_workflow_target(id) ON DELETE RESTRICT;

ALTER TABLE research_workflow_step_execution
  ADD COLUMN IF NOT EXISTS target_id uuid
    REFERENCES research_workflow_target(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS step_instance_key text,
  ADD COLUMN IF NOT EXISTS instance_order integer,
  ADD COLUMN IF NOT EXISTS is_template boolean NOT NULL DEFAULT false;

UPDATE research_workflow_step_execution
SET step_instance_key = step_id,
    instance_order = step_order
WHERE step_instance_key IS NULL OR instance_order IS NULL;

ALTER TABLE research_workflow_step_execution
  ALTER COLUMN step_instance_key SET NOT NULL,
  ALTER COLUMN instance_order SET NOT NULL;

ALTER TABLE research_workflow_step_execution
  DROP CONSTRAINT IF EXISTS research_workflow_step_execution_workflow_execution_id_step_id_key;
ALTER TABLE research_workflow_step_execution
  DROP CONSTRAINT IF EXISTS research_workflow_step_execution_instance_order_check;
ALTER TABLE research_workflow_step_execution
  ADD CONSTRAINT research_workflow_step_execution_instance_key_check
    CHECK (step_instance_key ~ '^(?:template_)?[a-z][a-z0-9_]{1,63}(?:_[0-9]{1,2})?$'),
  ADD CONSTRAINT research_workflow_step_execution_instance_order_check
    CHECK (instance_order BETWEEN 0 AND 999),
  ADD CONSTRAINT research_workflow_step_execution_instance_unique
    UNIQUE (workflow_execution_id, step_instance_key);

ALTER TABLE research_workflow_binding_evidence
  DROP CONSTRAINT IF EXISTS research_workflow_binding_evidence_workflow_execution_id_binding_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS research_workflow_binding_target_unique
ON research_workflow_binding_evidence (workflow_execution_id, target_id, binding_name)
WHERE target_id IS NOT NULL;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'marketplace_research_plan',
    'research_workflow_target'
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

DROP TRIGGER IF EXISTS provider_market_profile_import_receipt_immutable
ON provider_market_profile_import_receipt;
CREATE TRIGGER provider_market_profile_import_receipt_immutable
BEFORE UPDATE OR DELETE ON provider_market_profile_import_receipt
FOR EACH ROW EXECUTE FUNCTION external_data_reject_catalog_receipt_mutation();

REVOKE ALL ON provider_market_profile_import_receipt, provider_market_profile,
  marketplace_research_plan, research_workflow_target FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'external_data_app') THEN
    GRANT SELECT ON provider_market_profile_import_receipt, provider_market_profile
      TO external_data_app;
    GRANT SELECT, INSERT, UPDATE ON marketplace_research_plan,
      research_workflow_target TO external_data_app;
  END IF;
END;
$$;

COMMENT ON TABLE provider_market_profile IS
  'Versioned platform-market search-language, locale, currency, timezone and quality-policy master data. Runtime Agents never infer these values.';
COMMENT ON TABLE marketplace_research_plan IS
  'Immutable-at-execution free planning receipt bound to catalog, market profile, workflow definition and tenant scope before any paid call.';
COMMENT ON TABLE research_workflow_target IS
  'Diversified quality-promoted discovery targets selected for bounded downstream detail, price, review or SKU calls.';
