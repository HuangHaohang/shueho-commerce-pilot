-- Retire only operator-invented zero caps, never provider-confirmed exhaustion.
-- This file is discovered and checksum-registered by the warehouse migration runner.
CREATE TABLE IF NOT EXISTS justoneapi_local_cap_retirement (
  token_id text NOT NULL,
  api_path text NOT NULL,
  previous_state text NOT NULL,
  previous_remaining_calls bigint,
  source_import_id uuid NOT NULL REFERENCES justoneapi_quota_import(id),
  retired_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(token_id,api_path)
);
INSERT INTO justoneapi_local_cap_retirement(token_id,api_path,previous_state,previous_remaining_calls,source_import_id)
SELECT q.token_id,q.api_path,q.state,q.remaining_calls,q.source_import_id
FROM justoneapi_token_endpoint_quota q
JOIN justoneapi_quota_import receipt ON receipt.id=q.source_import_id
WHERE q.state='exhausted' AND receipt.metadata->>'basis'='operator_conservative_cap'
  AND q.reserved_calls=0 AND q.inflight_calls=0
  AND NOT EXISTS (SELECT 1 FROM justoneapi_token_attempt a WHERE a.token_id=q.token_id AND a.api_path=q.api_path
    AND a.state='business_failed' AND a.provider_code IN (303,601,602)
    AND a.response_payload->'code'=to_jsonb(a.provider_code)
    AND (a.http_status BETWEEN 200 AND 299 OR a.http_status=429))
ON CONFLICT DO NOTHING;
UPDATE justoneapi_token_endpoint_quota q SET state='active',updated_at=CURRENT_TIMESTAMP
FROM justoneapi_local_cap_retirement retired
WHERE q.token_id=retired.token_id AND q.api_path=retired.api_path AND q.state='exhausted'
  AND q.source_import_id=retired.source_import_id AND q.reserved_calls=0 AND q.inflight_calls=0
  AND NOT EXISTS (SELECT 1 FROM justoneapi_token_attempt a WHERE a.token_id=q.token_id AND a.api_path=q.api_path
    AND a.state='business_failed' AND a.provider_code IN (303,601,602)
    AND a.response_payload->'code'=to_jsonb(a.provider_code)
    AND (a.http_status BETWEEN 200 AND 299 OR a.http_status=429));
