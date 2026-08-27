ALTER TABLE commerce_external_data_call
  ADD COLUMN IF NOT EXISTS legal_hold boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION commerce_purge_external_data_calls(p_limit integer DEFAULT 500)
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
    RAISE EXCEPTION 'commerce.tenant_id is required for external data retention';
  END IF;
  IF p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'external data retention limit must be between 1 and 5000';
  END IF;

  WITH candidates AS (
    SELECT call.id
    FROM commerce_external_data_call call
    INNER JOIN commerce_external_data_policy policy
      ON policy.tenant_id = call.tenant_id
     AND policy.workspace_id = call.workspace_id
     AND policy.provider = call.provider
    WHERE call.tenant_id = scoped_tenant_id
      AND call.state IN ('succeeded', 'business_failed', 'cancelled')
      AND call.legal_hold = false
      AND call.created_at < CURRENT_TIMESTAMP - make_interval(days => policy.retention_days)
    ORDER BY call.created_at, call.id
    FOR UPDATE OF call SKIP LOCKED
    LIMIT p_limit
  ), deleted AS (
    DELETE FROM commerce_external_data_call call
    USING candidates
    WHERE call.id = candidates.id
    RETURNING call.id
  )
  SELECT count(*)::integer INTO deleted_count FROM deleted;

  IF deleted_count > 0 THEN
    INSERT INTO commerce_enterprise_audit_event (
      tenant_id, workspace_id, actor_user_id, action,
      target_type, target_id, outcome, metadata
    )
    VALUES (
      scoped_tenant_id, NULL, NULL, 'external_data.retention.purge',
      'external_data_call', NULL, 'succeeded',
      jsonb_build_object('deletedCount', deleted_count)
    );
  END IF;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION commerce_purge_external_data_calls(integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_pilot_app') THEN
    GRANT EXECUTE ON FUNCTION commerce_purge_external_data_calls(integer)
    TO commerce_pilot_app;
  END IF;
END;
$$;
