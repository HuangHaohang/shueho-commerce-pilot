CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE OR REPLACE FUNCTION external_data_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS provider_endpoint (
  endpoint_id text PRIMARY KEY,
  provider text NOT NULL DEFAULT 'justoneapi' CHECK (provider = 'justoneapi'),
  platform_id text NOT NULL CHECK (platform_id ~ '^[a-z0-9_]+$'),
  display_name text NOT NULL,
  capability text NOT NULL,
  api_path text NOT NULL UNIQUE CHECK (api_path LIKE '/api/%'),
  http_method text NOT NULL DEFAULT 'GET' CHECK (http_method IN ('GET', 'POST')),
  schema_version text NOT NULL,
  request_schema jsonb NOT NULL CHECK (jsonb_typeof(request_schema) = 'object'),
  response_family text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS research_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('codex_harness', 'external_mcp', 'archive_import')),
  source_call_id text NOT NULL CHECK (char_length(source_call_id) BETWEEN 8 AND 160),
  root_thread_id text,
  thread_id text,
  turn_id text,
  request_text text NOT NULL CHECK (char_length(request_text) BETWEEN 1 AND 50000),
  structured_intent jsonb NOT NULL CHECK (jsonb_typeof(structured_intent) = 'object'),
  intent_key text NOT NULL CHECK (intent_key ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'collecting', 'normalizing', 'enriching', 'completed', 'failed', 'unknown')),
  top_n integer NOT NULL DEFAULT 50 CHECK (top_n BETWEEN 1 AND 500),
  retention_until timestamptz,
  legal_hold boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, source, source_call_id)
);

CREATE INDEX IF NOT EXISTS research_request_scope_time_idx
ON research_request (tenant_id, workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS research_request_intent_idx
ON research_request (tenant_id, workspace_id, intent_key, created_at DESC);

CREATE TABLE IF NOT EXISTS external_query (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  research_request_id uuid NOT NULL REFERENCES research_request(id) ON DELETE RESTRICT,
  endpoint_id text NOT NULL REFERENCES provider_endpoint(endpoint_id) ON DELETE RESTRICT,
  schema_version text NOT NULL,
  query_key text NOT NULL CHECK (query_key ~ '^[a-f0-9]{64}$'),
  page_key text NOT NULL CHECK (page_key ~ '^[a-f0-9]{64}$'),
  requested_params jsonb NOT NULL CHECK (jsonb_typeof(requested_params) = 'object'),
  canonical_query_params jsonb NOT NULL CHECK (jsonb_typeof(canonical_query_params) = 'object'),
  pagination_params jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(pagination_params) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (research_request_id, page_key)
);

CREATE INDEX IF NOT EXISTS external_query_lookup_idx
ON external_query (tenant_id, workspace_id, endpoint_id, query_key, created_at DESC);

CREATE TABLE IF NOT EXISTS external_api_call_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id text NOT NULL,
  research_request_id uuid NOT NULL REFERENCES research_request(id) ON DELETE RESTRICT,
  external_query_id uuid NOT NULL REFERENCES external_query(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'justoneapi' CHECK (provider = 'justoneapi'),
  endpoint_id text NOT NULL REFERENCES provider_endpoint(endpoint_id) ON DELETE RESTRICT,
  api_path text NOT NULL,
  http_method text NOT NULL CHECK (http_method IN ('GET', 'POST')),
  state text NOT NULL DEFAULT 'prepared'
    CHECK (state IN ('prepared', 'dispatched', 'succeeded', 'business_failed', 'unknown')),
  request_params jsonb NOT NULL CHECK (jsonb_typeof(request_params) = 'object'),
  request_body jsonb CHECK (request_body IS NULL OR jsonb_typeof(request_body) IN ('object', 'array')),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  request_bytes integer NOT NULL CHECK (request_bytes BETWEEN 2 AND 1048576),
  response_payload jsonb,
  response_body_text text,
  response_content_type text,
  response_sha256 text CHECK (response_sha256 IS NULL OR response_sha256 ~ '^[a-f0-9]{64}$'),
  response_bytes integer CHECK (response_bytes IS NULL OR response_bytes BETWEEN 2 AND 6291456),
  http_status integer CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  provider_code integer,
  provider_message text,
  provider_request_id text,
  provider_recorded_at timestamptz,
  dispatched_at timestamptz,
  completed_at timestamptz,
  retention_until timestamptz,
  legal_hold boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (research_request_id, external_query_id),
  CHECK ((response_payload IS NULL) = (response_sha256 IS NULL)),
  CHECK ((response_payload IS NULL) = (response_bytes IS NULL)),
  CHECK ((response_payload IS NULL) = (response_body_text IS NULL))
);

CREATE INDEX IF NOT EXISTS external_api_call_raw_scope_time_idx
ON external_api_call_raw (tenant_id, workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS external_api_call_raw_query_idx
ON external_api_call_raw (tenant_id, workspace_id, endpoint_id, external_query_id);
CREATE INDEX IF NOT EXISTS external_api_call_raw_provider_request_idx
ON external_api_call_raw (provider_request_id) WHERE provider_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS normalization_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  raw_call_id uuid NOT NULL REFERENCES external_api_call_raw(id) ON DELETE RESTRICT,
  normalizer text NOT NULL,
  normalizer_version text NOT NULL,
  state text NOT NULL CHECK (state IN ('running', 'completed', 'failed')),
  counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(counts) = 'object'),
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz,
  UNIQUE (raw_call_id, normalizer, normalizer_version)
);

