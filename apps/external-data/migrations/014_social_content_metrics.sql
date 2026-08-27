ALTER TABLE social_search_item
  ADD COLUMN IF NOT EXISTS provider_entity_id text,
  ADD COLUMN IF NOT EXISTS metrics jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE business_content_observation
  ADD COLUMN IF NOT EXISTS metrics jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE social_search_item
  DROP CONSTRAINT IF EXISTS social_search_item_metrics_object_check,
  ADD CONSTRAINT social_search_item_metrics_object_check
    CHECK (jsonb_typeof(metrics) = 'object');

ALTER TABLE business_content_observation
  DROP CONSTRAINT IF EXISTS business_content_observation_metrics_object_check,
  ADD CONSTRAINT business_content_observation_metrics_object_check
    CHECK (jsonb_typeof(metrics) = 'object');

COMMENT ON COLUMN social_search_item.metrics IS
  'Normalized provider-reported engagement metrics; complete source fields remain in raw_data.';
COMMENT ON COLUMN social_search_item.provider_entity_id IS
  'Provider content identifier when the response supplies one; raw_data remains authoritative.';
COMMENT ON COLUMN business_content_observation.metrics IS
  'Quality-checked public content metrics promoted from the source layer without inventing missing values.';
