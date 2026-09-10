CREATE INDEX research_task_recent_scope ON research_task(tenant_id,workspace_id,user_id,created_at DESC,id DESC);
