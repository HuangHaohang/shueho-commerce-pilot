CREATE TABLE IF NOT EXISTS generic_source_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  research_request_id uuid NOT NULL REFERENCES research_request(id) ON DELETE RESTRICT,
  external_query_id uuid NOT NULL REFERENCES external_query(id) ON DELETE RESTRICT,
  raw_call_id uuid NOT NULL REFERENCES external_api_call_raw(id) ON DELETE RESTRICT,
  endpoint_id text NOT NULL REFERENCES provider_endpoint(endpoint_id) ON DELETE RESTRICT,
  response_family text NOT NULL,
  query_key text NOT NULL CHECK (query_key ~ '^[a-f0-9]{64}$'),
  data_root jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (raw_call_id)
);

CREATE TABLE IF NOT EXISTS generic_source_collection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES generic_source_snapshot(id) ON DELETE RESTRICT,
  json_pointer text NOT NULL,
  collection_key text,
  item_count integer NOT NULL CHECK (item_count >= 0),
  raw_data jsonb NOT NULL CHECK (jsonb_typeof(raw_data) = 'array'),
  raw_sha256 text NOT NULL CHECK (raw_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (snapshot_id, json_pointer)
);

CREATE TABLE IF NOT EXISTS generic_source_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES generic_source_snapshot(id) ON DELETE RESTRICT,
  collection_id uuid REFERENCES generic_source_collection(id) ON DELETE RESTRICT,
  parent_json_pointer text,
  json_pointer text NOT NULL,
  ordinal integer CHECK (ordinal IS NULL OR ordinal >= 0),
  record_kind text NOT NULL,
  provider_entity_id text,
  title_raw text,
  summary_raw text,
  author_raw text,
  canonical_url text,
  published_at timestamptz,
  content_text text CHECK (content_text IS NULL OR char_length(content_text) BETWEEN 1 AND 4096),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metrics) = 'object'),
  raw_data jsonb NOT NULL,
  raw_sha256 text NOT NULL CHECK (raw_sha256 ~ '^[a-f0-9]{64}$'),
  quality_status text NOT NULL DEFAULT 'pending'
    CHECK (quality_status IN ('pending', 'valid', 'suspicious', 'rejected')),
  quality_reasons text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (snapshot_id, json_pointer)
);

CREATE INDEX IF NOT EXISTS generic_source_record_identity_idx
ON generic_source_record (tenant_id, workspace_id, record_kind, provider_entity_id)
WHERE provider_entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS generic_source_record_snapshot_idx
ON generic_source_record (snapshot_id, json_pointer);

CREATE TABLE IF NOT EXISTS business_evidence_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  research_request_id uuid NOT NULL REFERENCES research_request(id) ON DELETE RESTRICT,
  source_record_id uuid NOT NULL REFERENCES generic_source_record(id) ON DELETE RESTRICT,
  enrichment_result_id uuid NOT NULL REFERENCES ai_enrichment_result(id) ON DELETE RESTRICT,
  query_key text NOT NULL CHECK (query_key ~ '^[a-f0-9]{64}$'),
  endpoint_id text NOT NULL REFERENCES provider_endpoint(endpoint_id) ON DELETE RESTRICT,
  source_platform text NOT NULL,
  evidence_kind text NOT NULL,
  provider_entity_id text,
  title text,
  summary text,
  author text,
  canonical_url text,
  published_at timestamptz,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metrics) = 'object'),
  observed_at timestamptz NOT NULL,
  relevance_score double precision NOT NULL CHECK (relevance_score BETWEEN 0 AND 1),
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  source_raw_call_id uuid NOT NULL REFERENCES external_api_call_raw(id) ON DELETE RESTRICT,
  source_json_pointer text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (research_request_id, source_record_id, enrichment_result_id)
);

CREATE INDEX IF NOT EXISTS business_evidence_lookup_idx
ON business_evidence_observation
  (tenant_id, workspace_id, query_key, evidence_kind, relevance_score DESC);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'generic_source_snapshot', 'generic_source_collection', 'generic_source_record',
    'business_evidence_observation'
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

REVOKE ALL ON generic_source_snapshot, generic_source_collection,
  generic_source_record, business_evidence_observation FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'external_data_app') THEN
    GRANT SELECT, INSERT, UPDATE ON generic_source_snapshot, generic_source_collection,
      generic_source_record, business_evidence_observation TO external_data_app;
  END IF;
END;
$$;

COMMENT ON TABLE generic_source_collection IS
  'Every array returned under the provider data payload, retained as a complete source-layer collection.';
COMMENT ON TABLE generic_source_record IS
  'Every item of every returned array plus the provider data root. raw_data preserves all fields regardless of known schema.';
COMMENT ON TABLE business_evidence_observation IS
  'Provider-agnostic business evidence promoted from generic source records after deterministic and local-model relevance checks.';
