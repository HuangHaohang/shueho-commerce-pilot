ALTER TABLE commerce_product_mapping_revision
  ADD COLUMN IF NOT EXISTS proposal_idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS validation_idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS commerce_product_mapping_proposal_idempotency_idx
ON commerce_product_mapping_revision (tenant_id, workspace_id, proposal_idempotency_key)
WHERE proposal_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS commerce_product_mapping_validation_idempotency_idx
ON commerce_product_mapping_revision (tenant_id, workspace_id, validation_idempotency_key)
WHERE validation_idempotency_key IS NOT NULL;

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
     OR NEW.created_by_user_id <> OLD.created_by_user_id
     OR NEW.proposal_idempotency_key IS DISTINCT FROM OLD.proposal_idempotency_key THEN
    RAISE EXCEPTION 'product mapping revision identity and proposal are immutable';
  END IF;
  IF OLD.validation_idempotency_key IS NOT NULL
     AND NEW.validation_idempotency_key IS DISTINCT FROM OLD.validation_idempotency_key THEN
    RAISE EXCEPTION 'product mapping validation idempotency is immutable';
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

COMMENT ON COLUMN commerce_product_mapping_revision.proposal_idempotency_key IS
  'Workspace-scoped UUID receipt for one approved Harness mapping-proposal write.';
COMMENT ON COLUMN commerce_product_mapping_revision.validation_idempotency_key IS
  'Workspace-scoped UUID receipt for one approved Harness mapping-validation state write.';
