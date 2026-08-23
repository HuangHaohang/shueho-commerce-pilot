DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_pilot_app') THEN
    CREATE ROLE commerce_pilot_app
      LOGIN
      PASSWORD 'commerce_pilot_app_dev'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOBYPASSRLS;
  END IF;
END;
$$;

GRANT CONNECT ON DATABASE commerce_pilot TO commerce_pilot_app;
GRANT USAGE ON SCHEMA public TO commerce_pilot_app;
