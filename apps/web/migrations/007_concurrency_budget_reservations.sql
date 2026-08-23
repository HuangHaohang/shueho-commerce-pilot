ALTER TABLE commerce_enterprise_contract
  ADD COLUMN IF NOT EXISTS token_reservation_per_turn bigint NOT NULL DEFAULT 50000,
  ADD COLUMN IF NOT EXISTS max_agent_threads_per_session integer NOT NULL DEFAULT 4;

ALTER TABLE commerce_enterprise_contract
  DROP CONSTRAINT IF EXISTS commerce_enterprise_contract_token_reservation_check;
ALTER TABLE commerce_enterprise_contract
  ADD CONSTRAINT commerce_enterprise_contract_token_reservation_check
  CHECK (token_reservation_per_turn > 0);

ALTER TABLE commerce_enterprise_contract
  DROP CONSTRAINT IF EXISTS commerce_enterprise_contract_agent_threads_check;
ALTER TABLE commerce_enterprise_contract
  ADD CONSTRAINT commerce_enterprise_contract_agent_threads_check
  CHECK (max_agent_threads_per_session BETWEEN 1 AND 16);
