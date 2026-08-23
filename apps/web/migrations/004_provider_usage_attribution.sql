ALTER TABLE commerce_agent_usage_event
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'codex_harness',
  ADD COLUMN IF NOT EXISTS requested_model text;

ALTER TABLE commerce_agent_usage_event
  DROP CONSTRAINT IF EXISTS commerce_agent_usage_source_check;
ALTER TABLE commerce_agent_usage_event
  ADD CONSTRAINT commerce_agent_usage_source_check
  CHECK (source IN (
    'codex_harness',
    'commerce_web_mcp',
    'commerce_web_tool',
    'commerce_image_tool'
  ));

CREATE INDEX IF NOT EXISTS commerce_agent_usage_source_time_idx
ON commerce_agent_usage_event (tenant_id, source, occurred_at DESC);
