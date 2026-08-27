CREATE TABLE IF NOT EXISTS provider_market_option (
  provider text NOT NULL DEFAULT 'justoneapi' CHECK (provider='justoneapi'),
  endpoint_id text NOT NULL REFERENCES provider_endpoint(endpoint_id) ON DELETE RESTRICT,
  platform_id text NOT NULL CHECK (platform_id ~ '^[a-z0-9_]+$'),
  parameter_name text NOT NULL CHECK (parameter_name ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'),
  market_code text NOT NULL CHECK (market_code ~ '^[A-Z0-9_-]{2,32}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
  locale text NOT NULL DEFAULT 'zh-CN' CHECK (locale='zh-CN'),
  schema_version text NOT NULL,
  source_catalog_import_id uuid NOT NULL
    REFERENCES provider_catalog_import_receipt(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (endpoint_id,parameter_name,market_code)
);

CREATE INDEX IF NOT EXISTS provider_market_option_platform_idx
ON provider_market_option (platform_id,enabled,parameter_name,market_code);

REVOKE ALL ON provider_market_option FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='external_data_app') THEN
    GRANT SELECT ON provider_market_option TO external_data_app;
  END IF;
END;
$$;

COMMENT ON TABLE provider_market_option IS
  'Database master data derived from official OpenAPI market/site/country/region enum values; runtime Agents never own this list.';
