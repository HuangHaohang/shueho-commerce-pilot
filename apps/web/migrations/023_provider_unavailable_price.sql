ALTER TABLE commerce_external_provider_endpoint
  ALTER COLUMN vendor_unit_cost_micros DROP NOT NULL;

ALTER TABLE commerce_external_provider_endpoint
  DROP CONSTRAINT IF EXISTS commerce_external_provider_endpoint_vendor_unit_cost_micros_check;

ALTER TABLE commerce_external_provider_endpoint
  ADD CONSTRAINT commerce_external_provider_endpoint_vendor_unit_cost_micros_check
  CHECK (
    (permission_status = 'allowed' AND vendor_unit_cost_micros > 0)
    OR
    (permission_status = 'unavailable'
      AND (vendor_unit_cost_micros IS NULL OR vendor_unit_cost_micros > 0))
  );
