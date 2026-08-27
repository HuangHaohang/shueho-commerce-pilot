ALTER TABLE provider_market_option
  ADD COLUMN IF NOT EXISTS sort_order integer;

WITH ranked AS (
  SELECT endpoint_id,parameter_name,market_code,
         row_number() OVER (
           PARTITION BY endpoint_id,parameter_name ORDER BY market_code
         ) - 1 AS ordinal
  FROM provider_market_option
)
UPDATE provider_market_option option
SET sort_order=ranked.ordinal
FROM ranked
WHERE ranked.endpoint_id=option.endpoint_id
  AND ranked.parameter_name=option.parameter_name
  AND ranked.market_code=option.market_code
  AND option.sort_order IS NULL;

ALTER TABLE provider_market_option
  ALTER COLUMN sort_order SET NOT NULL;

ALTER TABLE provider_market_option
  DROP CONSTRAINT IF EXISTS provider_market_option_sort_order_check;
ALTER TABLE provider_market_option
  ADD CONSTRAINT provider_market_option_sort_order_check
    CHECK (sort_order BETWEEN 0 AND 999);
