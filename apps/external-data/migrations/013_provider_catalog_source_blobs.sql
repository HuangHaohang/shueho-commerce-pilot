CREATE TABLE IF NOT EXISTS provider_catalog_source_blob (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES provider_catalog_import_receipt(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'justoneapi' CHECK (provider = 'justoneapi'),
  source_kind text NOT NULL CHECK (source_kind IN ('sitemap', 'openapi')),
  endpoint_id text,
  source_url text NOT NULL CHECK (source_url ~ '^https://docs\.justoneapi\.com/'),
  content_type text NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_bytes integer NOT NULL CHECK (source_bytes > 0 AND source_bytes <= 5242880),
  body_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (receipt_id, source_url),
  CHECK ((source_kind = 'sitemap' AND endpoint_id IS NULL) OR (source_kind = 'openapi' AND endpoint_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS provider_catalog_source_blob_endpoint_idx
ON provider_catalog_source_blob (receipt_id, endpoint_id)
WHERE endpoint_id IS NOT NULL;

DROP TRIGGER IF EXISTS provider_catalog_source_blob_immutable
ON provider_catalog_source_blob;
CREATE TRIGGER provider_catalog_source_blob_immutable
BEFORE UPDATE OR DELETE ON provider_catalog_source_blob
FOR EACH ROW EXECUTE FUNCTION external_data_reject_catalog_receipt_mutation();

REVOKE ALL ON provider_catalog_source_blob FROM PUBLIC;

COMMENT ON TABLE provider_catalog_source_blob IS
  'Immutable byte-equivalent text capture of the official sitemap and every OpenAPI JSON document used by a catalog receipt. No runtime role access is granted.';
