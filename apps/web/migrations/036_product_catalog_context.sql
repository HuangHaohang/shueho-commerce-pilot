CREATE UNIQUE INDEX IF NOT EXISTS commerce_agent_thread_scope_identity_idx
ON commerce_agent_thread (tenant_id, workspace_id, thread_id);

CREATE TABLE IF NOT EXISTS commerce_agent_product_context_set (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  thread_id text NOT NULL,
  client_request_id uuid NOT NULL,
  turn_id text CHECK (turn_id IS NULL OR char_length(turn_id) BETWEEN 8 AND 128),
  context_mode text NOT NULL DEFAULT 'selected' CHECK (context_mode IN ('selected')),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, workspace_id, id),
  UNIQUE (tenant_id, workspace_id, thread_id, client_request_id),
  FOREIGN KEY (tenant_id, workspace_id, thread_id)
    REFERENCES commerce_agent_thread(tenant_id, workspace_id, thread_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS commerce_agent_product_context_turn_idx
ON commerce_agent_product_context_set (tenant_id, workspace_id, thread_id, turn_id)
WHERE turn_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS commerce_agent_product_context_item (
  tenant_id uuid NOT NULL REFERENCES commerce_tenant(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  context_set_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 19),
  product_id uuid NOT NULL,
  product_revision_id uuid NOT NULL,
  variant_id uuid,
  variant_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (context_set_id, ordinal),
  UNIQUE (tenant_id, workspace_id, context_set_id, product_id, variant_id),
  FOREIGN KEY (tenant_id, workspace_id, context_set_id)
    REFERENCES commerce_agent_product_context_set(tenant_id, workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, workspace_id, product_id)
    REFERENCES commerce_product(tenant_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, workspace_id, product_revision_id, product_id)
    REFERENCES commerce_product_revision(tenant_id, workspace_id, id, product_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, workspace_id, variant_id, product_id)
    REFERENCES commerce_product_variant(tenant_id, workspace_id, id, product_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, workspace_id, variant_revision_id, variant_id)
    REFERENCES commerce_product_variant_revision(tenant_id, workspace_id, id, variant_id) ON DELETE RESTRICT,
  CHECK ((variant_id IS NULL) = (variant_revision_id IS NULL))
);

CREATE OR REPLACE FUNCTION commerce_product_context_set_update_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.workspace_id <> OLD.workspace_id
     OR NEW.user_id <> OLD.user_id OR NEW.thread_id <> OLD.thread_id
     OR NEW.client_request_id <> OLD.client_request_id OR NEW.context_mode <> OLD.context_mode THEN
    RAISE EXCEPTION 'product context identity is immutable';
  END IF;
  IF OLD.turn_id IS NOT NULL AND NEW.turn_id IS DISTINCT FROM OLD.turn_id THEN
    RAISE EXCEPTION 'bound product context turn is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS commerce_agent_product_context_set_update_guard
ON commerce_agent_product_context_set;
CREATE TRIGGER commerce_agent_product_context_set_update_guard
BEFORE UPDATE ON commerce_agent_product_context_set
FOR EACH ROW EXECUTE FUNCTION commerce_product_context_set_update_guard();

ALTER TABLE commerce_agent_product_context_set ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_agent_product_context_set FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_agent_product_context_set_isolation ON commerce_agent_product_context_set;
CREATE POLICY commerce_agent_product_context_set_isolation ON commerce_agent_product_context_set
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

ALTER TABLE commerce_agent_product_context_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_agent_product_context_item FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commerce_agent_product_context_item_isolation ON commerce_agent_product_context_item;
CREATE POLICY commerce_agent_product_context_item_isolation ON commerce_agent_product_context_item
USING (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
  AND EXISTS (
    SELECT 1 FROM commerce_agent_product_context_set context_set
    WHERE context_set.tenant_id = commerce_agent_product_context_item.tenant_id
      AND context_set.workspace_id = commerce_agent_product_context_item.workspace_id
      AND context_set.id = commerce_agent_product_context_item.context_set_id
      AND context_set.user_id = NULLIF(current_setting('commerce.user_id', true), '')
  )
)
WITH CHECK (
  tenant_id = NULLIF(current_setting('commerce.tenant_id', true), '')::uuid
  AND workspace_id = NULLIF(current_setting('commerce.workspace_id', true), '')::uuid
  AND EXISTS (
    SELECT 1 FROM commerce_agent_product_context_set context_set
    WHERE context_set.tenant_id = commerce_agent_product_context_item.tenant_id
      AND context_set.workspace_id = commerce_agent_product_context_item.workspace_id
      AND context_set.id = commerce_agent_product_context_item.context_set_id
      AND context_set.user_id = NULLIF(current_setting('commerce.user_id', true), '')
  )
);

REVOKE ALL ON commerce_agent_product_context_set, commerce_agent_product_context_item FROM PUBLIC;
REVOKE ALL ON FUNCTION commerce_product_context_set_update_guard() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_pilot_app') THEN
    GRANT SELECT, INSERT, UPDATE ON commerce_agent_product_context_set TO commerce_pilot_app;
    GRANT SELECT, INSERT ON commerce_agent_product_context_item TO commerce_pilot_app;
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
          'product_catalog.read', 'product_catalog.import',
          'product_catalog.review', 'product_catalog.sources.manage'
        ]::text[]
        WHEN 'tenant_admin' THEN ARRAY[
          'product_catalog.read', 'product_catalog.import',
          'product_catalog.review', 'product_catalog.sources.manage'
        ]::text[]
        WHEN 'workspace_owner' THEN ARRAY[
          'product_catalog.read', 'product_catalog.import',
          'product_catalog.review', 'product_catalog.sources.manage'
        ]::text[]
        WHEN 'workspace_operator' THEN ARRAY['product_catalog.read']::text[]
        WHEN 'workspace_analyst' THEN ARRAY['product_catalog.read']::text[]
        ELSE ARRAY[]::text[]
      END
    ) AS permission
    ORDER BY permission
  )
), updated_at = CURRENT_TIMESTAMP
WHERE is_system = true;

COMMENT ON TABLE commerce_agent_product_context_set IS
  'Server-authoritative product-selection snapshot bound to one Harness thread request and, after start, one Turn.';
COMMENT ON TABLE commerce_agent_product_context_item IS
  'Immutable references to exact Product/SKU revisions selected for a Harness Turn; product payloads are not copied into model history.';
