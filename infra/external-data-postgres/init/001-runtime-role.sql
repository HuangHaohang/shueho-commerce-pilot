DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'external_data_app') THEN
    CREATE ROLE external_data_app LOGIN PASSWORD 'external_data_app_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE commerce_external_data TO external_data_app;
