import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { PoolClient } from "pg";
import { z } from "zod";

import { catalogSha256 } from "./catalog-import.js";

const qualityPolicySchema = z.object({
  embeddingMinScore: z.number().min(-1).max(1),
  rerankMinScore: z.number().min(0).max(1),
  lexicalPromoteMinScore: z.number().min(0).max(1),
  holdRelevanceMinScore: z.number().min(0).max(1),
}).strict();

const profileSchema = z.object({
  platform: z.string().regex(/^[a-z0-9_]+$/),
  market: z.string().regex(/^[A-Z0-9_-]{2,32}$/),
  preferredQueryLocale: z.string().min(2).max(40),
  queryLocales: z.array(z.string().min(2).max(40)).min(1).max(8),
  acceptedQueryLanguages: z.array(z.string().regex(/^[a-z]{2,3}$/)).min(1).max(8),
  timezone: z.string().min(3).max(100),
  currency: z.string().regex(/^[A-Z]{3}$/),
  expectedScripts: z.array(z.enum(["Arab", "Deva", "Hans", "Hant", "Jpan", "Latn", "Thai"])).min(1).max(8),
}).strict();

const documentSchema = z.object({
  schemaVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  sourceName: z.string().min(1).max(200),
  defaults: z.object({
    displayLocale: z.string().min(2).max(40),
    keywordLocalizationPolicy: z.enum(["none", "agent_generated_validated"]),
    detailSampleSize: z.number().int().min(1).max(10),
    maxDetailSampleSize: z.number().int().min(1).max(10),
    qualityPolicy: qualityPolicySchema,
  }).strict(),
  profiles: z.array(profileSchema).min(1).max(500),
}).strict();

export type ProviderMarketProfile = {
  platformId: string;
  marketCode: string;
  displayLocale: string;
  preferredQueryLocale: string;
  queryLocales: string[];
  acceptedQueryLanguages: string[];
  timezone: string;
  currency: string;
  keywordLocalizationPolicy: "none" | "agent_generated_validated";
  expectedScripts: Array<"Arab" | "Deva" | "Hans" | "Hant" | "Jpan" | "Latn" | "Thai">;
  qualityPolicy: z.infer<typeof qualityPolicySchema>;
  detailSampleSize: number;
  maxDetailSampleSize: number;
  definitionSha256: string;
};

export type MarketProfileSource = {
  sourceName: string;
  sourceVersion: string;
  sourceSha256: string;
  sourceDocument: z.infer<typeof documentSchema>;
  profiles: ProviderMarketProfile[];
};

const defaultSourcePath = fileURLToPath(new URL("../catalog/market-language-profiles.v1.json", import.meta.url));

export function readMarketProfileSource(path = defaultSourcePath): MarketProfileSource {
  const body = readFileSync(path, "utf8");
  const sourceDocument = documentSchema.parse(JSON.parse(body));
  const sourceSha256 = createHash("sha256").update(body, "utf8").digest("hex");
  const seen = new Set<string>();
  const profiles = sourceDocument.profiles.map((profile): ProviderMarketProfile => {
    validateLocale(profile.preferredQueryLocale);
    for (const locale of profile.queryLocales) validateLocale(locale);
    validateTimezone(profile.timezone);
    if (!profile.queryLocales.includes(profile.preferredQueryLocale)) {
      throw new Error(`${profile.platform}.${profile.market} preferred query locale is not in queryLocales.`);
    }
    const key = `${profile.platform}:${profile.market}`;
    if (seen.has(key)) throw new Error(`Duplicate market profile ${key}.`);
    seen.add(key);
    const normalized = {
      platformId: profile.platform,
      marketCode: profile.market,
      displayLocale: sourceDocument.defaults.displayLocale,
      preferredQueryLocale: profile.preferredQueryLocale,
      queryLocales: [...new Set(profile.queryLocales)],
      acceptedQueryLanguages: [...new Set(profile.acceptedQueryLanguages)],
      timezone: profile.timezone,
      currency: profile.currency,
      keywordLocalizationPolicy: sourceDocument.defaults.keywordLocalizationPolicy,
      expectedScripts: [...new Set(profile.expectedScripts)],
      qualityPolicy: sourceDocument.defaults.qualityPolicy,
      detailSampleSize: sourceDocument.defaults.detailSampleSize,
      maxDetailSampleSize: sourceDocument.defaults.maxDetailSampleSize,
    };
    return { ...normalized, definitionSha256: catalogSha256(normalized) };
  });
  return {
    sourceName: sourceDocument.sourceName,
    sourceVersion: sourceDocument.schemaVersion,
    sourceSha256,
    sourceDocument,
    profiles,
  };
}

