CREATE TABLE IF NOT EXISTS commerce_product_source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('file_upload', 'rest_api', 'erp', 'pim', 'marketplace', 'database')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  connector_key text CHECK (connector_key IS NULL OR connector_key ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  connector_version text CHECK (connector_version IS NULL OR char_length(connector_version) BETWEEN 1 AND 64),
  credential_ref text CHECK (credential_ref IS NULL OR char_length(credential_ref) BETWEEN 1 AND 512),
  public_config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(public_config) = 'object'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'error', 'archived')),
  created_by_user_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, workspace_id, id),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS commerce_product_source_scope_name_idx
ON commerce_product_source (tenant_id, workspace_id, lower(name))
WHERE status <> 'archived';

CREATE TABLE IF NOT EXISTS commerce_product_import_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  source_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 240),
  content_type text NOT NULL CHECK (content_type IN ('text/csv', 'application/json')),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  content_bytes integer NOT NULL CHECK (content_bytes BETWEEN 1 AND 5242880),
  source_schema_hash text CHECK (source_schema_hash IS NULL OR source_schema_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'profiled', 'needs_review', 'validated', 'importing', 'completed', 'failed', 'cancelled')),
  total_records integer NOT NULL DEFAULT 0 CHECK (total_records BETWEEN 0 AND 10000),
  imported_products integer NOT NULL DEFAULT 0 CHECK (imported_products BETWEEN 0 AND 10000),
  imported_variants integer NOT NULL DEFAULT 0 CHECK (imported_variants BETWEEN 0 AND 50000),
  issue_count integer NOT NULL DEFAULT 0 CHECK (issue_count BETWEEN 0 AND 100000),
  mapping_revision_id uuid,
  activation_idempotency_key uuid,
  root_thread_id text CHECK (root_thread_id IS NULL OR char_length(root_thread_id) BETWEEN 8 AND 128),
  turn_id text CHECK (turn_id IS NULL OR char_length(turn_id) BETWEEN 8 AND 128),
  tool_call_id text CHECK (tool_call_id IS NULL OR char_length(tool_call_id) BETWEEN 1 AND 128),
  failure_code text CHECK (failure_code IS NULL OR char_length(failure_code) BETWEEN 1 AND 80),
  failure_message text CHECK (failure_message IS NULL OR char_length(failure_message) BETWEEN 1 AND 1000),
  created_by_user_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, workspace_id, id),
  UNIQUE (tenant_id, workspace_id, idempotency_key),
  UNIQUE (tenant_id, workspace_id, activation_idempotency_key),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, workspace_id, source_id)
    REFERENCES commerce_product_source(tenant_id, workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS commerce_product_import_scope_time_idx
ON commerce_product_import_run (tenant_id, workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS commerce_product_source_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  import_run_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 9999),
  source_pointer text NOT NULL CHECK (char_length(source_pointer) BETWEEN 1 AND 512),
  external_product_key text CHECK (external_product_key IS NULL OR char_length(external_product_key) BETWEEN 1 AND 255),
  external_variant_key text CHECK (external_variant_key IS NULL OR char_length(external_variant_key) BETWEEN 1 AND 255),
  raw_payload jsonb NOT NULL CHECK (jsonb_typeof(raw_payload) = 'object'),
  raw_sha256 text NOT NULL CHECK (raw_sha256 ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, workspace_id, id),
  UNIQUE (tenant_id, workspace_id, import_run_id, ordinal),
  FOREIGN KEY (tenant_id, workspace_id, import_run_id)
    REFERENCES commerce_product_import_run(tenant_id, workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS commerce_product_source_record_identity_idx
ON commerce_product_source_record
  (tenant_id, workspace_id, import_run_id, external_product_key, external_variant_key);

CREATE TABLE IF NOT EXISTS commerce_product_mapping_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  source_id uuid NOT NULL,
  import_run_id uuid,
  revision_number integer NOT NULL CHECK (revision_number BETWEEN 1 AND 1000000),
  source_schema_hash text NOT NULL CHECK (source_schema_hash ~ '^[a-f0-9]{64}$'),
  mapping_schema_version integer NOT NULL DEFAULT 1 CHECK (mapping_schema_version = 1),
  proposal_source text NOT NULL CHECK (proposal_source IN ('deterministic', 'harness', 'manual')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'active', 'superseded', 'rejected')),
  mapping_document jsonb NOT NULL CHECK (jsonb_typeof(mapping_document) = 'object'),
  model_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(model_metadata) = 'object'),
  input_profile_hash text CHECK (input_profile_hash IS NULL OR input_profile_hash ~ '^[a-f0-9]{64}$'),
  confidence double precision CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  root_thread_id text CHECK (root_thread_id IS NULL OR char_length(root_thread_id) BETWEEN 8 AND 128),
  turn_id text CHECK (turn_id IS NULL OR char_length(turn_id) BETWEEN 8 AND 128),
  tool_call_id text CHECK (tool_call_id IS NULL OR char_length(tool_call_id) BETWEEN 1 AND 128),
  created_by_user_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  validated_by_user_id text REFERENCES "user"(id) ON DELETE RESTRICT,
  activated_by_user_id text REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  validated_at timestamptz,
  activated_at timestamptz,
  UNIQUE (tenant_id, workspace_id, id),
  UNIQUE (tenant_id, workspace_id, source_id, revision_number),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, workspace_id, source_id)
    REFERENCES commerce_product_source(tenant_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, workspace_id, import_run_id)
    REFERENCES commerce_product_import_run(tenant_id, workspace_id, id) ON DELETE RESTRICT
);

