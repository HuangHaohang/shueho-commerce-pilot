DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'commerce_creative_canvas_node_revision'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) LIKE '%node_id, content_sha256%'
  LIMIT 1;
  IF constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE commerce_creative_canvas_node_revision DROP CONSTRAINT %I',
      constraint_name
    );
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS commerce_creative_canvas_harness_revision_hash_idx
ON commerce_creative_canvas_node_revision (
  tenant_id, workspace_id, node_id, content_sha256
)
WHERE origin = 'harness';

COMMENT ON INDEX commerce_creative_canvas_harness_revision_hash_idx IS
  'Deduplicates immutable Harness snapshots while allowing users to restore an earlier edited value as a new revision.';
