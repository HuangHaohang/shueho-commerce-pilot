CREATE TABLE research_policy_import_receipt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_sha256 text NOT NULL UNIQUE CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
  source_document jsonb NOT NULL,
  catalog_import_id uuid NOT NULL REFERENCES provider_catalog_import_receipt(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION immutable_research_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Research policy import receipts are immutable'; END $$;
CREATE TRIGGER research_policy_immutable BEFORE UPDATE OR DELETE ON research_policy_import_receipt
FOR EACH ROW EXECUTE FUNCTION immutable_research_policy();
GRANT SELECT ON research_policy_import_receipt TO external_data_app;
ALTER TABLE research_task ALTER COLUMN execution_version SET DEFAULT 3;