CREATE TABLE IF NOT EXISTS taobao_search_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  research_request_id uuid NOT NULL REFERENCES research_request(id) ON DELETE RESTRICT,
  external_query_id uuid NOT NULL REFERENCES external_query(id) ON DELETE RESTRICT,
  raw_call_id uuid NOT NULL REFERENCES external_api_call_raw(id) ON DELETE RESTRICT,
  query_key text NOT NULL CHECK (query_key ~ '^[a-f0-9]{64}$'),
  keyword text NOT NULL,
  sort text NOT NULL,
  tmall boolean NOT NULL,
  top_n integer NOT NULL,
  start_price numeric(18, 4),
  end_price numeric(18, 4),
  requested_page integer NOT NULL,
  provider_success boolean,
  response_status integer,
  cost_millis integer,
  model_extra_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_extra_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_model jsonb NOT NULL CHECK (jsonb_typeof(raw_model) = 'object'),
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (raw_call_id)
);

CREATE INDEX IF NOT EXISTS taobao_search_snapshot_query_idx
ON taobao_search_snapshot (tenant_id, workspace_id, query_key, observed_at DESC);

CREATE TABLE IF NOT EXISTS taobao_search_page (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES taobao_search_snapshot(id) ON DELETE RESTRICT,
  page_no integer,
  page_size integer,
  total_items integer,
  total_pages integer,
  previous_no integer,
  next_no integer,
  show_begin integer,
  show_end integer,
  raw_data jsonb NOT NULL CHECK (jsonb_typeof(raw_data) = 'object'),
  UNIQUE (snapshot_id)
);

