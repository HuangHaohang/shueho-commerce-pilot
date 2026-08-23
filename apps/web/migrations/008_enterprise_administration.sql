DROP POLICY IF EXISTS commerce_agent_thread_isolation ON commerce_agent_thread;
CREATE POLICY commerce_agent_thread_isolation ON commerce_agent_thread
USING (
  (
    tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
    AND (
      workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
      OR current_setting('commerce.tenant_wide', true) = 'on'
    )
  )
  OR (
    tenant_id IS NULL
    AND user_id = NULLIF(current_setting('commerce.user_id', true), '')
  )
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND (
    workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
    OR current_setting('commerce.tenant_wide', true) = 'on'
  )
);

DROP POLICY IF EXISTS commerce_enterprise_audit_isolation ON commerce_enterprise_audit_event;
CREATE POLICY commerce_enterprise_audit_isolation ON commerce_enterprise_audit_event
USING (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND (
    workspace_id IS NULL
    OR workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
    OR current_setting('commerce.tenant_wide', true) = 'on'
  )
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND (
    workspace_id IS NULL
    OR workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
    OR current_setting('commerce.tenant_wide', true) = 'on'
  )
);

CREATE OR REPLACE FUNCTION commerce_validate_role_assignment_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE role_scope text;
BEGIN
  SELECT scope INTO role_scope
  FROM commerce_enterprise_role
  WHERE tenant_id = NEW.tenant_id AND id = NEW.role_id;
  IF role_scope IS NULL THEN
    RAISE EXCEPTION 'enterprise role is not in the assignment tenant';
  END IF;
  IF (role_scope = 'tenant' AND NEW.workspace_id IS NOT NULL)
     OR (role_scope = 'workspace' AND NEW.workspace_id IS NULL) THEN
    RAISE EXCEPTION 'enterprise role assignment scope mismatch';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS commerce_user_role_assignment_scope ON commerce_user_role_assignment;
CREATE TRIGGER commerce_user_role_assignment_scope
BEFORE INSERT OR UPDATE ON commerce_user_role_assignment
FOR EACH ROW EXECUTE FUNCTION commerce_validate_role_assignment_scope();

DROP TRIGGER IF EXISTS commerce_group_role_assignment_scope ON commerce_group_role_assignment;
CREATE TRIGGER commerce_group_role_assignment_scope
BEFORE INSERT OR UPDATE ON commerce_group_role_assignment
FOR EACH ROW EXECUTE FUNCTION commerce_validate_role_assignment_scope();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_pilot_app') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE commerce_workspace TO commerce_pilot_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      commerce_user_role_assignment, commerce_enterprise_group_member
    TO commerce_pilot_app;
  END IF;
END;
$$;
