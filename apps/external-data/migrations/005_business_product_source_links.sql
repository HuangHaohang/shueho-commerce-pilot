ALTER TABLE business_product_observation
ADD COLUMN IF NOT EXISTS source_name text NOT NULL DEFAULT '淘宝/天猫',
ADD COLUMN IF NOT EXISTS canonical_url text,
ADD COLUMN IF NOT EXISTS url_derivation text;

COMMENT ON COLUMN business_product_observation.canonical_url IS
  'Public product URL derived from the provider item id when the provider response does not supply one.';
COMMENT ON COLUMN business_product_observation.url_derivation IS
  'Explicit provenance for a constructed URL; never represents a provider-returned field.';
