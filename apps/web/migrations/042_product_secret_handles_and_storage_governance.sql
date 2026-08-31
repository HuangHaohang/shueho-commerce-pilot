-- Tenant-bound connector handles and bounded product-import retention.

ALTER TABLE commerce_enterprise_contract
  ADD COLUMN IF NOT EXISTS product_import_storage_limit_bytes bigint NOT NULL DEFAULT 1073741824,
  ADD COLUMN IF NOT EXISTS product_import_workspace_storage_limit_bytes bigint NOT NULL DEFAULT 536870912,
  ADD COLUMN IF NOT EXISTS product_import_retention_days integer NOT NULL DEFAULT 180;

ALTER TABLE commerce_enterprise_contract
  ADD CONSTRAINT commerce_enterprise_contract_product_import_storage_check
  CHECK (
    product_import_storage_limit_bytes BETWEEN 5242880 AND 1099511627776
    AND product_import_workspace_storage_limit_bytes BETWEEN 5242880 AND product_import_storage_limit_bytes
    AND product_import_retention_days BETWEEN 1 AND 3650
  );

ALTER TABLE commerce_product_import_run
  ADD COLUMN IF NOT EXISTS retention_until timestamptz,
  ADD COLUMN IF NOT EXISTS legal_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS raw_payload_purged_at timestamptz,
  ADD COLUMN IF NOT EXISTS raw_payload_purged_bytes bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS raw_storage_bytes bigint,
  ADD COLUMN IF NOT EXISTS content_dedupe_enforced boolean NOT NULL DEFAULT false;

UPDATE commerce_product_import_run import_run
SET retention_until = import_run.created_at + make_interval(days => contract.product_import_retention_days)
FROM commerce_enterprise_contract contract
WHERE contract.tenant_id = import_run.tenant_id
  AND import_run.retention_until IS NULL;

UPDATE commerce_product_import_run
SET raw_storage_bytes = GREATEST(
  content_bytes::bigint * 4,
  content_bytes::bigint + total_records::bigint * 512
)
WHERE raw_storage_bytes IS NULL;

ALTER TABLE commerce_product_import_run
  ALTER COLUMN retention_until SET NOT NULL,
  ALTER COLUMN raw_storage_bytes SET NOT NULL,
  ALTER COLUMN content_dedupe_enforced SET DEFAULT true,
  ADD CONSTRAINT commerce_product_import_retention_check
  CHECK (
    retention_until > created_at
    AND raw_storage_bytes >= content_bytes
    AND raw_payload_purged_bytes >= 0
    AND (raw_payload_purged_at IS NULL OR raw_payload_purged_at >= created_at)
  );

CREATE UNIQUE INDEX IF NOT EXISTS commerce_product_import_content_replay_idx
ON commerce_product_import_run (tenant_id, workspace_id, content_sha256)
WHERE content_dedupe_enforced AND raw_payload_purged_at IS NULL;

CREATE INDEX IF NOT EXISTS commerce_product_import_retention_idx
ON commerce_product_import_run (tenant_id, retention_until, created_at)
WHERE raw_payload_purged_at IS NULL AND legal_hold = false;

