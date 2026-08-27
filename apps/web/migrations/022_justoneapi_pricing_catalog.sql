CREATE TABLE IF NOT EXISTS commerce_external_provider_import (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'justoneapi' CHECK (provider = 'justoneapi'),
  source_filename text NOT NULL CHECK (char_length(source_filename) BETWEEN 1 AND 255),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_exported_at timestamptz NOT NULL,
  source_filter text NOT NULL,
  source_search text NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  row_count integer NOT NULL CHECK (row_count > 0),
  allowed_row_count integer NOT NULL CHECK (allowed_row_count BETWEEN 0 AND row_count),
  imported_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, source_sha256)
);

CREATE TABLE IF NOT EXISTS commerce_external_provider_endpoint (
  provider text NOT NULL DEFAULT 'justoneapi' CHECK (provider = 'justoneapi'),
  endpoint_id text NOT NULL CHECK (endpoint_id ~ '^[a-z0-9_]+\.[a-zA-Z0-9_.-]+$'),
  platform_id text NOT NULL CHECK (platform_id ~ '^[a-z0-9_]+$'),
  platform_name text NOT NULL CHECK (char_length(platform_name) BETWEEN 1 AND 100),
  api_path text NOT NULL CHECK (api_path ~ '^/api/[A-Za-z0-9._/-]+$'),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  vendor_unit_cost_micros bigint NOT NULL CHECK (vendor_unit_cost_micros > 0),
  permission_status text NOT NULL CHECK (permission_status IN ('allowed', 'unavailable')),
  is_active boolean NOT NULL DEFAULT true,
  source_import_id uuid NOT NULL REFERENCES commerce_external_provider_import(id) ON DELETE RESTRICT,
  source_exported_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, endpoint_id),
  UNIQUE (provider, api_path)
);

CREATE INDEX IF NOT EXISTS commerce_external_provider_endpoint_platform_idx
ON commerce_external_provider_endpoint (provider, platform_id, permission_status, endpoint_id)
WHERE is_active = true;

DROP TRIGGER IF EXISTS commerce_external_provider_endpoint_updated_at
ON commerce_external_provider_endpoint;
CREATE TRIGGER commerce_external_provider_endpoint_updated_at
BEFORE UPDATE ON commerce_external_provider_endpoint
FOR EACH ROW EXECUTE FUNCTION commerce_set_updated_at();

REVOKE ALL ON commerce_external_provider_import FROM PUBLIC;
REVOKE ALL ON commerce_external_provider_endpoint FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_pilot_app') THEN
    GRANT SELECT ON commerce_external_provider_import TO commerce_pilot_app;
    GRANT SELECT ON commerce_external_provider_endpoint TO commerce_pilot_app;
  END IF;
END;
$$;
