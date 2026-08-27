ALTER TABLE commerce_external_data_archive
ADD COLUMN IF NOT EXISTS warehouse_research_request_id uuid,
ADD COLUMN IF NOT EXISTS warehouse_raw_call_id uuid,
ADD COLUMN IF NOT EXISTS warehouse_query_key text;

ALTER TABLE commerce_external_data_archive
DROP CONSTRAINT IF EXISTS commerce_external_data_archive_warehouse_query_key_check;
ALTER TABLE commerce_external_data_archive
ADD CONSTRAINT commerce_external_data_archive_warehouse_query_key_check
CHECK (warehouse_query_key IS NULL OR warehouse_query_key ~ '^[a-f0-9]{64}$');

CREATE INDEX IF NOT EXISTS commerce_external_data_archive_warehouse_request_idx
ON commerce_external_data_archive (tenant_id, workspace_id, warehouse_research_request_id)
WHERE warehouse_research_request_id IS NOT NULL;

COMMENT ON TABLE commerce_external_data_archive IS
  'SQL-only Commerce Pilot governance receipt. Legacy rows may contain complete JustOneAPI MCP responses; new calls link to the independent SHUEHO warehouse where the complete REST response is authoritative.';
COMMENT ON COLUMN commerce_external_data_archive.warehouse_raw_call_id IS
  'Opaque SQL-only link to the independent external-data warehouse raw record; no product read API exposes it.';
