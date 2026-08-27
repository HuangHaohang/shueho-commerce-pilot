DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_pilot_app') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON commerce_external_provider_import, commerce_external_provider_endpoint
    FROM commerce_pilot_app;
    GRANT SELECT
    ON commerce_external_provider_import, commerce_external_provider_endpoint
    TO commerce_pilot_app;
  END IF;
END;
$$;
