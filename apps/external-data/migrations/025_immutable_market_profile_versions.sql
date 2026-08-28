ALTER TABLE provider_market_profile
  DROP CONSTRAINT IF EXISTS provider_market_profile_provider_platform_id_market_code_key;

ALTER TABLE provider_market_profile
  ADD CONSTRAINT provider_market_profile_definition_unique
    UNIQUE (provider,platform_id,market_code,definition_sha256);

CREATE UNIQUE INDEX IF NOT EXISTS provider_market_profile_active_unique
ON provider_market_profile (provider,platform_id,market_code)
WHERE enabled=true;

CREATE OR REPLACE FUNCTION external_data_enforce_market_profile_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.provider <> OLD.provider
     OR NEW.platform_id <> OLD.platform_id
     OR NEW.market_code <> OLD.market_code
     OR NEW.display_locale <> OLD.display_locale
     OR NEW.preferred_query_locale <> OLD.preferred_query_locale
     OR NEW.query_locales <> OLD.query_locales
     OR NEW.accepted_query_languages <> OLD.accepted_query_languages
     OR NEW.timezone <> OLD.timezone
     OR NEW.currency <> OLD.currency
     OR NEW.keyword_localization_policy <> OLD.keyword_localization_policy
     OR NEW.script_policy <> OLD.script_policy
     OR NEW.quality_policy <> OLD.quality_policy
     OR NEW.definition_sha256 <> OLD.definition_sha256
     OR NEW.source_profile_import_id <> OLD.source_profile_import_id
     OR NEW.source_catalog_import_id <> OLD.source_catalog_import_id THEN
    RAISE EXCEPTION 'provider market profile definitions are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS provider_market_profile_definition_immutable
ON provider_market_profile;
CREATE TRIGGER provider_market_profile_definition_immutable
BEFORE UPDATE ON provider_market_profile
FOR EACH ROW EXECUTE FUNCTION external_data_enforce_market_profile_immutability();

REVOKE ALL ON FUNCTION external_data_enforce_market_profile_immutability() FROM PUBLIC;

COMMENT ON COLUMN provider_market_profile.definition_sha256 IS
  'Immutable semantic profile revision. A changed locale, script, currency, timezone or quality policy creates a new row.';
