ALTER TABLE commerce_agent_thread
  ADD COLUMN IF NOT EXISTS title_model text,
  ADD COLUMN IF NOT EXISTS title_generated_at timestamptz;

ALTER TABLE commerce_agent_usage_event
  DROP CONSTRAINT IF EXISTS commerce_agent_usage_source_check;
ALTER TABLE commerce_agent_usage_event
  ADD CONSTRAINT commerce_agent_usage_source_check
  CHECK (source IN (
    'codex_harness',
    'commerce_web_mcp',
    'commerce_web_tool',
    'commerce_image_tool',
    'title_generation'
  ));
