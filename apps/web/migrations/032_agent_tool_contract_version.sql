ALTER TABLE commerce_agent_thread
  ADD COLUMN IF NOT EXISTS tool_contract_version integer NOT NULL DEFAULT 0;

ALTER TABLE commerce_agent_thread
  DROP CONSTRAINT IF EXISTS commerce_agent_thread_tool_contract_version_check;
ALTER TABLE commerce_agent_thread
  ADD CONSTRAINT commerce_agent_thread_tool_contract_version_check
  CHECK (tool_contract_version >= 0);

COMMENT ON COLUMN commerce_agent_thread.tool_contract_version IS
  'Dynamic tool contract installed by Codex App Server at thread/start. Existing threads are never falsely upgraded on resume.';
