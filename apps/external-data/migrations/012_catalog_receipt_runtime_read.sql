REVOKE ALL ON provider_catalog_import_receipt FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'external_data_app') THEN
    GRANT SELECT ON provider_catalog_import_receipt TO external_data_app;
  END IF;
END;
$$;

COMMENT ON TABLE provider_catalog_import_receipt IS
  'Immutable non-secret provider contract manifest. Runtime may read receipt hashes/counts for health and drift verification but cannot mutate it.';