ALTER TABLE commerce_product_import_run
  ADD CONSTRAINT commerce_product_import_mapping_revision_fk
  FOREIGN KEY (tenant_id, workspace_id, mapping_revision_id)
  REFERENCES commerce_product_mapping_revision(tenant_id, workspace_id, id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS commerce_product_mapping_field (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  mapping_revision_id uuid NOT NULL,
  source_path text NOT NULL CHECK (char_length(source_path) BETWEEN 1 AND 512),
  target_field text NOT NULL CHECK (target_field IN (
    'product.key', 'product.title', 'product.description', 'product.brand_name',
    'product.category_path', 'product.image_url', 'product.attributes',
    'variant.sku', 'variant.title', 'variant.gtin', 'variant.option_values', 'variant.attributes'
  )),
  transform text NOT NULL CHECK (transform IN (
    'identity', 'trim', 'nfkc', 'string', 'string_array', 'object', 'url', 'gtin'
  )),
  transform_options jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(transform_options) = 'object'),
  required boolean NOT NULL DEFAULT false,
  confidence double precision CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  evidence text CHECK (evidence IS NULL OR char_length(evidence) BETWEEN 1 AND 1000),
  review_state text NOT NULL DEFAULT 'pending' CHECK (review_state IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, workspace_id, id),
  UNIQUE (tenant_id, workspace_id, mapping_revision_id, target_field),
  FOREIGN KEY (tenant_id, workspace_id, mapping_revision_id)
    REFERENCES commerce_product_mapping_revision(tenant_id, workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS commerce_product_import_issue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  import_run_id uuid NOT NULL,
  source_record_id uuid,
  mapping_revision_id uuid,
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  issue_code text NOT NULL CHECK (issue_code ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  source_field text CHECK (source_field IS NULL OR char_length(source_field) BETWEEN 1 AND 512),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1000),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'accepted', 'resolved', 'ignored')),
  resolved_by_user_id text REFERENCES "user"(id) ON DELETE RESTRICT,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, workspace_id, id),
  FOREIGN KEY (tenant_id, workspace_id, import_run_id)
    REFERENCES commerce_product_import_run(tenant_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, workspace_id, source_record_id)
    REFERENCES commerce_product_source_record(tenant_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, workspace_id, mapping_revision_id)
    REFERENCES commerce_product_mapping_revision(tenant_id, workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS commerce_product_import_issue_open_idx
ON commerce_product_import_issue (tenant_id, workspace_id, import_run_id, severity, created_at)
WHERE state = 'open';

CREATE TABLE IF NOT EXISTS commerce_product (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  internal_product_key text NOT NULL CHECK (char_length(internal_product_key) BETWEEN 1 AND 255),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  current_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, workspace_id, id),
  UNIQUE (tenant_id, workspace_id, internal_product_key),
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS commerce_product_scope_updated_idx
ON commerce_product (tenant_id, workspace_id, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS commerce_product_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  product_id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number BETWEEN 1 AND 1000000),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
  description text CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 50000),
  brand_name text CHECK (brand_name IS NULL OR char_length(brand_name) BETWEEN 1 AND 500),
  category_path text CHECK (category_path IS NULL OR char_length(category_path) BETWEEN 1 AND 1000),
  primary_image_url text CHECK (primary_image_url IS NULL OR char_length(primary_image_url) BETWEEN 1 AND 2048),
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  source_import_id uuid NOT NULL,
  source_record_id uuid NOT NULL,
  mapping_revision_id uuid NOT NULL,
  review_status text NOT NULL DEFAULT 'approved' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  created_by_user_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, workspace_id, id),
  UNIQUE (tenant_id, workspace_id, id, product_id),
  UNIQUE (tenant_id, workspace_id, product_id, revision_number),
  UNIQUE (tenant_id, workspace_id, product_id, content_sha256),
  FOREIGN KEY (tenant_id, workspace_id, product_id)
    REFERENCES commerce_product(tenant_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, workspace_id, source_import_id)
    REFERENCES commerce_product_import_run(tenant_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, workspace_id, source_record_id)
    REFERENCES commerce_product_source_record(tenant_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, workspace_id, mapping_revision_id)
    REFERENCES commerce_product_mapping_revision(tenant_id, workspace_id, id) ON DELETE RESTRICT
);

