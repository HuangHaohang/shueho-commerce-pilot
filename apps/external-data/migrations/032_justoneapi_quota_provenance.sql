ALTER TABLE justoneapi_quota_import
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object');
COMMENT ON COLUMN justoneapi_quota_import.metadata IS
  'Quota basis, import mode and source-evidence hashes; operator conservative caps must not be represented as official initial entitlements.';
