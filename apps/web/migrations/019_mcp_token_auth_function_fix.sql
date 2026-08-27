CREATE OR REPLACE FUNCTION commerce_authenticate_mcp_access_token(
  p_token_prefix text,
  p_token_hash_hex text
)
RETURNS TABLE (
  token_id uuid,
  tenant_id uuid,
  workspace_id uuid,
  user_id text,
  scopes text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_token_prefix !~ '^cp_[a-zA-Z0-9]{8}$' OR p_token_hash_hex !~ '^[a-f0-9]{64}$' THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH token_record AS (
    SELECT token.id, token.tenant_id, token.workspace_id,
           token.created_by_user_id, token.scopes
    FROM commerce_mcp_access_token token
    INNER JOIN commerce_tenant tenant
      ON tenant.id = token.tenant_id AND tenant.status = 'active'
    INNER JOIN commerce_organization organization
      ON organization.id = tenant.organization_id AND organization.status = 'active'
    INNER JOIN commerce_workspace workspace
      ON workspace.tenant_id = token.tenant_id
     AND workspace.id = token.workspace_id
     AND workspace.status = 'active'
    INNER JOIN commerce_tenant_membership tenant_member
      ON tenant_member.tenant_id = token.tenant_id
     AND tenant_member.user_id = token.created_by_user_id
     AND tenant_member.status = 'active'
    INNER JOIN commerce_workspace_membership workspace_member
      ON workspace_member.tenant_id = token.tenant_id
     AND workspace_member.workspace_id = token.workspace_id
     AND workspace_member.user_id = token.created_by_user_id
     AND workspace_member.status = 'active'
    INNER JOIN commerce_enterprise_contract contract
      ON contract.tenant_id = token.tenant_id
     AND contract.status = 'active'
     AND contract.effective_from <= CURRENT_TIMESTAMP
     AND (contract.effective_until IS NULL OR contract.effective_until > CURRENT_TIMESTAMP)
    WHERE token.token_prefix = p_token_prefix
      AND token.token_hash = decode(p_token_hash_hex, 'hex')
      AND token.status = 'active'
      AND (token.expires_at IS NULL OR token.expires_at > CURRENT_TIMESTAMP)
    LIMIT 1
  ), effective_roles AS (
    SELECT token.id AS token_id, role.allowed_permissions, role.denied_permissions
    FROM token_record token
    INNER JOIN commerce_user_role_assignment assignment
      ON assignment.tenant_id = token.tenant_id
     AND assignment.user_id = token.created_by_user_id
     AND (assignment.workspace_id IS NULL OR assignment.workspace_id = token.workspace_id)
    INNER JOIN commerce_enterprise_role role
      ON role.tenant_id = assignment.tenant_id AND role.id = assignment.role_id
    UNION ALL
    SELECT token.id AS token_id, role.allowed_permissions, role.denied_permissions
    FROM token_record token
    INNER JOIN commerce_enterprise_group_member member
      ON member.tenant_id = token.tenant_id AND member.user_id = token.created_by_user_id
    INNER JOIN commerce_enterprise_group "group"
      ON "group".tenant_id = member.tenant_id
     AND "group".id = member.group_id
     AND "group".status = 'active'
    INNER JOIN commerce_group_role_assignment assignment
      ON assignment.tenant_id = member.tenant_id
     AND assignment.group_id = member.group_id
     AND (assignment.workspace_id IS NULL OR assignment.workspace_id = token.workspace_id)
    INNER JOIN commerce_enterprise_role role
      ON role.tenant_id = assignment.tenant_id AND role.id = assignment.role_id
  ), permission_state AS (
    SELECT effective_role.token_id,
           array_agg(DISTINCT allowed.value)
             FILTER (WHERE allowed.value IS NOT NULL) AS allowed_permissions,
           array_agg(DISTINCT denied.value)
             FILTER (WHERE denied.value IS NOT NULL) AS denied_permissions
    FROM effective_roles effective_role
    LEFT JOIN LATERAL unnest(effective_role.allowed_permissions) AS allowed(value) ON true
    LEFT JOIN LATERAL unnest(effective_role.denied_permissions) AS denied(value) ON true
    GROUP BY effective_role.token_id
  ), authorized AS (
    SELECT token.id, token.tenant_id, token.workspace_id, token.created_by_user_id,
           ARRAY(
             SELECT requested_scope
             FROM unnest(token.scopes) requested_scope
             WHERE requested_scope = ANY(COALESCE(permission.allowed_permissions, '{}'::text[]))
               AND NOT requested_scope = ANY(COALESCE(permission.denied_permissions, '{}'::text[]))
             ORDER BY requested_scope
           ) AS effective_scopes
    FROM token_record token
    LEFT JOIN permission_state permission ON permission.token_id = token.id
  ), touched AS (
    UPDATE commerce_mcp_access_token token
    SET last_used_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    FROM authorized
    WHERE token.id = authorized.id
      AND cardinality(authorized.effective_scopes) > 0
    RETURNING token.id
  )
  SELECT authorized.id, authorized.tenant_id, authorized.workspace_id,
         authorized.created_by_user_id, authorized.effective_scopes
  FROM authorized
  INNER JOIN touched ON touched.id = authorized.id;
END;
$$;

REVOKE ALL ON FUNCTION commerce_authenticate_mcp_access_token(text, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_pilot_app') THEN
    GRANT EXECUTE ON FUNCTION commerce_authenticate_mcp_access_token(text, text)
    TO commerce_pilot_app;
  END IF;
END;
$$;