ALTER TABLE commerce_product
  ADD CONSTRAINT commerce_product_current_revision_fk
  FOREIGN KEY (tenant_id, workspace_id, current_revision_id, id)
  REFERENCES commerce_product_revision(tenant_id, workspace_id, id, product_id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS commerce_product_variant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  product_id uuid NOT NULL,
  internal_sku text NOT NULL CHECK (char_length(internal_sku) BETWEEN 1 AND 255),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  current_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, workspace_id, id),
  UNIQUE (tenant_id, workspace_id, internal_sku),
  UNIQUE (tenant_id, workspace_id, id, product_id),
  FOREIGN KEY (tenant_id, workspace_id, product_id)
    REFERENCES commerce_product(tenant_id, workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS commerce_product_variant_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number BETWEEN 1 AND 1000000),
  title text CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 500),
  gtin text CHECK (gtin IS NULL OR gtin ~ '^[0-9]{8,14}$'),
  option_values jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(option_values) = 'object'),
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  source_import_id uuid NOT NULL,
  source_record_id uuid NOT NULL,
  mapping_revision_id uuid NOT NULL,
  review_status text NOT NULL DEFAULT 'approved' CHECK (review_status IN ('pending', 'approved', 'rejected')),
  created_by_user_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, workspace_id, id),
  UNIQUE (tenant_id, workspace_id, id, variant_id),
  UNIQUE (tenant_id, workspace_id, variant_id, revision_number),
  UNIQUE (tenant_id, workspace_id, variant_id, content_sha256),
  FOREIGN KEY (tenant_id, workspace_id, variant_id)
    REFERENCES commerce_product_variant(tenant_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, workspace_id, source_import_id)
    REFERENCES commerce_product_import_run(tenant_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, workspace_id, source_record_id)
    REFERENCES commerce_product_source_record(tenant_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, workspace_id, mapping_revision_id)
    REFERENCES commerce_product_mapping_revision(tenant_id, workspace_id, id) ON DELETE RESTRICT
);

