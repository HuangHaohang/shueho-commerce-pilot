CREATE TABLE IF NOT EXISTS commerce_external_data_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES commerce_workspace(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'justoneapi' CHECK (provider = 'justoneapi'),
  source text NOT NULL CHECK (source IN ('codex_harness', 'external_mcp')),
  source_call_id text NOT NULL CHECK (char_length(source_call_id) BETWEEN 8 AND 128),
  external_call_id uuid REFERENCES commerce_external_data_call(id) ON DELETE SET NULL,
  endpoint_id text NOT NULL CHECK (endpoint_id ~ '^[a-z0-9_]+\.[a-zA-Z0-9_.-]+$'),
  platform text NOT NULL CHECK (platform ~ '^[a-z0-9_]+$'),
  root_thread_id text,
  thread_id text,
  turn_id text,
  state text NOT NULL DEFAULT 'dispatched'
    CHECK (state IN ('dispatched', 'succeeded', 'business_failed', 'unknown')),
  request_payload jsonb NOT NULL CHECK (jsonb_typeof(request_payload) = 'object'),
  response_payload jsonb CHECK (response_payload IS NULL OR jsonb_typeof(response_payload) = 'object'),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  response_sha256 text CHECK (response_sha256 IS NULL OR response_sha256 ~ '^[a-f0-9]{64}$'),
  request_bytes integer NOT NULL CHECK (request_bytes BETWEEN 2 AND 524288),
  response_bytes integer CHECK (response_bytes IS NULL OR response_bytes BETWEEN 2 AND 6291456),
  upstream_code integer,
  upstream_request_id text,
  provider_recorded_at timestamptz,
  retention_until timestamptz,
  legal_hold boolean NOT NULL DEFAULT false,
  dispatched_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, source, source_call_id),
  CHECK (root_thread_id IS NULL OR char_length(root_thread_id) BETWEEN 8 AND 128),
  CHECK (thread_id IS NULL OR char_length(thread_id) BETWEEN 8 AND 128),
  CHECK (turn_id IS NULL OR char_length(turn_id) BETWEEN 8 AND 128),
  CHECK ((response_payload IS NULL) = (response_sha256 IS NULL)),
  CHECK ((response_payload IS NULL) = (response_bytes IS NULL)),
  CHECK (
    (state IN ('dispatched', 'unknown') AND response_payload IS NULL)
    OR (state IN ('succeeded', 'business_failed') AND response_payload IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS commerce_external_data_archive_scope_time_idx
ON commerce_external_data_archive (tenant_id, workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS commerce_external_data_archive_endpoint_time_idx
ON commerce_external_data_archive (tenant_id, workspace_id, endpoint_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS commerce_external_data_archive_request_hash_idx
ON commerce_external_data_archive (tenant_id, workspace_id, request_sha256, created_at DESC);

CREATE INDEX IF NOT EXISTS commerce_external_data_archive_retention_idx
ON commerce_external_data_archive (tenant_id, retention_until, created_at)
WHERE retention_until IS NOT NULL AND legal_hold = false;

DROP TRIGGER IF EXISTS commerce_external_data_archive_updated_at
ON commerce_external_data_archive;
CREATE TRIGGER commerce_external_data_archive_updated_at
BEFORE UPDATE ON commerce_external_data_archive
FOR EACH ROW EXECUTE FUNCTION commerce_set_updated_at();

ALTER TABLE commerce_external_data_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_external_data_archive FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_external_data_archive_isolation
ON commerce_external_data_archive;
CREATE POLICY commerce_external_data_archive_isolation
ON commerce_external_data_archive
USING (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND (
    workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
    OR current_setting('commerce.tenant_wide', true) = 'on'
  )
  AND (
    user_id = NULLIF(current_setting('commerce.user_id', true), '')
    OR current_setting('commerce.tenant_wide', true) = 'on'
  )
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND (
    workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
    OR current_setting('commerce.tenant_wide', true) = 'on'
  )
  AND (
    user_id = NULLIF(current_setting('commerce.user_id', true), '')
    OR current_setting('commerce.tenant_wide', true) = 'on'
  )
);

CREATE OR REPLACE FUNCTION commerce_purge_external_data_archives(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  scoped_tenant_id uuid;
  deleted_count integer;
BEGIN
  scoped_tenant_id := NULLIF(current_setting('commerce.tenant_id', true), '')::uuid;
  IF scoped_tenant_id IS NULL THEN
    RAISE EXCEPTION 'commerce.tenant_id is required for external data archive retention';
  END IF;
  IF p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'external data archive retention limit must be between 1 and 5000';
  END IF;

  WITH candidates AS (
    SELECT archive.id
    FROM commerce_external_data_archive archive
    WHERE archive.tenant_id = scoped_tenant_id
      AND archive.state IN ('succeeded', 'business_failed', 'unknown')
      AND archive.retention_until IS NOT NULL
      AND archive.retention_until < CURRENT_TIMESTAMP
      AND archive.legal_hold = false
    ORDER BY archive.retention_until, archive.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ), deleted AS (
    DELETE FROM commerce_external_data_archive archive
    USING candidates
    WHERE archive.id = candidates.id
    RETURNING archive.id
  )
  SELECT count(*)::integer INTO deleted_count FROM deleted;

  IF deleted_count > 0 THEN
    INSERT INTO commerce_enterprise_audit_event (
      tenant_id, workspace_id, actor_user_id, action,
      target_type, target_id, outcome, metadata
    ) VALUES (
      scoped_tenant_id, NULL, NULL, 'external_data.archive.retention.purge',
      'external_data_archive', NULL, 'succeeded',
      jsonb_build_object('deletedCount', deleted_count)
    );
  END IF;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON commerce_external_data_archive FROM PUBLIC;
REVOKE ALL ON FUNCTION commerce_purge_external_data_archives(integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_pilot_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
    ON commerce_external_data_archive TO commerce_pilot_app;
    GRANT EXECUTE ON FUNCTION commerce_purge_external_data_archives(integer)
    TO commerce_pilot_app;
  END IF;
END;
$$;

UPDATE commerce_enterprise_role
SET allowed_permissions = (
  SELECT ARRAY(
    SELECT DISTINCT permission
    FROM unnest(
      allowed_permissions || CASE role_key
        WHEN 'tenant_owner' THEN ARRAY[
          'external_data.archive.read',
          'external_data.archive.export',
          'external_data.archive.delete'
        ]::text[]
        WHEN 'tenant_admin' THEN ARRAY[
          'external_data.archive.read',
          'external_data.archive.export',
          'external_data.archive.delete'
        ]::text[]
        WHEN 'analytics_viewer' THEN ARRAY[
          'external_data.archive.read',
          'external_data.archive.export'
        ]::text[]
        WHEN 'workspace_owner' THEN ARRAY[
          'external_data.archive.read',
          'external_data.archive.export',
          'external_data.archive.delete'
        ]::text[]
        WHEN 'workspace_operator' THEN ARRAY['external_data.archive.read']::text[]
        WHEN 'workspace_analyst' THEN ARRAY[
          'external_data.archive.read',
          'external_data.archive.export'
        ]::text[]
        ELSE ARRAY[]::text[]
      END
    ) AS permission
    ORDER BY permission
  )
), updated_at = CURRENT_TIMESTAMP
WHERE is_system = true;

COMMENT ON TABLE commerce_external_data_archive IS
  'Independent raw JustOneAPI request/response archive. Thread deletion never cascades to this table.';
COMMENT ON COLUMN commerce_external_data_archive.retention_until IS
  'Independent archive retention deadline; NULL means permanent until an explicit archive deletion.';
