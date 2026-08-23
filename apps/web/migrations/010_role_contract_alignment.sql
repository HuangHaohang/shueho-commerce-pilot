UPDATE commerce_enterprise_role
SET allowed_permissions = ARRAY['workspaces.read', 'usage.read']::text[],
    description = '只读查看工作区元数据和用量；对话共享将在独立授权面上线。',
    updated_at = CURRENT_TIMESTAMP
WHERE is_system AND role_key = 'workspace_analyst' AND scope = 'workspace';

UPDATE commerce_enterprise_role
SET allowed_permissions = ARRAY['workspaces.read']::text[],
    description = '只读查看工作区元数据，不授予对话或产物访问。',
    updated_at = CURRENT_TIMESTAMP
WHERE is_system AND role_key = 'workspace_viewer' AND scope = 'workspace';

UPDATE commerce_enterprise_contract
SET monthly_total_token_limit = COALESCE(monthly_total_token_limit, 50000000),
    monthly_model_request_limit = COALESCE(monthly_model_request_limit, 50000),
    version = version + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE monthly_total_token_limit IS NULL OR monthly_model_request_limit IS NULL;
