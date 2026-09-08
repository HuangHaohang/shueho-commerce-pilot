import type { EnrichmentCandidate, JsonObject } from "./types.js";

export const ENRICHMENT_VERSION = "commerce-relevance-v4";

type MetricStatus = "available" | "missing" | "invalid";
export type ProductMetricAssessment = {
  price: JsonObject & { status: MetricStatus };
  sales: JsonObject & { status: MetricStatus };
};

/** Check normalized values, never arbitrary provider key names or model scores. */
export function assessProductMetrics(values: JsonObject, sourceJsonPointer: string | null): ProductMetricAssessment {
  const priceValue = values.price_amount ?? values.price_yuan;
  const amount = finiteNumber(priceValue);
  const currency = typeof values.currency === "string" && /^[A-Z]{3}$/.test(values.currency)
    ? values.currency : values.currency == null && values.price_yuan != null ? "CNY" : null;
  const priceStatus: MetricStatus = priceValue == null ? "missing"
    : amount !== null && amount >= 0 && currency !== null ? "available" : "invalid";
  const lower = finiteNumber(values.sales_lower_bound);
  const upper = finiteNumber(values.sales_upper_bound);
  const qualifier = values.sales_qualifier;
  const validCount = lower !== null && Number.isSafeInteger(lower) && lower >= 0;
  const validInterval = validCount && (
    qualifier === "exact" && upper === lower ||
    qualifier === "gte" && values.sales_upper_bound == null ||
    qualifier === "range" && upper !== null && Number.isSafeInteger(upper) && upper >= lower
  );
  const hasSalesField = [values.sales_display, values.sales_lower_bound, values.sales_upper_bound, qualifier]
    .some((value) => value !== null && value !== undefined && value !== "");
  const salesStatus: MetricStatus = validInterval ? "available" : hasSalesField ? "invalid" : "missing";
  return {
    price: {
      status: priceStatus, sourceJsonPointer, basis: "provider_display_price",
      amount: priceStatus === "available" ? amount : null, currency,
      reason: priceStatus === "available" ? "NORMALIZED_PRICE_AND_CURRENCY"
        : priceStatus === "missing" ? "PRICE_NOT_RETURNED" : "PRICE_OR_CURRENCY_INVALID",
    },
    sales: {
      status: salesStatus, sourceJsonPointer, basis: "provider_sales_interval",
      lowerBound: salesStatus === "available" ? lower : null,
      upperBound: salesStatus === "available" ? upper : null,
      qualifier: typeof qualifier === "string" ? qualifier : null,
      period: null,
      reason: salesStatus === "available" ? "NORMALIZED_SALES_INTERVAL"
        : salesStatus === "missing" ? "SALES_NOT_RETURNED" : "SALES_INTERVAL_UNVERIFIED",
    },
  };
}

export function candidateMetricAssessment(candidate: EnrichmentCandidate): ProductMetricAssessment {
  const metadata = candidate.metadata;
  const values = candidate.entityType === "taobao_item" ? {
    price_yuan: metadata.priceYuan, currency: "CNY",
    sales_display: metadata.salesDisplay, sales_lower_bound: metadata.salesLowerBound,
    sales_upper_bound: metadata.salesUpperBound, sales_qualifier: metadata.salesQualifier,
  } : isObject(metadata.metrics) ? metadata.metrics : {};
  return assessProductMetrics(values, candidate.sourceJsonPointer);
}

/** Public projection deliberately excludes private model thresholds and prompt text. */
export function publicEvidenceAssessment(metadata: unknown): JsonObject {
  const stored = isObject(metadata) ? metadata : {};
  const assessment = isObject(stored.assessment) ? stored.assessment : {};
  const scope = isObject(assessment.scope) ? assessment.scope : {};
  return {
    version: typeof stored.promptVersion === "string" ? stored.promptVersion : null,
    scope: {
      status: scope.status ?? "legacy_unassessed",
      basis: "immutable_research_request_and_model_relevance",
      homogeneousCohortVerified: false,
    },
    ...(isObject(assessment.metrics) ? { metrics: assessment.metrics } : {}),
    ranking: { kind: "relevance_only", calibratedProbability: false },
  };
}

/** Completeness of returned evidence is independent of transport/processing success. */
export function researchAnalysisReadiness(input: {
  processingComplete: boolean;
  requestedMetrics: string[];
  availableMetrics: string[];
  products: JsonObject[];
}): JsonObject {
  const missing = input.requestedMetrics.filter((metric) => !input.availableMetrics.includes(metric));
  const assessments = input.products.map((product) => assessProductMetrics(product,
    typeof product.source_json_pointer === "string" ? product.source_json_pointer : null));
  return {
    processingComplete: input.processingComplete,
    requestedMetricCoverage: !input.requestedMetrics.length ? "not_requested"
      : missing.length === 0 ? "complete" : missing.length === input.requestedMetrics.length ? "none" : "partial",
    missingRequestedMetrics: missing,
    productCount: input.products.length,
    productsWithUsablePrice: assessments.filter((row) => row.price.status === "available").length,
    productsWithUsableSales: assessments.filter((row) => row.sales.status === "available").length,
    sampleOnly: true,
    homogeneousCohortVerified: false,
    salesRanking: {
      supported: false,
      reason: "COMPARABLE_PRODUCT_SCOPE_SALES_PERIOD_AND_MEASURE_NOT_VERIFIED",
    },
  };
}

export function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value
    : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
