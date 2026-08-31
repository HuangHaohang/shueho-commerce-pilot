-- Close the remaining legacy and cross-scope integrity gaps before this schema
-- is used for more than one customer company. This migration intentionally
-- fails when an operator has not assigned every retained legacy thread.

DO $$
DECLARE
  unassigned_threads bigint;
BEGIN
  SELECT count(*)
  INTO unassigned_threads
  FROM commerce_agent_thread
  WHERE tenant_id IS NULL
     OR workspace_id IS NULL
     OR created_by_user_id IS NULL;

  IF unassigned_threads > 0 THEN
    RAISE EXCEPTION
      'Cannot close Enterprise isolation while % legacy Agent thread(s) are unassigned. Run the controlled Enterprise bootstrap/backfill first.',
      unassigned_threads;
  END IF;
END;
$$;

ALTER TABLE commerce_agent_thread
  VALIDATE CONSTRAINT commerce_agent_thread_workspace_fk;

ALTER TABLE commerce_agent_thread
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN created_by_user_id SET NOT NULL;

DROP POLICY IF EXISTS commerce_agent_thread_isolation ON commerce_agent_thread;
CREATE POLICY commerce_agent_thread_isolation ON commerce_agent_thread
USING (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND (
    workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
    OR current_setting('commerce.tenant_wide', true) = 'on'
  )
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND (
    workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
    OR current_setting('commerce.tenant_wide', true) = 'on'
  )
);

