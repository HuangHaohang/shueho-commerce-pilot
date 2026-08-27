CREATE TABLE IF NOT EXISTS business_product (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  platform text NOT NULL,
  platform_item_id text NOT NULL,
  current_title text,
  current_shop_id text,
  current_shop_name text,
  current_image_url text,
  canonical_url text,
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, workspace_id, platform, platform_item_id)
);

CREATE INDEX IF NOT EXISTS business_product_scope_seen_idx
ON business_product (tenant_id, workspace_id, last_observed_at DESC);

ALTER TABLE business_product ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_product FORCE ROW LEVEL SECURITY;
CREATE POLICY external_data_scope ON business_product
USING (
  tenant_id = NULLIF(current_setting('external_data.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('external_data.workspace_id', true), '')::uuid
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('external_data.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('external_data.workspace_id', true), '')::uuid
);

CREATE TRIGGER business_product_updated_at
BEFORE UPDATE ON business_product
FOR EACH ROW EXECUTE FUNCTION external_data_set_updated_at();

ALTER TABLE business_product_observation
ADD COLUMN IF NOT EXISTS business_product_id uuid REFERENCES business_product(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS business_product_observation_master_idx
ON business_product_observation (tenant_id, workspace_id, business_product_id, observed_at DESC);

REVOKE ALL ON business_product FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'external_data_app') THEN
    GRANT SELECT, INSERT, UPDATE ON business_product TO external_data_app;
  END IF;
END;
$$;

COMMENT ON TABLE business_product IS
  'Stable tenant/workspace product identity. Time-varying price, sales and ranking remain in business_product_observation.';
