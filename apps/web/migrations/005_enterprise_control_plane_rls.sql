ALTER TABLE commerce_enterprise_invitation
  ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE commerce_organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_organization FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_organization_isolation ON commerce_organization;
CREATE POLICY commerce_organization_isolation ON commerce_organization
USING (id = NULLIF(current_setting('commerce.organization_id', true), '')::uuid)
WITH CHECK (id = NULLIF(current_setting('commerce.organization_id', true), '')::uuid);

ALTER TABLE commerce_tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_tenant FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_tenant_isolation ON commerce_tenant;
CREATE POLICY commerce_tenant_isolation ON commerce_tenant
USING (id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid)
WITH CHECK (id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid);

ALTER TABLE commerce_workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_workspace FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_workspace_isolation ON commerce_workspace;
CREATE POLICY commerce_workspace_isolation ON commerce_workspace
USING (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND (
    id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
    OR current_setting('commerce.tenant_wide', true) = 'on'
  )
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND (
    id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
    OR current_setting('commerce.tenant_wide', true) = 'on'
  )
);

ALTER TABLE commerce_tenant_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_tenant_membership FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_tenant_membership_self_select ON commerce_tenant_membership;
DROP POLICY IF EXISTS commerce_tenant_membership_manage ON commerce_tenant_membership;
CREATE POLICY commerce_tenant_membership_self_select ON commerce_tenant_membership
FOR SELECT USING (
  user_id = NULLIF(current_setting('commerce.user_id', true), '')
  OR tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
);
CREATE POLICY commerce_tenant_membership_manage ON commerce_tenant_membership
FOR ALL USING (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
);

ALTER TABLE commerce_workspace_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_workspace_membership FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_workspace_membership_self_select ON commerce_workspace_membership;
DROP POLICY IF EXISTS commerce_workspace_membership_manage ON commerce_workspace_membership;
CREATE POLICY commerce_workspace_membership_self_select ON commerce_workspace_membership
FOR SELECT USING (
  user_id = NULLIF(current_setting('commerce.user_id', true), '')
  OR (
    tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
    AND (
      workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
      OR current_setting('commerce.tenant_wide', true) = 'on'
    )
  )
);
CREATE POLICY commerce_workspace_membership_manage ON commerce_workspace_membership
FOR ALL USING (
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

ALTER TABLE commerce_enterprise_role ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_enterprise_role FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_enterprise_role_isolation ON commerce_enterprise_role;
CREATE POLICY commerce_enterprise_role_isolation ON commerce_enterprise_role
USING (tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid);

ALTER TABLE commerce_user_role_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_user_role_assignment FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_user_role_assignment_isolation ON commerce_user_role_assignment;
CREATE POLICY commerce_user_role_assignment_isolation ON commerce_user_role_assignment
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

ALTER TABLE commerce_enterprise_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_enterprise_group FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_enterprise_group_isolation ON commerce_enterprise_group;
CREATE POLICY commerce_enterprise_group_isolation ON commerce_enterprise_group
USING (tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid);

ALTER TABLE commerce_enterprise_group_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_enterprise_group_member FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_enterprise_group_member_isolation ON commerce_enterprise_group_member;
CREATE POLICY commerce_enterprise_group_member_isolation ON commerce_enterprise_group_member
USING (tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid);

ALTER TABLE commerce_group_role_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_group_role_assignment FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_group_role_assignment_isolation ON commerce_group_role_assignment;
CREATE POLICY commerce_group_role_assignment_isolation ON commerce_group_role_assignment
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

ALTER TABLE commerce_enterprise_contract ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_enterprise_contract FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_enterprise_contract_isolation ON commerce_enterprise_contract;
CREATE POLICY commerce_enterprise_contract_isolation ON commerce_enterprise_contract
USING (tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid);

ALTER TABLE commerce_tenant_runtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_tenant_runtime FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_tenant_runtime_isolation ON commerce_tenant_runtime;
CREATE POLICY commerce_tenant_runtime_isolation ON commerce_tenant_runtime
USING (tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid)
WITH CHECK (tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid);

ALTER TABLE commerce_enterprise_invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_enterprise_invitation FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_enterprise_invitation_token_select ON commerce_enterprise_invitation;
DROP POLICY IF EXISTS commerce_enterprise_invitation_manage ON commerce_enterprise_invitation;
CREATE POLICY commerce_enterprise_invitation_token_select ON commerce_enterprise_invitation
FOR SELECT USING (
  encode(token_hash, 'hex') = NULLIF(current_setting('commerce.invitation_token_hash', true), '')
);
CREATE POLICY commerce_enterprise_invitation_manage ON commerce_enterprise_invitation
FOR ALL USING (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
);

-- The bundled local role is optional. Hosted deployments may use a differently
-- named application role, but it must receive equivalent least-privilege grants.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_pilot_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      "user", account, session, verification, "rateLimit"
    TO commerce_pilot_app;

    GRANT SELECT ON TABLE
      commerce_organization, commerce_tenant, commerce_workspace,
      commerce_enterprise_contract, commerce_tenant_runtime,
      commerce_enterprise_role, commerce_enterprise_group,
      commerce_enterprise_group_member, commerce_group_role_assignment
    TO commerce_pilot_app;

    GRANT SELECT, INSERT, UPDATE ON TABLE
      commerce_tenant_membership, commerce_workspace_membership,
      commerce_user_role_assignment, commerce_enterprise_invitation
    TO commerce_pilot_app;

    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      commerce_agent_thread, commerce_agent_turn_lease,
      commerce_idempotency_record
    TO commerce_pilot_app;

    GRANT SELECT, INSERT ON TABLE
      commerce_agent_usage_event, commerce_enterprise_audit_event,
      commerce_agent_turn_completion
    TO commerce_pilot_app;

    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO commerce_pilot_app;
  END IF;
END;
$$;
