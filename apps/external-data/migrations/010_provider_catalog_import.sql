CREATE TABLE IF NOT EXISTS provider_catalog_import_receipt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'justoneapi' CHECK (provider = 'justoneapi'),
  sitemap_url text NOT NULL CHECK (sitemap_url ~ '^https://docs\.justoneapi\.com/'),
  sitemap_sha256 text NOT NULL CHECK (sitemap_sha256 ~ '^[a-f0-9]{64}$'),
  pricing_source_sha256 text NOT NULL CHECK (pricing_source_sha256 ~ '^[a-f0-9]{64}$'),
  catalog_sha256 text NOT NULL CHECK (catalog_sha256 ~ '^[a-f0-9]{64}$'),
  page_count integer NOT NULL CHECK (page_count > 0),
  openapi_count integer NOT NULL CHECK (openapi_count > 0 AND openapi_count <= page_count),
  pricing_count integer NOT NULL CHECK (pricing_count > 0),
  callable_count integer NOT NULL CHECK (callable_count BETWEEN 0 AND openapi_count),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'array'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, catalog_sha256, pricing_source_sha256)
);

ALTER TABLE provider_endpoint
  ADD COLUMN IF NOT EXISTS platform_name text,
  ADD COLUMN IF NOT EXISTS documentation_group text,
  ADD COLUMN IF NOT EXISTS documentation_url text,
  ADD COLUMN IF NOT EXISTS openapi_url text,
  ADD COLUMN IF NOT EXISTS openapi_sha256 text,
  ADD COLUMN IF NOT EXISTS operation_id text,
  ADD COLUMN IF NOT EXISTS request_codec jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS response_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pagination_strategy jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS catalog_status text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS pricing_status text NOT NULL DEFAULT 'missing',
  ADD COLUMN IF NOT EXISTS permission_status text NOT NULL DEFAULT 'unavailable',
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS vendor_unit_cost_micros bigint,
  ADD COLUMN IF NOT EXISTS normalizer_version text NOT NULL DEFAULT '1.0.0',
  ADD COLUMN IF NOT EXISTS source_catalog_import_id uuid REFERENCES provider_catalog_import_receipt(id) ON DELETE RESTRICT;

UPDATE provider_endpoint
SET platform_name = CASE platform_id
  WHEN 'taobao' THEN '淘宝和天猫'
  WHEN 'search' THEN '跨平台社交媒体'
  ELSE platform_id
END
WHERE platform_name IS NULL;

ALTER TABLE provider_endpoint
  ALTER COLUMN platform_name SET NOT NULL;

ALTER TABLE provider_endpoint
  DROP CONSTRAINT IF EXISTS provider_endpoint_catalog_status_check,
  DROP CONSTRAINT IF EXISTS provider_endpoint_pricing_status_check,
  DROP CONSTRAINT IF EXISTS provider_endpoint_permission_status_check,
  DROP CONSTRAINT IF EXISTS provider_endpoint_openapi_sha256_check,
  DROP CONSTRAINT IF EXISTS provider_endpoint_currency_check,
  DROP CONSTRAINT IF EXISTS provider_endpoint_vendor_cost_check;

ALTER TABLE provider_endpoint
  ADD CONSTRAINT provider_endpoint_catalog_status_check
    CHECK (catalog_status IN ('active', 'deprecated', 'removed', 'missing_openapi', 'legacy')),
  ADD CONSTRAINT provider_endpoint_pricing_status_check
    CHECK (pricing_status IN ('priced', 'unavailable', 'missing')),
  ADD CONSTRAINT provider_endpoint_permission_status_check
    CHECK (permission_status IN ('allowed', 'unavailable')),
  ADD CONSTRAINT provider_endpoint_openapi_sha256_check
    CHECK (openapi_sha256 IS NULL OR openapi_sha256 ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT provider_endpoint_currency_check
    CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT provider_endpoint_vendor_cost_check
    CHECK (vendor_unit_cost_micros IS NULL OR vendor_unit_cost_micros > 0);

CREATE INDEX IF NOT EXISTS provider_endpoint_catalog_lookup_idx
ON provider_endpoint (platform_id, catalog_status, pricing_status, permission_status, endpoint_id);

CREATE INDEX IF NOT EXISTS provider_endpoint_source_import_idx
ON provider_endpoint (source_catalog_import_id);

CREATE OR REPLACE FUNCTION external_data_reject_catalog_receipt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'provider catalog import receipts are immutable';
END;
$$;

DROP TRIGGER IF EXISTS provider_catalog_import_receipt_immutable
ON provider_catalog_import_receipt;
CREATE TRIGGER provider_catalog_import_receipt_immutable
BEFORE UPDATE OR DELETE ON provider_catalog_import_receipt
FOR EACH ROW EXECUTE FUNCTION external_data_reject_catalog_receipt_mutation();

REVOKE ALL ON provider_catalog_import_receipt FROM PUBLIC;
REVOKE ALL ON FUNCTION external_data_reject_catalog_receipt_mutation() FROM PUBLIC;

COMMENT ON TABLE provider_catalog_import_receipt IS
  'Immutable official JustOneAPI documentation/OpenAPI snapshot joined to one immutable pricing import snapshot.';
COMMENT ON COLUMN provider_endpoint.request_codec IS
  'Database-driven query/form/path parameter locations and content type derived from the official OpenAPI operation.';
COMMENT ON COLUMN provider_endpoint.enabled IS
  'True only when current documentation is active and the immutable pricing snapshot marks the endpoint allowed and priced.';

ALTER TABLE external_api_call_raw
  ADD COLUMN IF NOT EXISTS request_query jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS request_content_type text,
  ADD COLUMN IF NOT EXISTS request_body_text text;

ALTER TABLE external_api_call_raw
  DROP CONSTRAINT IF EXISTS external_api_call_raw_request_query_object_check,
  DROP CONSTRAINT IF EXISTS external_api_call_raw_request_body_text_check;

ALTER TABLE external_api_call_raw
  ADD CONSTRAINT external_api_call_raw_request_query_object_check
    CHECK (jsonb_typeof(request_query) = 'object'),
  ADD CONSTRAINT external_api_call_raw_request_body_text_check
    CHECK ((request_body IS NULL) = (request_body_text IS NULL));

CREATE OR REPLACE FUNCTION external_data_enforce_raw_call_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.state IN ('succeeded', 'business_failed', 'unknown') THEN
    RAISE EXCEPTION 'terminal external raw calls are immutable';
  END IF;
  IF OLD.state <> 'dispatched' OR NEW.state NOT IN ('succeeded', 'business_failed', 'unknown') THEN
    RAISE EXCEPTION 'invalid external raw call transition % -> %', OLD.state, NEW.state;
  END IF;
  IF NEW.tenant_id <> OLD.tenant_id
     OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.user_id <> OLD.user_id
     OR NEW.research_request_id <> OLD.research_request_id
     OR NEW.external_query_id <> OLD.external_query_id
     OR NEW.endpoint_id <> OLD.endpoint_id
     OR NEW.request_params <> OLD.request_params
     OR NEW.request_query <> OLD.request_query
     OR NEW.request_body IS DISTINCT FROM OLD.request_body
     OR NEW.request_content_type IS DISTINCT FROM OLD.request_content_type
     OR NEW.request_body_text IS DISTINCT FROM OLD.request_body_text
     OR NEW.request_sha256 <> OLD.request_sha256
     OR NEW.request_bytes <> OLD.request_bytes THEN
    RAISE EXCEPTION 'external raw request identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