-- Referenced scope identities. These do not change product or Agent behavior;
-- they let every relationship prove that both sides belong to the same
-- tenant/workspace instead of trusting a globally unique id alone.
CREATE UNIQUE INDEX IF NOT EXISTS commerce_external_data_call_scope_identity_idx
ON commerce_external_data_call (tenant_id, workspace_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS commerce_mcp_access_token_scope_identity_idx
ON commerce_mcp_access_token (tenant_id, workspace_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS commerce_enterprise_audit_scope_identity_idx
ON commerce_enterprise_audit_event (tenant_id, workspace_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS commerce_thread_deletion_job_scope_identity_idx
ON commerce_thread_deletion_job (tenant_id, workspace_id, user_id, id);

-- Thread-owned application records must use the thread's complete scope.
ALTER TABLE commerce_agent_message_feedback
  ADD CONSTRAINT commerce_agent_message_feedback_workspace_scope_fk
  FOREIGN KEY (tenant_id, workspace_id)
  REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE
  NOT VALID,
  ADD CONSTRAINT commerce_agent_message_feedback_thread_scope_fk
  FOREIGN KEY (tenant_id, workspace_id, thread_id)
  REFERENCES commerce_agent_thread(tenant_id, workspace_id, thread_id) ON DELETE CASCADE
  NOT VALID;

ALTER TABLE commerce_agent_message_feedback_event
  ADD CONSTRAINT commerce_agent_message_feedback_event_workspace_scope_fk
  FOREIGN KEY (tenant_id, workspace_id)
  REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE
  NOT VALID,
  ADD CONSTRAINT commerce_agent_message_feedback_event_thread_scope_fk
  FOREIGN KEY (tenant_id, workspace_id, thread_id)
  REFERENCES commerce_agent_thread(tenant_id, workspace_id, thread_id) ON DELETE CASCADE
  NOT VALID;

ALTER TABLE commerce_agent_user_input_answer
  ADD CONSTRAINT commerce_agent_user_input_answer_workspace_scope_fk
  FOREIGN KEY (tenant_id, workspace_id)
  REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE
  NOT VALID,
  ADD CONSTRAINT commerce_agent_user_input_answer_thread_scope_fk
  FOREIGN KEY (tenant_id, workspace_id, thread_id)
  REFERENCES commerce_agent_thread(tenant_id, workspace_id, thread_id) ON DELETE CASCADE
  NOT VALID;

-- Durable deletion jobs keep their items after each App Server thread is
-- removed, so the job relationship is scoped rather than linked to the thread.
ALTER TABLE commerce_thread_deletion_job
  ADD CONSTRAINT commerce_thread_deletion_job_workspace_scope_fk
  FOREIGN KEY (tenant_id, workspace_id)
  REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE
  NOT VALID;

ALTER TABLE commerce_thread_deletion_item
  ADD CONSTRAINT commerce_thread_deletion_item_job_scope_fk
  FOREIGN KEY (tenant_id, workspace_id, user_id, job_id)
  REFERENCES commerce_thread_deletion_job(tenant_id, workspace_id, user_id, id) ON DELETE CASCADE
  NOT VALID;

-- Independent external-data archives must survive thread/call retention. The
-- column-list SET NULL clauses clear only the optional relationship id while
-- preserving the archive's immutable tenant/workspace identity.
ALTER TABLE commerce_external_data_archive
  ADD CONSTRAINT commerce_external_data_archive_workspace_scope_fk
  FOREIGN KEY (tenant_id, workspace_id)
  REFERENCES commerce_workspace(tenant_id, id) ON DELETE CASCADE
  NOT VALID,
  ADD CONSTRAINT commerce_external_data_archive_call_scope_fk
  FOREIGN KEY (tenant_id, workspace_id, external_call_id)
  REFERENCES commerce_external_data_call(tenant_id, workspace_id, id)
  ON DELETE SET NULL (external_call_id)
  NOT VALID;

ALTER TABLE commerce_external_data_call
  ADD CONSTRAINT commerce_external_data_call_mcp_token_scope_fk
  FOREIGN KEY (tenant_id, workspace_id, mcp_access_token_id)
  REFERENCES commerce_mcp_access_token(tenant_id, workspace_id, id)
  ON DELETE SET NULL (mcp_access_token_id)
  NOT VALID;

ALTER TABLE commerce_product_source_operation_receipt
  ADD CONSTRAINT commerce_product_source_operation_receipt_audit_scope_fk
  FOREIGN KEY (tenant_id, workspace_id, audit_event_id)
  REFERENCES commerce_enterprise_audit_event(tenant_id, workspace_id, id) ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE commerce_agent_message_feedback
  VALIDATE CONSTRAINT commerce_agent_message_feedback_workspace_scope_fk;
ALTER TABLE commerce_agent_message_feedback
  VALIDATE CONSTRAINT commerce_agent_message_feedback_thread_scope_fk;
ALTER TABLE commerce_agent_message_feedback_event
  VALIDATE CONSTRAINT commerce_agent_message_feedback_event_workspace_scope_fk;
ALTER TABLE commerce_agent_message_feedback_event
  VALIDATE CONSTRAINT commerce_agent_message_feedback_event_thread_scope_fk;
ALTER TABLE commerce_agent_user_input_answer
  VALIDATE CONSTRAINT commerce_agent_user_input_answer_workspace_scope_fk;
ALTER TABLE commerce_agent_user_input_answer
  VALIDATE CONSTRAINT commerce_agent_user_input_answer_thread_scope_fk;
ALTER TABLE commerce_thread_deletion_job
  VALIDATE CONSTRAINT commerce_thread_deletion_job_workspace_scope_fk;
ALTER TABLE commerce_thread_deletion_item
  VALIDATE CONSTRAINT commerce_thread_deletion_item_job_scope_fk;
ALTER TABLE commerce_external_data_archive
  VALIDATE CONSTRAINT commerce_external_data_archive_workspace_scope_fk;
ALTER TABLE commerce_external_data_archive
  VALIDATE CONSTRAINT commerce_external_data_archive_call_scope_fk;
ALTER TABLE commerce_external_data_call
  VALIDATE CONSTRAINT commerce_external_data_call_mcp_token_scope_fk;
ALTER TABLE commerce_product_source_operation_receipt
  VALIDATE CONSTRAINT commerce_product_source_operation_receipt_audit_scope_fk;

-- Remove the superseded global-id-only relationships so future schema audits
-- can reject any new cross-scope foreign key instead of silently relying on a
-- second constraint to make it safe.
ALTER TABLE commerce_agent_message_feedback
  DROP CONSTRAINT commerce_agent_message_feedback_workspace_id_fkey,
  DROP CONSTRAINT commerce_agent_message_feedback_thread_id_fkey;
ALTER TABLE commerce_agent_message_feedback_event
  DROP CONSTRAINT commerce_agent_message_feedback_event_workspace_id_fkey,
  DROP CONSTRAINT commerce_agent_message_feedback_event_thread_id_fkey;
ALTER TABLE commerce_agent_user_input_answer
  DROP CONSTRAINT commerce_agent_user_input_answer_workspace_id_fkey,
  DROP CONSTRAINT commerce_agent_user_input_answer_thread_id_fkey;
ALTER TABLE commerce_thread_deletion_job
  DROP CONSTRAINT commerce_thread_deletion_job_workspace_id_fkey;
ALTER TABLE commerce_thread_deletion_item
  DROP CONSTRAINT commerce_thread_deletion_item_job_id_fkey;
ALTER TABLE commerce_external_data_archive
  DROP CONSTRAINT commerce_external_data_archive_workspace_id_fkey,
  DROP CONSTRAINT commerce_external_data_archive_external_call_id_fkey;
ALTER TABLE commerce_external_data_call
  DROP CONSTRAINT commerce_external_data_call_mcp_access_token_id_fkey;
ALTER TABLE commerce_product_source_operation_receipt
  DROP CONSTRAINT commerce_product_source_operation_receipt_audit_event_id_fkey;

-- A deletion worker is tenant-pinned just like the Gateway. NULL no longer
-- means "claim work from any company", and the transaction scope must agree
-- with the requested tenant before this SECURITY DEFINER function bypasses RLS.
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
DECLARE
  scoped_tenant_id uuid;
BEGIN
  scoped_tenant_id := NULLIF(current_setting('commerce.tenant_id', true), '')::uuid;
  IF p_tenant_id IS NULL OR scoped_tenant_id IS NULL OR scoped_tenant_id <> p_tenant_id THEN
    RAISE EXCEPTION 'tenant-pinned scope is required to claim a thread deletion job';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT job.id
    FROM commerce_thread_deletion_job job
    WHERE (
        job.status = 'queued'
        OR (job.status = 'running' AND job.updated_at < CURRENT_TIMESTAMP - interval '15 minutes')
      )
      AND job.tenant_id = p_tenant_id
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
    AND job.tenant_id = p_tenant_id
  RETURNING job.id, job.tenant_id, job.workspace_id, job.user_id;
END;
$$;

REVOKE ALL ON FUNCTION commerce_claim_thread_deletion_job(uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_pilot_app') THEN
    GRANT EXECUTE ON FUNCTION commerce_claim_thread_deletion_job(uuid) TO commerce_pilot_app;
  END IF;
END;
$$;

COMMENT ON FUNCTION commerce_claim_thread_deletion_job(uuid) IS
  'Claims a deletion job only for the explicit tenant that matches the transaction-local commerce.tenant_id.';