CREATE TABLE IF NOT EXISTS commerce_product_secret_handle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  handle text NOT NULL UNIQUE
    CHECK (handle ~ '^broker:psh_[A-Za-z0-9_-]{32,64}$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  connector_key text NOT NULL CHECK (connector_key ~ '^[a-z0-9][a-z0-9_.-]{1,79}$'),
  connector_version text NOT NULL CHECK (connector_version ~ '^\d+\.\d+\.\d+$'),
  env_name text NOT NULL
    CHECK (env_name ~ '^COMMERCE_PRODUCT_SOURCE_[A-Z0-9_]{1,64}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at timestamptz,
  UNIQUE (tenant_id, workspace_id, id),
  UNIQUE (tenant_id, workspace_id, handle, connector_key, connector_version),
  FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (connector_key, connector_version)
    REFERENCES commerce_product_connector_definition(connector_key, version) ON DELETE RESTRICT,
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS commerce_product_secret_handle_scope_idx
ON commerce_product_secret_handle (tenant_id, workspace_id, connector_key, connector_version, status);

ALTER TABLE commerce_product_secret_handle ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_product_secret_handle FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_product_secret_handle_isolation ON commerce_product_secret_handle;
CREATE POLICY commerce_product_secret_handle_isolation ON commerce_product_secret_handle
USING (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
);

-- Convert legacy env references into random, scope-bound handles without ever
-- exposing the env name through a browser/model contract.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM commerce_product_source
    WHERE credential_ref IS NOT NULL
      AND credential_ref !~ '^env:COMMERCE_PRODUCT_SOURCE_[A-Z0-9_]{1,64}$'
      AND credential_ref !~ '^broker:psh_[A-Za-z0-9_-]{32,64}$'
  ) THEN
    RAISE EXCEPTION 'Legacy product secret references must be converted by an operator before migration 042';
  END IF;
END;
$$;

CREATE TEMP TABLE commerce_product_secret_handle_backfill (
  source_id uuid PRIMARY KEY,
  handle text NOT NULL
) ON COMMIT DROP;

INSERT INTO commerce_product_secret_handle_backfill (source_id, handle)
SELECT source.id, 'broker:psh_' || replace(gen_random_uuid()::text, '-', '')
FROM commerce_product_source source
WHERE source.credential_ref ~ '^env:COMMERCE_PRODUCT_SOURCE_[A-Z0-9_]{1,64}$';

INSERT INTO commerce_product_secret_handle (
  tenant_id, workspace_id, handle, label, connector_key, connector_version, env_name
)
SELECT source.tenant_id, source.workspace_id, backfill.handle,
       left('迁移连接 · ' || source.name, 120),
       source.connector_key, source.connector_version,
       substring(source.credential_ref FROM 5)
FROM commerce_product_source source
INNER JOIN commerce_product_secret_handle_backfill backfill ON backfill.source_id = source.id;

UPDATE commerce_product_source source
SET credential_ref = backfill.handle
FROM commerce_product_secret_handle_backfill backfill
WHERE backfill.source_id = source.id;

ALTER TABLE commerce_product_source
  ADD CONSTRAINT commerce_product_source_secret_handle_scope_fk
  FOREIGN KEY (tenant_id, workspace_id, credential_ref, connector_key, connector_version)
  REFERENCES commerce_product_secret_handle(
    tenant_id, workspace_id, handle, connector_key, connector_version
  ) ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE commerce_product_source
  VALIDATE CONSTRAINT commerce_product_source_secret_handle_scope_fk;

CREATE OR REPLACE FUNCTION commerce_resolve_product_secret_handle(
  p_tenant_id uuid,
  p_workspace_id uuid,
  p_handle text,
  p_connector_key text,
  p_connector_version text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  resolved_env_name text;
BEGIN
  IF p_tenant_id IS NULL OR p_workspace_id IS NULL OR p_handle IS NULL
     OR p_tenant_id <> NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
     OR p_workspace_id <> NULLIF(current_setting('commerce.workspace_id', true), '')::uuid THEN
    RAISE EXCEPTION 'product secret handle scope does not match the transaction';
  END IF;

  SELECT secret_handle.env_name
  INTO resolved_env_name
  FROM commerce_product_secret_handle secret_handle
  WHERE secret_handle.tenant_id = p_tenant_id
    AND secret_handle.workspace_id = p_workspace_id
    AND secret_handle.handle = p_handle
    AND secret_handle.connector_key = p_connector_key
    AND secret_handle.connector_version = p_connector_version
    AND secret_handle.status = 'active'
    AND (secret_handle.expires_at IS NULL OR secret_handle.expires_at > CURRENT_TIMESTAMP)
  LIMIT 1;

  IF resolved_env_name IS NULL THEN
    RAISE EXCEPTION 'product secret handle is unavailable for this scope';
  END IF;
  RETURN resolved_env_name;
END;
$$;

CREATE OR REPLACE FUNCTION commerce_check_product_import_storage_budget(
  p_tenant_id uuid,
  p_workspace_id uuid,
  p_storage_bytes bigint
)
RETURNS TABLE (
  allowed boolean,
  reason_code text,
  retention_until timestamptz,
  tenant_used_bytes bigint,
  workspace_used_bytes bigint,
  tenant_limit_bytes bigint,
  workspace_limit_bytes bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  scoped_tenant_id uuid;
  scoped_workspace_id uuid;
  contract_row commerce_enterprise_contract%ROWTYPE;
BEGIN
  scoped_tenant_id := NULLIF(current_setting('commerce.tenant_id', true), '')::uuid;
  scoped_workspace_id := NULLIF(current_setting('commerce.workspace_id', true), '')::uuid;
  IF p_tenant_id IS NULL OR p_workspace_id IS NULL OR p_storage_bytes < 1
     OR scoped_tenant_id IS NULL OR scoped_workspace_id IS NULL
     OR p_tenant_id <> scoped_tenant_id OR p_workspace_id <> scoped_workspace_id THEN
    RAISE EXCEPTION 'product import storage scope does not match the transaction';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('product-import-storage:' || p_tenant_id::text, 0));
  SELECT contract.* INTO contract_row
  FROM commerce_enterprise_contract contract
  WHERE contract.tenant_id = p_tenant_id
    AND contract.status = 'active'
    AND contract.effective_from <= CURRENT_TIMESTAMP
    AND (contract.effective_until IS NULL OR contract.effective_until > CURRENT_TIMESTAMP)
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'PRODUCT_IMPORT_CONTRACT_INACTIVE', CURRENT_TIMESTAMP,
      0::bigint, 0::bigint, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  SELECT COALESCE(sum(import_run.raw_storage_bytes), 0)::bigint,
         COALESCE(sum(import_run.raw_storage_bytes) FILTER (
           WHERE import_run.workspace_id = p_workspace_id
         ), 0)::bigint
  INTO tenant_used_bytes, workspace_used_bytes
  FROM commerce_product_import_run import_run
  WHERE import_run.tenant_id = p_tenant_id
    AND import_run.raw_payload_purged_at IS NULL;

  tenant_limit_bytes := contract_row.product_import_storage_limit_bytes;
  workspace_limit_bytes := contract_row.product_import_workspace_storage_limit_bytes;
  retention_until := CURRENT_TIMESTAMP + make_interval(days => contract_row.product_import_retention_days);
  allowed := tenant_used_bytes + p_storage_bytes <= tenant_limit_bytes
    AND workspace_used_bytes + p_storage_bytes <= workspace_limit_bytes;
  reason_code := CASE
    WHEN tenant_used_bytes + p_storage_bytes > tenant_limit_bytes THEN 'PRODUCT_IMPORT_TENANT_STORAGE_LIMIT'
    WHEN workspace_used_bytes + p_storage_bytes > workspace_limit_bytes THEN 'PRODUCT_IMPORT_WORKSPACE_STORAGE_LIMIT'
    ELSE 'PRODUCT_IMPORT_STORAGE_ALLOWED'
  END;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION commerce_product_reject_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'commerce_product_source_record'
     AND TG_OP = 'UPDATE'
     AND current_setting('commerce.product_retention_purge', true) = 'on'
     AND NEW.id = OLD.id
     AND NEW.tenant_id = OLD.tenant_id
     AND NEW.workspace_id = OLD.workspace_id
     AND NEW.import_run_id = OLD.import_run_id
     AND NEW.ordinal = OLD.ordinal
     AND NEW.source_pointer = OLD.source_pointer
     AND NEW.raw_sha256 = OLD.raw_sha256
     AND NEW.created_at = OLD.created_at
     AND NEW.raw_payload->>'_commerceRetention' = 'purged'
     AND NEW.raw_payload->>'rawSha256' = OLD.raw_sha256 THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION commerce_purge_product_import_payloads(p_limit integer DEFAULT 100)
RETURNS TABLE (purged_imports integer, purged_records integer, released_bytes bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  scoped_tenant_id uuid;
  candidate_ids uuid[];
BEGIN
  scoped_tenant_id := NULLIF(current_setting('commerce.tenant_id', true), '')::uuid;
  IF scoped_tenant_id IS NULL THEN
    RAISE EXCEPTION 'commerce.tenant_id is required for product import retention';
  END IF;
  IF p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'product import retention limit must be between 1 and 1000';
  END IF;

  SELECT array_agg(candidate.id ORDER BY candidate.retention_until, candidate.id)
  INTO candidate_ids
  FROM (
    SELECT import_run.id, import_run.retention_until
    FROM commerce_product_import_run import_run
    WHERE import_run.tenant_id = scoped_tenant_id
      AND import_run.raw_payload_purged_at IS NULL
      AND import_run.legal_hold = false
      AND import_run.retention_until < CURRENT_TIMESTAMP
      AND import_run.status <> 'importing'
    ORDER BY import_run.retention_until, import_run.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ) candidate;

  IF candidate_ids IS NULL OR cardinality(candidate_ids) = 0 THEN
    RETURN QUERY SELECT 0, 0, 0::bigint;
    RETURN;
  END IF;

  PERFORM set_config('commerce.product_retention_purge', 'on', true);
  SELECT count(*)::integer
  INTO purged_records
  FROM commerce_product_source_record record
  WHERE record.tenant_id = scoped_tenant_id
    AND record.import_run_id = ANY(candidate_ids);

  SELECT COALESCE(sum(import_run.raw_storage_bytes), 0)::bigint
  INTO released_bytes
  FROM commerce_product_import_run import_run
  WHERE import_run.tenant_id = scoped_tenant_id
    AND import_run.id = ANY(candidate_ids);

  UPDATE commerce_product_source_record record
  SET raw_payload = jsonb_build_object(
    '_commerceRetention', 'purged',
    'rawSha256', record.raw_sha256
  )
  WHERE record.tenant_id = scoped_tenant_id
    AND record.import_run_id = ANY(candidate_ids);

  UPDATE commerce_product_import_run import_run
  SET raw_payload_purged_at = CURRENT_TIMESTAMP,
      raw_payload_purged_bytes = import_run.raw_storage_bytes,
      status = CASE WHEN import_run.status = 'completed' THEN 'completed' ELSE 'cancelled' END,
      failure_code = CASE
        WHEN import_run.status = 'completed' THEN import_run.failure_code
        ELSE 'RAW_PAYLOAD_RETENTION_EXPIRED'
      END,
      failure_message = CASE
        WHEN import_run.status = 'completed' THEN import_run.failure_message
        ELSE '原始产品载荷已按企业保留策略清理；哈希、映射、规范主数据与审计仍保留。'
      END,
      completed_at = COALESCE(import_run.completed_at, CURRENT_TIMESTAMP)
  WHERE import_run.tenant_id = scoped_tenant_id
    AND import_run.id = ANY(candidate_ids);

  purged_imports := cardinality(candidate_ids);
  INSERT INTO commerce_enterprise_audit_event (
    tenant_id, workspace_id, actor_user_id, action,
    target_type, target_id, outcome, metadata
  ) VALUES (
    scoped_tenant_id, NULL, NULL, 'product_catalog.import.retention.purge',
    'product_import', NULL, 'succeeded',
    jsonb_build_object(
      'importIds', candidate_ids,
      'purgedImports', purged_imports,
      'purgedRecords', purged_records,
      'releasedBytes', released_bytes
    )
  );
  RETURN NEXT;
END;
$$;

REVOKE ALL ON commerce_product_secret_handle FROM PUBLIC;
REVOKE ALL ON FUNCTION commerce_resolve_product_secret_handle(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION commerce_check_product_import_storage_budget(uuid, uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION commerce_purge_product_import_payloads(integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_pilot_app') THEN
    GRANT SELECT (
      id, tenant_id, workspace_id, handle, label, connector_key,
      connector_version, status, expires_at, created_at, revoked_at
    ) ON commerce_product_secret_handle TO commerce_pilot_app;
    GRANT EXECUTE ON FUNCTION commerce_resolve_product_secret_handle(uuid, uuid, text, text, text)
      TO commerce_pilot_app;
    GRANT EXECUTE ON FUNCTION commerce_check_product_import_storage_budget(uuid, uuid, bigint)
      TO commerce_pilot_app;
    GRANT EXECUTE ON FUNCTION commerce_purge_product_import_payloads(integer)
      TO commerce_pilot_app;
  END IF;
END;
$$;

COMMENT ON TABLE commerce_product_secret_handle IS
  'Tenant/workspace-bound opaque connector handles. env_name is operator-only and is never returned to browsers or Harness.';
COMMENT ON FUNCTION commerce_purge_product_import_payloads(integer) IS
  'Tenant-pinned retention cleanup that scrubs expired raw payloads while preserving hashes, lineage, canonical revisions, and audit evidence.';
