CREATE TABLE IF NOT EXISTS commerce_thread_deletion_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES commerce_workspace(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed')),
  total_items integer NOT NULL CHECK (total_items BETWEEN 1 AND 100),
  completed_items integer NOT NULL DEFAULT 0 CHECK (completed_items >= 0),
  failed_items integer NOT NULL DEFAULT 0 CHECK (failed_items >= 0),
  error text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (completed_items + failed_items <= total_items)
);

CREATE TABLE IF NOT EXISTS commerce_thread_deletion_item (
  job_id uuid NOT NULL REFERENCES commerce_thread_deletion_job(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  user_id text NOT NULL,
  thread_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'deleted', 'failed')),
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  PRIMARY KEY (job_id, thread_id),
  UNIQUE (job_id, ordinal),
  FOREIGN KEY (tenant_id, workspace_id)
    REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, user_id)
    REFERENCES commerce_tenant_membership(tenant_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS commerce_thread_deletion_job_queue_idx
ON commerce_thread_deletion_job (status, created_at, id);

CREATE INDEX IF NOT EXISTS commerce_thread_deletion_job_owner_idx
ON commerce_thread_deletion_job (tenant_id, workspace_id, user_id, created_at DESC);

ALTER TABLE commerce_thread_deletion_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_thread_deletion_job FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_thread_deletion_job_isolation ON commerce_thread_deletion_job;
CREATE POLICY commerce_thread_deletion_job_isolation ON commerce_thread_deletion_job
USING (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
  AND user_id = NULLIF(current_setting('commerce.user_id', true), '')
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
  AND user_id = NULLIF(current_setting('commerce.user_id', true), '')
);

ALTER TABLE commerce_thread_deletion_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_thread_deletion_item FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_thread_deletion_item_isolation ON commerce_thread_deletion_item;
CREATE POLICY commerce_thread_deletion_item_isolation ON commerce_thread_deletion_item
USING (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
  AND user_id = NULLIF(current_setting('commerce.user_id', true), '')
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
  AND user_id = NULLIF(current_setting('commerce.user_id', true), '')
);

CREATE OR REPLACE FUNCTION commerce_claim_thread_deletion_job(p_tenant_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  workspace_id uuid,
  user_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT job.id
    FROM commerce_thread_deletion_job job
    WHERE (
        job.status = 'queued'
        OR (job.status = 'running' AND job.updated_at < CURRENT_TIMESTAMP - interval '15 minutes')
      )
      AND (p_tenant_id IS NULL OR job.tenant_id = p_tenant_id)
    ORDER BY job.created_at, job.id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE commerce_thread_deletion_job job
  SET status = 'running',
      started_at = COALESCE(job.started_at, CURRENT_TIMESTAMP),
      updated_at = CURRENT_TIMESTAMP,
      error = NULL
  FROM candidate
  WHERE job.id = candidate.id
  RETURNING job.id, job.tenant_id, job.workspace_id, job.user_id;
END;
$$;

REVOKE ALL ON FUNCTION commerce_claim_thread_deletion_job(uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_pilot_app') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE
      commerce_thread_deletion_job,
      commerce_thread_deletion_item
    TO commerce_pilot_app;
    GRANT DELETE ON TABLE commerce_agent_turn_completion TO commerce_pilot_app;
    GRANT EXECUTE ON FUNCTION commerce_claim_thread_deletion_job(uuid) TO commerce_pilot_app;
  END IF;
END;
$$;

UPDATE commerce_enterprise_role
SET allowed_permissions = CASE
      WHEN NOT ('thread.delete' = ANY(allowed_permissions))
      THEN array_append(allowed_permissions, 'thread.delete')
      ELSE allowed_permissions
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE is_system = true
  AND role_key IN ('tenant_owner', 'workspace_owner', 'workspace_operator');