CREATE TABLE IF NOT EXISTS taobao_search_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES taobao_search_snapshot(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  item_id text,
  product_id text,
  spu_id text,
  shop_id text,
  item_name_raw text,
  item_sub_name_raw text,
  shop_name_raw text,
  item_type text,
  tmall boolean,
  item_location text,
  seller_location text,
  image_url text,
  image_urls jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(image_urls) = 'array'),
  price_fen bigint,
  discounted_price_fen bigint,
  price_yuan numeric(18, 4),
  discounted_price_yuan numeric(18, 4),
  discount_rate numeric(18, 4),
  discount_type text,
  sales_display text,
  sales_lower_bound bigint,
  sales_upper_bound bigint,
  sales_qualifier text CHECK (sales_qualifier IS NULL OR sales_qualifier IN ('exact', 'gte', 'range', 'unknown')),
  stock bigint,
  comment_count text,
  item_grade numeric(18, 4),
  seller_good_rate numeric(18, 6),
  seller_level integer,
  description_dsr text,
  service_dsr text,
  shipping_dsr text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tags) = 'array'),
  services jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(services) = 'array'),
  extra_map jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(extra_map) = 'object'),
  raw_data jsonb NOT NULL CHECK (jsonb_typeof(raw_data) = 'object'),
  raw_sha256 text NOT NULL CHECK (raw_sha256 ~ '^[a-f0-9]{64}$'),
  quality_status text NOT NULL DEFAULT 'pending' CHECK (quality_status IN ('pending', 'valid', 'suspicious', 'rejected')),
  quality_reasons text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (snapshot_id, ordinal)
);

CREATE INDEX IF NOT EXISTS taobao_search_item_identity_idx
ON taobao_search_item (tenant_id, workspace_id, item_id, created_at DESC)
WHERE item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS taobao_search_brand (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES taobao_search_snapshot(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  brand_id text,
  brand_name_raw text,
  normalized_name text,
  item_count integer,
  raw_data jsonb NOT NULL CHECK (jsonb_typeof(raw_data) = 'object'),
  quality_status text NOT NULL DEFAULT 'pending' CHECK (quality_status IN ('pending', 'valid', 'suspicious', 'rejected')),
  quality_reasons text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (snapshot_id, ordinal)
);

CREATE TABLE IF NOT EXISTS taobao_search_property (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES taobao_search_snapshot(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  property_id text,
  property_name_raw text,
  normalized_name text,
  flag text,
  raw_data jsonb NOT NULL CHECK (jsonb_typeof(raw_data) = 'object'),
  quality_status text NOT NULL DEFAULT 'pending' CHECK (quality_status IN ('pending', 'valid', 'suspicious', 'rejected')),
  quality_reasons text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (snapshot_id, ordinal)
);

CREATE TABLE IF NOT EXISTS taobao_search_property_value (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES taobao_search_snapshot(id) ON DELETE RESTRICT,
  property_row_id uuid NOT NULL REFERENCES taobao_search_property(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  value_id text,
  value_name_raw text,
  normalized_value text,
  item_count integer,
  flag text,
  raw_data jsonb NOT NULL CHECK (jsonb_typeof(raw_data) = 'object'),
  quality_status text NOT NULL DEFAULT 'pending' CHECK (quality_status IN ('pending', 'valid', 'suspicious', 'rejected')),
  quality_reasons text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (property_row_id, ordinal)
);

CREATE TABLE IF NOT EXISTS taobao_search_trace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES taobao_search_snapshot(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  raw_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (snapshot_id, ordinal)
);

CREATE TABLE IF NOT EXISTS social_search_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  research_request_id uuid NOT NULL REFERENCES research_request(id) ON DELETE RESTRICT,
  external_query_id uuid NOT NULL REFERENCES external_query(id) ON DELETE RESTRICT,
  raw_call_id uuid NOT NULL REFERENCES external_api_call_raw(id) ON DELETE RESTRICT,
  query_key text NOT NULL CHECK (query_key ~ '^[a-f0-9]{64}$'),
  keyword text,
  source_filter text NOT NULL,
  requested_start timestamptz,
  requested_end timestamptz,
  requested_cursor text,
  next_cursor text,
  raw_data jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (raw_call_id)
);

CREATE TABLE IF NOT EXISTS social_search_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  snapshot_id uuid NOT NULL REFERENCES social_search_snapshot(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  source_name text,
  source_platform text,
  title_raw text,
  summary_raw text,
  author_raw text,
  canonical_url text,
  published_at timestamptz,
  raw_data jsonb NOT NULL,
  raw_sha256 text NOT NULL CHECK (raw_sha256 ~ '^[a-f0-9]{64}$'),
  quality_status text NOT NULL DEFAULT 'pending' CHECK (quality_status IN ('pending', 'valid', 'suspicious', 'rejected')),
  quality_reasons text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (snapshot_id, ordinal)
);

CREATE TABLE IF NOT EXISTS data_quality_issue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  research_request_id uuid NOT NULL REFERENCES research_request(id) ON DELETE RESTRICT,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  reason_code text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (entity_type, entity_id, reason_code)
);

CREATE TABLE IF NOT EXISTS ai_enrichment_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  research_request_id uuid NOT NULL REFERENCES research_request(id) ON DELETE RESTRICT,
  query_key text NOT NULL CHECK (query_key ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'failed')),
  embedding_model text NOT NULL,
  embedding_dimensions integer NOT NULL,
  reranker_model text NOT NULL,
  prompt_version text NOT NULL,
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  candidate_count integer NOT NULL DEFAULT 0,
  accepted_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (research_request_id, input_hash, embedding_model, reranker_model, prompt_version)
);