ALTER TABLE commerce_product_variant
  ADD CONSTRAINT commerce_product_variant_current_revision_fk
  FOREIGN KEY (tenant_id, workspace_id, current_revision_id, id)
  REFERENCES commerce_product_variant_revision(tenant_id, workspace_id, id, variant_id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS commerce_product_source_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  source_id uuid NOT NULL,
  external_product_key text NOT NULL CHECK (char_length(external_product_key) BETWEEN 1 AND 255),
  external_variant_key text NOT NULL DEFAULT '' CHECK (char_length(external_variant_key) <= 255),
  product_id uuid NOT NULL,
  variant_id uuid,
  latest_source_record_id uuid NOT NULL,
  mapping_revision_id uuid NOT NULL,
  match_method text NOT NULL CHECK (match_method IN ('source_key', 'manual', 'ai_proposed')),
  confidence double precision CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  review_state text NOT NULL DEFAULT 'accepted' CHECK (review_state IN ('pending', 'accepted', 'rejected', 'conflict')),
  first_seen_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, workspace_id, id),
  UNIQUE (tenant_id, workspace_id, source_id, external_product_key, external_variant_key),
  FOREIGN KEY (tenant_id, workspace_id, source_id)
    REFERENCES commerce_product_source(tenant_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, workspace_id, product_id)
    REFERENCES commerce_product(tenant_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, workspace_id, variant_id, product_id)
    REFERENCES commerce_product_variant(tenant_id, workspace_id, id, product_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, workspace_id, latest_source_record_id)
    REFERENCES commerce_product_source_record(tenant_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, workspace_id, mapping_revision_id)
    REFERENCES commerce_product_mapping_revision(tenant_id, workspace_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS commerce_product_field_lineage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  product_revision_id uuid,
  variant_revision_id uuid,
  mapping_field_id uuid NOT NULL,
  source_record_id uuid NOT NULL,
  target_field text NOT NULL CHECK (char_length(target_field) BETWEEN 1 AND 80),
  source_path text NOT NULL CHECK (char_length(source_path) BETWEEN 1 AND 512),
  raw_value_sha256 text NOT NULL CHECK (raw_value_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, workspace_id, id),
  CHECK ((product_revision_id IS NULL) <> (variant_revision_id IS NULL)),
  FOREIGN KEY (tenant_id, workspace_id, product_revision_id)
    REFERENCES commerce_product_revision(tenant_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, workspace_id, variant_revision_id)
    REFERENCES commerce_product_variant_revision(tenant_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, workspace_id, mapping_field_id)
    REFERENCES commerce_product_mapping_field(tenant_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, workspace_id, source_record_id)
    REFERENCES commerce_product_source_record(tenant_id, workspace_id, id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION commerce_product_reject_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION commerce_product_enforce_mapping_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('active', 'superseded', 'rejected') THEN
    RAISE EXCEPTION 'terminal product mapping revisions are immutable';
  END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.source_id <> OLD.source_id OR NEW.revision_number <> OLD.revision_number
     OR NEW.source_schema_hash <> OLD.source_schema_hash
     OR NEW.mapping_schema_version <> OLD.mapping_schema_version
     OR NEW.proposal_source <> OLD.proposal_source
     OR NEW.mapping_document <> OLD.mapping_document
     OR NEW.model_metadata <> OLD.model_metadata
     OR NEW.input_profile_hash IS DISTINCT FROM OLD.input_profile_hash
     OR NEW.root_thread_id IS DISTINCT FROM OLD.root_thread_id
     OR NEW.turn_id IS DISTINCT FROM OLD.turn_id
     OR NEW.tool_call_id IS DISTINCT FROM OLD.tool_call_id
     OR NEW.created_by_user_id <> OLD.created_by_user_id THEN
    RAISE EXCEPTION 'product mapping revision identity and proposal are immutable';
  END IF;
  IF NOT (
    (OLD.status = 'draft' AND NEW.status IN ('draft', 'validated', 'rejected'))
    OR (OLD.status = 'validated' AND NEW.status IN ('validated', 'active', 'rejected'))
  ) THEN
    RAISE EXCEPTION 'invalid product mapping transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION commerce_product_enforce_mapping_field_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status INTO parent_status
  FROM commerce_product_mapping_revision
  WHERE tenant_id = NEW.tenant_id
    AND workspace_id = NEW.workspace_id
    AND id = NEW.mapping_revision_id;
  IF parent_status <> 'draft' THEN
    RAISE EXCEPTION 'mapping fields can change only while their revision is draft';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'commerce_product_source_record',
    'commerce_product_revision',
    'commerce_product_variant_revision',
    'commerce_product_field_lineage'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_immutable ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I_immutable BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION commerce_product_reject_immutable_mutation()',
      table_name, table_name
    );
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS commerce_product_mapping_revision_immutable ON commerce_product_mapping_revision;
CREATE TRIGGER commerce_product_mapping_revision_immutable
BEFORE UPDATE ON commerce_product_mapping_revision
FOR EACH ROW EXECUTE FUNCTION commerce_product_enforce_mapping_revision_mutation();

DROP TRIGGER IF EXISTS commerce_product_mapping_field_draft_only ON commerce_product_mapping_field;
CREATE TRIGGER commerce_product_mapping_field_draft_only
BEFORE INSERT OR UPDATE ON commerce_product_mapping_field
FOR EACH ROW EXECUTE FUNCTION commerce_product_enforce_mapping_field_mutation();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'commerce_product_source', 'commerce_product_import_run',
    'commerce_product', 'commerce_product_variant', 'commerce_product_source_link'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_updated_at ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION commerce_set_updated_at()',
      table_name, table_name
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'commerce_product_source', 'commerce_product_import_run', 'commerce_product_source_record',
    'commerce_product_mapping_revision', 'commerce_product_mapping_field', 'commerce_product_import_issue',
    'commerce_product', 'commerce_product_revision', 'commerce_product_variant',
    'commerce_product_variant_revision', 'commerce_product_source_link', 'commerce_product_field_lineage'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I_isolation ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I_isolation ON %I USING (
        tenant_id = NULLIF(current_setting(''commerce.tenant_id'', true), '''')::uuid
        AND workspace_id = NULLIF(current_setting(''commerce.workspace_id'', true), '''')::uuid
      ) WITH CHECK (
        tenant_id = NULLIF(current_setting(''commerce.tenant_id'', true), '''')::uuid
        AND workspace_id = NULLIF(current_setting(''commerce.workspace_id'', true), '''')::uuid
      )',
      table_name, table_name
    );
  END LOOP;
END;
$$;

REVOKE ALL ON commerce_product_source, commerce_product_import_run, commerce_product_source_record,
  commerce_product_mapping_revision, commerce_product_mapping_field, commerce_product_import_issue,
  commerce_product, commerce_product_revision, commerce_product_variant,
  commerce_product_variant_revision, commerce_product_source_link, commerce_product_field_lineage
FROM PUBLIC;
REVOKE ALL ON FUNCTION commerce_product_reject_immutable_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION commerce_product_enforce_mapping_revision_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION commerce_product_enforce_mapping_field_mutation() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_pilot_app') THEN
    GRANT SELECT, INSERT, UPDATE ON
      commerce_product_source, commerce_product_import_run,
      commerce_product_mapping_revision, commerce_product_mapping_field, commerce_product_import_issue,
      commerce_product, commerce_product_variant, commerce_product_source_link
    TO commerce_pilot_app;
    GRANT SELECT, INSERT ON
      commerce_product_source_record, commerce_product_revision,
      commerce_product_variant_revision, commerce_product_field_lineage
    TO commerce_pilot_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO commerce_pilot_app;
  END IF;
END;
$$;

COMMENT ON TABLE commerce_product_source_record IS
  'Immutable workspace product-source records. Unknown fields remain in raw_payload and AI decisions never overwrite them.';
COMMENT ON TABLE commerce_product_mapping_revision IS
  'Versioned declarative product mappings proposed by deterministic rules, Harness, or a human and activated only after server validation.';
COMMENT ON TABLE commerce_product IS
  'Stable first-party workspace Product/SPU identity; current fields are projected from immutable revisions.';
COMMENT ON TABLE commerce_product_variant IS
  'Stable first-party workspace Variant/SKU identity; current fields are projected from immutable revisions.';
