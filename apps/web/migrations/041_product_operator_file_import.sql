-- Ordinary workspace operators may upload and analyze bounded product files.
-- Review, canonical publication, connector administration, and secrets remain
-- separate permissions held by workspace owners or explicit administrators.
UPDATE commerce_enterprise_role
SET allowed_permissions = array_append(allowed_permissions, 'product_catalog.import'),
    updated_at = CURRENT_TIMESTAMP
WHERE is_system
  AND scope = 'workspace'
  AND role_key = 'workspace_operator'
  AND NOT ('product_catalog.import' = ANY(allowed_permissions));
