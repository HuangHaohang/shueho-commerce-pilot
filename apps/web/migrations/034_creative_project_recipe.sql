ALTER TABLE commerce_agent_thread
  DROP CONSTRAINT IF EXISTS commerce_agent_thread_recipe_id_check;

ALTER TABLE commerce_agent_thread
  ADD CONSTRAINT commerce_agent_thread_recipe_id_check
  CHECK (recipe_id IS NULL OR recipe_id IN (
    'copywriting', 'market_research', 'creative_project'
  ));

UPDATE commerce_agent_thread
SET category = 'creative'
WHERE recipe_id = 'creative_project'
  AND category IS DISTINCT FROM 'creative';