CREATE TABLE IF NOT EXISTS ai_enrichment_result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES ai_enrichment_job(id) ON DELETE RESTRICT,
  research_request_id uuid NOT NULL REFERENCES research_request(id) ON DELETE RESTRICT,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  entity_match text NOT NULL CHECK (entity_match IN ('exact', 'adjacent', 'irrelevant', 'unknown')),
  category_match boolean,
  supports_price_analysis boolean NOT NULL DEFAULT false,
  supports_sales_analysis boolean NOT NULL DEFAULT false,
  data_quality text NOT NULL CHECK (data_quality IN ('valid', 'suspicious', 'rejected')),
  lexical_score double precision NOT NULL CHECK (lexical_score BETWEEN 0 AND 1),
  embedding_score double precision CHECK (embedding_score IS NULL OR embedding_score BETWEEN -1 AND 1),
  rerank_score double precision CHECK (rerank_score IS NULL OR rerank_score BETWEEN 0 AND 1),
  relevance_score double precision NOT NULL CHECK (relevance_score BETWEEN 0 AND 1),
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  normalized_value text,
  reason_codes text[] NOT NULL DEFAULT '{}',
  decision text NOT NULL CHECK (decision IN ('promote', 'hold', 'reject')),
  model_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(model_metadata) = 'object'),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (job_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS ai_enrichment_result_request_idx
ON ai_enrichment_result (tenant_id, workspace_id, research_request_id, decision, relevance_score DESC);

CREATE TABLE IF NOT EXISTS semantic_document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  research_request_id uuid NOT NULL REFERENCES research_request(id) ON DELETE RESTRICT,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  query_key text NOT NULL CHECK (query_key ~ '^[a-f0-9]{64}$'),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4096),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  embedding_model text NOT NULL,
  model_version text NOT NULL,
  dimensions integer NOT NULL DEFAULT 1024 CHECK (dimensions = 1024),
  embedding vector(1024) NOT NULL,
  embedded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, workspace_id, entity_type, entity_id, content_hash, embedding_model, model_version)
);

CREATE INDEX IF NOT EXISTS semantic_document_scope_idx
ON semantic_document (tenant_id, workspace_id, entity_type);
CREATE INDEX IF NOT EXISTS semantic_document_hnsw_cosine_idx
ON semantic_document USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE TABLE IF NOT EXISTS business_product_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  research_request_id uuid NOT NULL REFERENCES research_request(id) ON DELETE RESTRICT,
  source_item_id uuid NOT NULL REFERENCES taobao_search_item(id) ON DELETE RESTRICT,
  enrichment_result_id uuid NOT NULL REFERENCES ai_enrichment_result(id) ON DELETE RESTRICT,
  query_key text NOT NULL CHECK (query_key ~ '^[a-f0-9]{64}$'),
  platform text NOT NULL,
  platform_item_id text NOT NULL,
  title text NOT NULL,
  normalized_product_type text,
  shop_id text,
  shop_name text,
  brand_name text,
  image_url text,
  price_yuan numeric(18, 4),
  original_price_yuan numeric(18, 4),
  sales_display text,
  sales_lower_bound bigint,
  sales_upper_bound bigint,
  sales_qualifier text,
  observed_at timestamptz NOT NULL,
  relevance_score double precision NOT NULL,
  confidence double precision NOT NULL,
  source_raw_call_id uuid NOT NULL REFERENCES external_api_call_raw(id) ON DELETE RESTRICT,
  source_json_pointer text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (research_request_id, source_item_id, enrichment_result_id)
);