export async function syncProviderMarketProfiles(
  client: Pick<PoolClient, "query">,
  sourceCatalogImportId: string,
  source = readMarketProfileSource(),
): Promise<{ receiptId: string; profileCount: number; linkedOptionCount: number; missingOptions: string[] }> {
  const inserted = await client.query<{ id: string }>(`
    INSERT INTO provider_market_profile_import_receipt (
      provider,source_name,source_version,source_sha256,profile_count,manifest
    ) VALUES ('justoneapi',$1,$2,$3,$4,$5::jsonb)
    ON CONFLICT (provider,source_sha256) DO NOTHING
    RETURNING id
  `, [
    source.sourceName,
    source.sourceVersion,
    source.sourceSha256,
    source.profiles.length,
    JSON.stringify(source.sourceDocument),
  ]);
  const existing = inserted.rows[0] ? inserted : await client.query<{ id: string }>(`
    SELECT id FROM provider_market_profile_import_receipt
    WHERE provider='justoneapi' AND source_sha256=$1
  `, [source.sourceSha256]);
  const receiptId = existing.rows[0]?.id;
  if (!receiptId) throw new Error("Provider market profile import receipt was not created.");
  await client.query(`
    UPDATE provider_market_profile SET enabled=false,updated_at=CURRENT_TIMESTAMP
    WHERE provider='justoneapi' AND enabled=true
  `);
  await client.query(`
    INSERT INTO provider_market_profile (
      provider,platform_id,market_code,display_locale,preferred_query_locale,
      query_locales,accepted_query_languages,timezone,currency,
      keyword_localization_policy,script_policy,quality_policy,definition_sha256,
      source_profile_import_id,source_catalog_import_id,enabled
    )
    SELECT 'justoneapi',item.platform_id,item.market_code,item.display_locale,
           item.preferred_query_locale,item.query_locales,item.accepted_query_languages,
           item.timezone,item.currency,item.keyword_localization_policy,
           item.script_policy,item.quality_policy,item.definition_sha256,$2,$3,true
    FROM jsonb_to_recordset($1::jsonb) AS item(
      platform_id text,market_code text,display_locale text,preferred_query_locale text,
      query_locales text[],accepted_query_languages text[],timezone text,currency text,
      keyword_localization_policy text,script_policy jsonb,quality_policy jsonb,
      definition_sha256 text
    )
    ON CONFLICT (provider,platform_id,market_code,definition_sha256) DO UPDATE SET
      enabled=true,updated_at=CURRENT_TIMESTAMP
  `, [JSON.stringify(source.profiles.map((profile) => ({
    platform_id: profile.platformId,
    market_code: profile.marketCode,
    display_locale: profile.displayLocale,
    preferred_query_locale: profile.preferredQueryLocale,
    query_locales: profile.queryLocales,
    accepted_query_languages: profile.acceptedQueryLanguages,
    timezone: profile.timezone,
    currency: profile.currency,
    keyword_localization_policy: profile.keywordLocalizationPolicy,
    script_policy: { expectedScripts: profile.expectedScripts },
    quality_policy: {
      ...profile.qualityPolicy,
      detailSampleSize: profile.detailSampleSize,
      maxDetailSampleSize: profile.maxDetailSampleSize,
    },
    definition_sha256: profile.definitionSha256,
  }))), receiptId, sourceCatalogImportId]);
  await client.query(`
    UPDATE provider_market_option option
    SET market_profile_id=profile.id,localization_ready=true,updated_at=CURRENT_TIMESTAMP
    FROM provider_market_profile profile
    WHERE option.provider='justoneapi' AND option.source_catalog_import_id=$1
      AND profile.provider=option.provider AND profile.platform_id=option.platform_id
      AND profile.market_code=option.market_code AND profile.enabled=true
  `, [sourceCatalogImportId]);
  await client.query(`
    UPDATE provider_market_option option
    SET market_profile_id=NULL,localization_ready=false,updated_at=CURRENT_TIMESTAMP
    WHERE option.provider='justoneapi' AND option.source_catalog_import_id=$1
      AND NOT EXISTS (
        SELECT 1 FROM provider_market_profile profile
        WHERE profile.provider=option.provider AND profile.platform_id=option.platform_id
          AND profile.market_code=option.market_code AND profile.enabled=true
      )
  `, [sourceCatalogImportId]);
  const linked = await client.query<{ linked: string }>(`
    SELECT count(*)::text AS linked FROM provider_market_option
    WHERE provider='justoneapi' AND source_catalog_import_id=$1 AND localization_ready=true
  `, [sourceCatalogImportId]);
  const missing = await client.query<{ platform_id: string; market_code: string }>(`
    SELECT DISTINCT option.platform_id,option.market_code
    FROM provider_market_option option
    JOIN provider_business_workflow_step step ON step.endpoint_id=option.endpoint_id
    JOIN provider_business_workflow workflow ON workflow.workflow_id=step.workflow_id
    WHERE option.provider='justoneapi' AND option.source_catalog_import_id=$1
      AND option.enabled=true AND option.localization_ready=false AND workflow.status='active'
    ORDER BY option.platform_id,option.market_code
  `, [sourceCatalogImportId]);
  return {
    receiptId,
    profileCount: source.profiles.length,
    linkedOptionCount: Number(linked.rows[0]?.linked ?? 0),
    missingOptions: missing.rows.map((row) => `${row.platform_id}:${row.market_code}`),
  };
}

function validateLocale(locale: string): void {
  try {
    const normalized = new Intl.Locale(locale).toString();
    if (!normalized) throw new Error("empty locale");
  } catch {
    throw new Error(`Invalid BCP-47 locale ${locale}.`);
  }
}

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new Error(`Invalid IANA timezone ${timezone}.`);
  }
}
