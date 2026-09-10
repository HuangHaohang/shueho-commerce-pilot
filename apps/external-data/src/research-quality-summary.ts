import { socialMetricCoverage } from "./social-metric-coverage.js";
import type { JsonObject } from "./types.js";

/** Counts describe separate layers; zero delivered samples says nothing about source fields. */
export function researchQualitySummary(input: {
  records: Array<{ metrics: JsonObject; published_at: unknown; decision: string; reason_codes: string[] }>;
  acceptedCount: number;
  requestedCount: number;
}) {
  const reasons: Record<string, number> = {};
  for (const row of input.records) {
    if (row.decision === "promote") continue;
    for (const reason of new Set(row.reason_codes)) reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  const source = socialMetricCoverage(input.records);
  return {
    sourceRecords: input.records.length,
    sourceRecordsWithPublishTime: input.records.filter(row => row.published_at != null).length,
    sourceMetricCoverageByField: source.perField,
    exclusionReasons: reasons,
    sampleStatus: input.acceptedCount === 0 ? "no_qualified_samples"
      : input.acceptedCount < input.requestedCount ? "below_requested_count" : "requested_count_reached",
    requestedCount: input.requestedCount,
    acceptedCount: input.acceptedCount,
  };
}

/** Read only bounded pagination metadata, never recurse into individual content records. */
export function sourcePagination(payload: JsonObject): JsonObject {
  const data = object(payload.data);
  const containers = [object(data.pagination), data, object(payload.pagination), payload];
  const flags = containers.flatMap(row => ["has_more", "hasMore", "hasNextPage"].flatMap(key =>
    typeof row[key] === "boolean" ? [row[key] as boolean] : []));
  const numbers = (keys: string[]) => {
    const found = containers.flatMap(row => keys.flatMap(key =>
      typeof row[key] === "number" && Number.isSafeInteger(row[key]) && Number(row[key]) >= 0 ? [Number(row[key])] : []));
    return found.length && found.every(value => value === found[0]) ? found[0]! : null;
  };
  return {
    hasMore: flags.length && flags.every(value => value === flags[0]) ? flags[0]! : null,
    page: numbers(["page", "currentPageNum"]),
    pageSize: numbers(["limit", "pageSize"]),
    providerReportedTotal: numbers(["total_count", "total"]),
    // An upstream total is neither in-window nor quality-qualified.
    totalBasis: "provider_reported_unfiltered",
  };
}
function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