CREATE INDEX IF NOT EXISTS business_product_lookup_idx
ON business_product_observation (tenant_id, workspace_id, query_key, relevance_score DESC);
CREATE INDEX IF NOT EXISTS business_product_identity_idx
ON business_product_observation (tenant_id, workspace_id, platform, platform_item_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS business_brand_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  research_request_id uuid NOT NULL REFERENCES research_request(id) ON DELETE RESTRICT,
  source_brand_id uuid NOT NULL REFERENCES taobao_search_brand(id) ON DELETE RESTRICT,
  enrichment_result_id uuid NOT NULL REFERENCES ai_enrichment_result(id) ON DELETE RESTRICT,
  query_key text NOT NULL,
  provider_brand_id text,
  brand_name text NOT NULL,
  item_count integer,
  relevance_score double precision NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (research_request_id, source_brand_id, enrichment_result_id)
);

CREATE TABLE IF NOT EXISTS business_property_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  research_request_id uuid NOT NULL REFERENCES research_request(id) ON DELETE RESTRICT,
  source_property_value_id uuid NOT NULL REFERENCES taobao_search_property_value(id) ON DELETE RESTRICT,
  enrichment_result_id uuid NOT NULL REFERENCES ai_enrichment_result(id) ON DELETE RESTRICT,
  query_key text NOT NULL,
  provider_property_id text,
  property_name text NOT NULL,
  provider_value_id text,
  property_value text NOT NULL,
  item_count integer,
  relevance_score double precision NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (research_request_id, source_property_value_id, enrichment_result_id)
);

CREATE TABLE IF NOT EXISTS business_content_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  research_request_id uuid NOT NULL REFERENCES research_request(id) ON DELETE RESTRICT,
  source_social_item_id uuid NOT NULL REFERENCES social_search_item(id) ON DELETE RESTRICT,
  enrichment_result_id uuid NOT NULL REFERENCES ai_enrichment_result(id) ON DELETE RESTRICT,
  query_key text NOT NULL,
  source_platform text,
  source_name text,
  title text,
  summary text,
  author text,
  canonical_url text,
  published_at timestamptz,
  observed_at timestamptz NOT NULL,
  relevance_score double precision NOT NULL,
  confidence double precision NOT NULL,
  source_raw_call_id uuid NOT NULL REFERENCES external_api_call_raw(id) ON DELETE RESTRICT,
  source_json_pointer text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (research_request_id, source_social_item_id, enrichment_result_id)
);

CREATE INDEX IF NOT EXISTS business_content_lookup_idx
ON business_content_observation (tenant_id, workspace_id, query_key, relevance_score DESC);

CREATE TABLE IF NOT EXISTS research_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  research_request_id uuid NOT NULL REFERENCES research_request(id) ON DELETE RESTRICT,
  evidence_type text NOT NULL,
  business_record_id uuid NOT NULL,
  source_raw_call_id uuid NOT NULL REFERENCES external_api_call_raw(id) ON DELETE RESTRICT,
  source_json_pointer text NOT NULL,
  inclusion_reason text NOT NULL,
  relevance_score double precision NOT NULL,
  confidence double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (research_request_id, evidence_type, business_record_id)
);

