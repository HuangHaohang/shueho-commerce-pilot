ALTER TABLE commerce_agent_thread
  ADD COLUMN IF NOT EXISTS recipe_id text;

ALTER TABLE commerce_agent_thread
  DROP CONSTRAINT IF EXISTS commerce_agent_thread_recipe_id_check;
ALTER TABLE commerce_agent_thread
  ADD CONSTRAINT commerce_agent_thread_recipe_id_check
  CHECK (recipe_id IS NULL OR recipe_id IN ('copywriting'));

UPDATE commerce_agent_thread
SET recipe_id = 'copywriting'
WHERE recipe_id IS NULL
  AND (title LIKE '文案任务 · %' OR title LIKE '文案生成 · %');

CREATE INDEX IF NOT EXISTS commerce_agent_thread_recipe_updated_idx
ON commerce_agent_thread (tenant_id, workspace_id, created_by_user_id, recipe_id, updated_at DESC);
