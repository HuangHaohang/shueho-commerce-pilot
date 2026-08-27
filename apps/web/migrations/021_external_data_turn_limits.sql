ALTER TABLE commerce_external_data_policy
  ADD COLUMN IF NOT EXISTS per_turn_call_limit integer
    CHECK (per_turn_call_limit IS NULL OR per_turn_call_limit BETWEEN 1 AND 100);

ALTER TABLE commerce_external_data_policy
  ALTER COLUMN retention_days DROP NOT NULL;

ALTER TABLE commerce_external_data_policy
  DROP CONSTRAINT IF EXISTS commerce_external_data_policy_retention_days_check;

ALTER TABLE commerce_external_data_policy
  ADD CONSTRAINT commerce_external_data_policy_retention_days_check
  CHECK (retention_days IS NULL OR retention_days BETWEEN 30 AND 730);

COMMENT ON COLUMN commerce_external_data_policy.per_turn_call_limit IS
  'Maximum reserved or dispatched paid external-data calls in one Codex Turn; NULL means no per-Turn cap.';

COMMENT ON COLUMN commerce_external_data_policy.retention_days IS
  'Retention for external-data call, approval, audit, and billing metadata; NULL means permanent metadata retention. Upstream result bodies are not persisted here.';
