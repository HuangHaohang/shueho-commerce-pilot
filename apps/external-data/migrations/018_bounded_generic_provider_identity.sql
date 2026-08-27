DROP INDEX IF EXISTS generic_source_record_identity_idx;

UPDATE generic_source_record
SET provider_entity_id = NULL
WHERE provider_entity_id IS NOT NULL
  AND (
    char_length(provider_entity_id) > 255
    OR octet_length(provider_entity_id) > 1024
    OR provider_entity_id ~ '[[:space:][:cntrl:]]'
  );

ALTER TABLE generic_source_record
  DROP CONSTRAINT IF EXISTS generic_source_record_provider_entity_id_check;
ALTER TABLE generic_source_record
  ADD CONSTRAINT generic_source_record_provider_entity_id_check
  CHECK (
    provider_entity_id IS NULL
    OR (
      char_length(provider_entity_id) BETWEEN 1 AND 255
      AND octet_length(provider_entity_id) <= 1024
      AND provider_entity_id !~ '[[:space:][:cntrl:]]'
    )
  );

CREATE INDEX generic_source_record_identity_idx
ON generic_source_record (tenant_id, workspace_id, record_kind, provider_entity_id)
WHERE provider_entity_id IS NOT NULL;

COMMENT ON COLUMN generic_source_record.provider_entity_id IS
  'Bounded scalar provider identity selected from known identifier keys; malformed or oversized values remain only in raw_data.';
