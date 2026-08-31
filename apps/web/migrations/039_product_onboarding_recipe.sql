ALTER TABLE commerce_agent_thread
  DROP CONSTRAINT IF EXISTS commerce_agent_thread_recipe_id_check;

ALTER TABLE commerce_agent_thread
  ADD CONSTRAINT commerce_agent_thread_recipe_id_check
  CHECK (recipe_id IS NULL OR recipe_id IN (
    'copywriting', 'market_research', 'creative_project', 'product_onboarding'
  ));

UPDATE commerce_agent_thread
SET category = 'operations'
WHERE recipe_id = 'product_onboarding'
  AND category IS DISTINCT FROM 'operations';
