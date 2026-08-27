ALTER TABLE commerce_external_data_policy
  ALTER COLUMN allowed_platforms SET DEFAULT '{}'::text[];

UPDATE commerce_external_data_policy
SET allowed_platforms = '{}'::text[],
    allowed_endpoint_ids = '{}'::text[],
    updated_at = CURRENT_TIMESTAMP
WHERE updated_by_user_id IS NULL;
