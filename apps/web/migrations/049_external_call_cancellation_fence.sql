CREATE TABLE commerce_external_call_cancel_fence (
 tenant_id uuid NOT NULL,workspace_id uuid NOT NULL,user_id text NOT NULL,
 source text NOT NULL CHECK(source IN ('codex_harness','external_mcp')),call_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(tenant_id,source,call_id),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES commerce_workspace(tenant_id,id)
);
ALTER TABLE commerce_external_call_cancel_fence ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce_external_call_cancel_fence FORCE ROW LEVEL SECURITY;
CREATE POLICY external_call_cancel_fence_scope ON commerce_external_call_cancel_fence USING (
 tenant_id=NULLIF(current_setting('commerce.tenant_id',true),'')::uuid AND workspace_id=NULLIF(current_setting('commerce.workspace_id',true),'')::uuid
) WITH CHECK(tenant_id=NULLIF(current_setting('commerce.tenant_id',true),'')::uuid AND workspace_id=NULLIF(current_setting('commerce.workspace_id',true),'')::uuid);
REVOKE ALL ON commerce_external_call_cancel_fence FROM PUBLIC;
GRANT SELECT,INSERT ON commerce_external_call_cancel_fence TO commerce_pilot_app;
