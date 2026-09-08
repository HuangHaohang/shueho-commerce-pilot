import { sha256Json } from "./canonical.js";
import { database } from "./database.js";
import { capabilityRevision, DataCapabilityError, type DataCapabilityRow } from "./data-capabilities.js";
import { validateLocalizedKeywords, type MarketplaceMarketContext } from "./market-localization.js";
import type { JsonObject } from "./types.js";

/** Generic access cannot make an unreviewed official market enum executable. */
export async function dataRequestRevision(row: DataCapabilityRow, inputs: JsonObject): Promise<string> {
  const options = await database.query<{
    parameter_name: string; market_code: string; display_name: string; localization_ready: boolean;
    profile_id: string | null; definition_sha256: string | null; preferred_query_locale: string | null;
    query_locales: string[] | null; accepted_query_languages: string[] | null; timezone: string | null; currency: string | null;
    keyword_localization_policy: "none" | "agent_generated_validated" | null; script_policy: JsonObject | null;
  }>(`SELECT option.parameter_name,option.market_code,option.display_name,option.localization_ready,
    profile.id AS profile_id,profile.definition_sha256,profile.preferred_query_locale,profile.query_locales,
    profile.accepted_query_languages,profile.timezone,profile.currency,profile.keyword_localization_policy,profile.script_policy
    FROM provider_market_option option LEFT JOIN provider_market_profile profile ON profile.id=option.market_profile_id AND profile.enabled
    WHERE option.endpoint_id=$1 AND option.enabled ORDER BY option.parameter_name,option.sort_order`,[row.endpoint_id]);
  const revisions: JsonObject[] = [];
  for (const parameter of new Set(options.rows.map((option) => option.parameter_name))) {
    const selected = options.rows.find((option) => option.parameter_name === parameter && option.market_code === inputs[parameter]);
    if (!selected || !selected.localization_ready || !selected.profile_id || !selected.definition_sha256) {
      throw new DataCapabilityError("必须选择具有有效语言和质量档案的市场选项。", "DATA_MARKET_NOT_READY",{parameter});
    }
    if (typeof inputs.keyword === "string") {
      const context: MarketplaceMarketContext = {
        profileId:selected.profile_id,profileRevision:selected.definition_sha256,marketCode:selected.market_code,displayName:selected.display_name,
        preferredQueryLocale:selected.preferred_query_locale!,queryLocales:selected.query_locales!,acceptedQueryLanguages:selected.accepted_query_languages!,
        timezone:selected.timezone!,currency:selected.currency!,keywordLocalizationPolicy:selected.keyword_localization_policy!,
        expectedScripts:Array.isArray(selected.script_policy?.expectedScripts) ? selected.script_policy.expectedScripts as string[] : [],qualityPolicy:{},
      };
      validateLocalizedKeywords([inputs.keyword],context);
    }
    revisions.push({parameter,market:selected.market_code,profileRevision:selected.definition_sha256});
  }
  return sha256Json({capability:capabilityRevision(row),markets:revisions});
}
