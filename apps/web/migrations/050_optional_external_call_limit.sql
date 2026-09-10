ALTER TABLE commerce_external_data_policy ALTER COLUMN monthly_call_limit DROP NOT NULL;
ALTER TABLE commerce_external_data_policy ADD CONSTRAINT external_data_finite_monthly_budget CHECK(monthly_call_limit IS NOT NULL OR monthly_spend_limit_micros IS NOT NULL);
