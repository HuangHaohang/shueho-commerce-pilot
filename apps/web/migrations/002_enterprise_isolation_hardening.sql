CREATE TABLE IF NOT EXISTS commerce_organization (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'suspended', 'terminated')),
  created_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS commerce_organization_slug_lower_idx
ON commerce_organization (lower(slug));

ALTER TABLE commerce_tenant
  ADD COLUMN IF NOT EXISTS organization_id uuid;

INSERT INTO commerce_organization (id, slug, name, status, created_by_user_id, created_at, updated_at)
SELECT id, slug, name, status, created_by_user_id, created_at, updated_at
FROM commerce_tenant
ON CONFLICT (id) DO UPDATE
SET slug = EXCLUDED.slug,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    updated_at = EXCLUDED.updated_at;

UPDATE commerce_tenant
SET organization_id = id
WHERE organization_id IS NULL;

ALTER TABLE commerce_tenant
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE commerce_tenant
  DROP CONSTRAINT IF EXISTS commerce_tenant_organization_fk;
ALTER TABLE commerce_tenant
  ADD CONSTRAINT commerce_tenant_organization_fk
  FOREIGN KEY (organization_id) REFERENCES commerce_organization(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS commerce_tenant_organization_idx
ON commerce_tenant (organization_id);

DROP TRIGGER IF EXISTS commerce_organization_updated_at ON commerce_organization;
CREATE TRIGGER commerce_organization_updated_at
BEFORE UPDATE ON commerce_organization
FOR EACH ROW EXECUTE FUNCTION commerce_set_updated_at();

-- Normal application requests remain workspace-scoped. Quota admission is the
-- sole tenant-wide path and must explicitly set commerce.tenant_wide = 'on'
-- inside its transaction; tenant_id is still mandatory in every policy.
DROP POLICY IF EXISTS commerce_agent_usage_isolation ON commerce_agent_usage_event;
CREATE POLICY commerce_agent_usage_isolation ON commerce_agent_usage_event
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

DROP POLICY IF EXISTS commerce_agent_turn_lease_isolation ON commerce_agent_turn_lease;
CREATE POLICY commerce_agent_turn_lease_isolation ON commerce_agent_turn_lease
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

ALTER TABLE commerce_idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_idempotency_record FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_idempotency_isolation ON commerce_idempotency_record;
CREATE POLICY commerce_idempotency_isolation ON commerce_idempotency_record
USING (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
);
