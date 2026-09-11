-- Image edit sessions must link projects and native threads in the same actor scope.
ALTER TABLE commerce_agent_thread ADD CONSTRAINT commerce_agent_thread_actor_thread_unique
  UNIQUE (tenant_id, workspace_id, user_id, thread_id);
ALTER TABLE commerce_creative_image_session
  DROP CONSTRAINT commerce_creative_image_session_project_thread_id_fkey,
  DROP CONSTRAINT commerce_creative_image_session_thread_id_fkey,
  ADD CONSTRAINT image_session_project_actor_fk FOREIGN KEY (tenant_id, workspace_id, user_id, project_thread_id)
    REFERENCES commerce_agent_thread(tenant_id, workspace_id, user_id, thread_id) ON DELETE CASCADE,
  ADD CONSTRAINT image_session_thread_actor_fk FOREIGN KEY (tenant_id, workspace_id, user_id, thread_id)
    REFERENCES commerce_agent_thread(tenant_id, workspace_id, user_id, thread_id) ON DELETE CASCADE;
CREATE INDEX image_session_actor_project_idx ON commerce_creative_image_session
  (tenant_id, workspace_id, user_id, project_thread_id, created_at);