CREATE TABLE IF NOT EXISTS research_metric (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  research_request_id uuid NOT NULL REFERENCES research_request(id) ON DELETE RESTRICT,
  metric_name text NOT NULL,
  metric_value jsonb NOT NULL CHECK (jsonb_typeof(metric_value) = 'object'),
  calculation_method text NOT NULL,
  sample_count integer NOT NULL CHECK (sample_count >= 0),
  coverage jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(coverage) = 'object'),
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (research_request_id, metric_name)
);

CREATE TABLE IF NOT EXISTS index_outbox (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('index', 'delete')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'processing', 'completed', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS index_outbox_pending_idx
ON index_outbox (state, next_attempt_at, id)
WHERE state IN ('pending', 'failed');

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'research_request', 'external_query', 'external_api_call_raw', 'normalization_run',
    'taobao_search_snapshot', 'taobao_search_page', 'taobao_search_item', 'taobao_search_brand',
    'taobao_search_property', 'taobao_search_property_value', 'taobao_search_trace',
    'social_search_snapshot', 'social_search_item', 'data_quality_issue',
    'ai_enrichment_job', 'ai_enrichment_result', 'semantic_document',
    'business_product_observation', 'business_brand_observation',
    'business_property_observation', 'business_content_observation',
    'research_evidence', 'research_metric', 'index_outbox'
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

ALTER TABLE index_outbox NO FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION external_data_claim_index_outbox(p_limit integer DEFAULT 100)
RETURNS TABLE (
  id bigint,
  tenant_id uuid,
  workspace_id uuid,
  aggregate_type text,
  aggregate_id uuid,
  operation text,
  payload jsonb,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'index outbox claim limit must be between 1 and 500';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT outbox.id
    FROM index_outbox outbox
    WHERE outbox.state IN ('pending', 'failed')
      AND outbox.next_attempt_at <= CURRENT_TIMESTAMP
      AND outbox.attempt_count < 10
    ORDER BY outbox.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE index_outbox outbox
  SET state='processing', attempt_count=outbox.attempt_count+1, updated_at=CURRENT_TIMESTAMP
  FROM candidates
  WHERE outbox.id=candidates.id
  RETURNING outbox.id, outbox.tenant_id, outbox.workspace_id,
            outbox.aggregate_type, outbox.aggregate_id, outbox.operation,
            outbox.payload, outbox.attempt_count;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['provider_endpoint']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION external_data_set_updated_at()',
      table_name,
      table_name
    );
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['research_request', 'external_api_call_raw', 'index_outbox']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION external_data_set_updated_at()',
      table_name,
      table_name
    );
  END LOOP;
END;
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON FUNCTION external_data_claim_index_outbox(integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'external_data_app') THEN
    GRANT USAGE ON SCHEMA public TO external_data_app;
    GRANT SELECT ON provider_endpoint TO external_data_app;
    GRANT SELECT, INSERT, UPDATE ON
      research_request, external_query, external_api_call_raw, normalization_run,
      taobao_search_snapshot, taobao_search_page, taobao_search_item, taobao_search_brand,
      taobao_search_property, taobao_search_property_value, taobao_search_trace,
      social_search_snapshot, social_search_item, data_quality_issue,
      ai_enrichment_job, ai_enrichment_result, semantic_document,
      business_product_observation, business_brand_observation,
      business_property_observation, business_content_observation,
      research_evidence, research_metric, index_outbox
    TO external_data_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO external_data_app;
    GRANT EXECUTE ON FUNCTION external_data_claim_index_outbox(integer) TO external_data_app;
  END IF;
END;
$$;

COMMENT ON TABLE external_api_call_raw IS
  'Immutable complete JustOneAPI business request and response authority. No MCP or browser raw-read tool is exposed.';
COMMENT ON TABLE ai_enrichment_result IS
  'Versioned AI quality and relevance decisions. These annotate source data and never replace or delete raw records.';
COMMENT ON TABLE business_product_observation IS
  'Curated query-specific product evidence promoted only after deterministic quality checks and local AI relevance scoring.';
