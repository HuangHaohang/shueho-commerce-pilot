-- A newly configured key can attempt an authorized endpoint without an imported
-- quota snapshot. Unknown remaining balance stays NULL; never invent credit.
ALTER TABLE justoneapi_token_endpoint_quota
  DROP CONSTRAINT justoneapi_token_endpoint_quota_check;
COMMENT ON COLUMN justoneapi_token_endpoint_quota.remaining_calls IS
  'Optional observed provider balance, not a local dispatch allowance. NULL means unobserved.';
