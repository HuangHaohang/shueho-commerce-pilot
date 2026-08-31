import { readWebSourcesFromToolItem, type WebSource } from "./web-sources";

export type ToolActivityMetadata = {
  kind: "image" | "search" | "tool";
  detail: string | null;
  isWebSearch: boolean;
  namespace: string;
  research: ResearchToolProjection | null;
  sources: WebSource[];
  tool: string;
};

export type ResearchPlanReceipt = {
  kind: "plan";
  productCount: number | null;
  snapshotSha256: string | null;
  estimatedProviderCalls: number;
  quote: {
    currency: string;
    providerCallCount: number;
    priced: boolean;
    billableAmountMicros: number | null;
  } | null;
  coverage: {
    platform: string | null;
    market: string | null;
    plannedProducts: number | null;
    reviewStepsPlanned: number | null;
    requestedMetrics: string[];
  };
  expiresAt: string;
};

export type ResearchEvidenceReceipt = {
  kind: "evidence";
  researchRequestId: string;
  platform: string | null;
  observedAt: string;
  evidenceCount: number;
  reviewEvidenceCount: number;
  coverage: {
    acceptedProducts: number | null;
    acceptedEvidence: number | null;
    reviewStepsCompleted: number | null;
    reviewStepAvailable: boolean | null;
    requestedMetrics: string[];
    missingRequestedMetrics: string[];
  };
  limitations: string[];
};

export type ResearchToolProjection = ResearchPlanReceipt | ResearchEvidenceReceipt;

export function readDynamicToolActivity(item: Record<string, unknown>): ToolActivityMetadata {
  const namespace = typeof item.namespace === "string" ? item.namespace : "";
  const tool = typeof item.tool === "string" ? item.tool : "工具";
  const isWebSearch = namespace === "commerce_web";
  return {
    namespace,
    tool,
    isWebSearch,
    kind: namespace === "commerce_image" ? "image" : isWebSearch ? "search" : "tool",
    detail: isWebSearch ? readWebSearchFailure(item) : namespace ? `${namespace}.${tool}` : tool,
    research: namespace === "commerce_data" ? readCommerceDataProjection(item, tool) : null,
    sources: isWebSearch ? readWebSourcesFromToolItem(item) : [],
  };
}

export function readMcpToolActivity(item: Record<string, unknown>): ToolActivityMetadata {
  const namespace = typeof item.server === "string" ? item.server : "";
  const tool = typeof item.tool === "string" ? item.tool : "";
  const isWebSearch = namespace === "commerce_web" && tool === "search";
  return {
    namespace,
    tool,
    isWebSearch,
    kind: isWebSearch ? "search" : "tool",
    detail: isWebSearch ? readWebSearchFailure(item) : tool || null,
    research: null,
    sources: isWebSearch ? readWebSourcesFromToolItem(item) : [],
  };
}

function readCommerceDataProjection(
  item: Record<string, unknown>,
  tool: string,
): ResearchToolProjection | null {
  const payload = readDynamicToolPayload(item);
  if (!payload) return null;
  if (tool === "plan_marketplace_research") return readResearchPlanReceipt(payload);
  if (
    tool === "execute_marketplace_research" ||
    tool === "research_social_content" ||
    tool === "get_research_result"
  ) {
    return readResearchEvidenceReceipt(payload);
  }
  return null;
}

function readResearchPlanReceipt(payload: Record<string, unknown>): ResearchPlanReceipt | null {
  if (payload.state !== "ready") return null;
  const coverage = isRecord(payload.coverage) ? payload.coverage : {};
  const subject = isRecord(payload.subject_receipt)
    ? payload.subject_receipt
    : isRecord(coverage.first_party_subject)
      ? coverage.first_party_subject
      : {};
  const quote = isRecord(payload.quote) ? payload.quote : null;
  const estimatedProviderCalls = safeNonNegativeInteger(payload.estimated_provider_calls);
  const expiresAt = safeText(payload.expires_at, 160);
  if (estimatedProviderCalls === null || !expiresAt) return null;
  const snapshotSha256 = safeText(subject.snapshot_sha256, 64);
  const productCount = safeNonNegativeInteger(subject.product_count);
  return {
    kind: "plan",
    productCount,
    snapshotSha256: snapshotSha256 && /^[a-f0-9]{64}$/.test(snapshotSha256) ? snapshotSha256 : null,
    estimatedProviderCalls,
    quote: quote ? readResearchQuote(quote) : null,
    coverage: {
      platform: safeText(coverage.requested_platform, 160),
      market: safeText(coverage.requested_market, 160),
      plannedProducts: safeNonNegativeInteger(coverage.detailed_products_planned),
      reviewStepsPlanned: safeNonNegativeInteger(coverage.review_steps_planned),
      requestedMetrics: safeStringArray(coverage.requested_metrics, 30, 120),
    },
    expiresAt,
  };
}

function readResearchQuote(value: Record<string, unknown>): ResearchPlanReceipt["quote"] {
  const currency = safeText(value.currency, 12);
  const providerCallCount = safeNonNegativeInteger(value.provider_call_count);
  if (!currency || providerCallCount === null || typeof value.priced !== "boolean") return null;
  return {
    currency,
    providerCallCount,
    priced: value.priced,
    billableAmountMicros: value.billable_amount_micros === null
      ? null
      : safeNonNegativeNumber(value.billable_amount_micros),
  };
}

function readResearchEvidenceReceipt(payload: Record<string, unknown>): ResearchEvidenceReceipt | null {
  const researchRequestId = safeText(payload.research_request_id, 160);
  const observedAt = safeText(payload.observed_at, 160);
  if (!researchRequestId || !observedAt) return null;
  const coverage = isRecord(payload.coverage) ? payload.coverage : {};
  const acceptedEvidence = safeNonNegativeInteger(coverage.acceptedEvidence);
  const reviewEvidenceCount = safeNonNegativeInteger(coverage.review_evidence_count) ?? 0;
  return {
    kind: "evidence",
    researchRequestId,
    platform: safeText(coverage.requested_platform, 160),
    observedAt,
    evidenceCount: acceptedEvidence ?? reviewEvidenceCount,
    reviewEvidenceCount,
    coverage: {
      acceptedProducts: safeNonNegativeInteger(coverage.acceptedProducts),
      acceptedEvidence,
      reviewStepsCompleted: safeNonNegativeInteger(coverage.review_steps_completed),
      reviewStepAvailable: typeof coverage.review_step_available === "boolean"
        ? coverage.review_step_available
        : null,
      requestedMetrics: safeStringArray(coverage.requestedMetrics ?? coverage.requested_metrics, 30, 120),
      missingRequestedMetrics: safeStringArray(
        coverage.missingRequestedMetrics ?? coverage.missing_requested_metrics,
        30,
        120,
      ),
    },
    limitations: safeStringArray(payload.limitations, 20, 1_000),
  };
}

function readDynamicToolPayload(item: Record<string, unknown>): Record<string, unknown> | null {
  const result = isRecord(item.result) ? item.result : null;
  const candidates = [
    result?.contentItems,
    result?.content,
    item.contentItems,
    item.content,
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const entry of candidate) {
      if (!isRecord(entry)) continue;
      if (entry.type !== "inputText" && entry.type !== "text") continue;
      if (typeof entry.text !== "string" || entry.text.length > 1_048_576) continue;
      try {
        const parsed = JSON.parse(entry.text) as unknown;
        if (isRecord(parsed)) return parsed;
      } catch {
        // Only exact JSON tool results are eligible for a safe projection.
      }
    }
  }
  return null;
}

function safeText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maximumLength ? normalized : null;
}

function safeNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function safeStringArray(value: unknown, maximumItems: number, maximumLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => safeText(item, maximumLength))
    .filter((item): item is string => Boolean(item))
    .slice(0, maximumItems);
}

function readWebSearchFailure(item: Record<string, unknown>): string | null {
  if (item.status !== "failed") return null;
  const result = isRecord(item.result) ? item.result : null;
  const structured = result && isRecord(result.structuredContent) ? result.structuredContent : null;
  const structuredError = structured && typeof structured.error === "string" ? structured.error.trim() : "";
  if (structuredError) return structuredError.slice(0, 300);
  const content = result && Array.isArray(result.content) ? result.content : [];
  const text = content
    .filter(isRecord)
    .filter((entry) => entry.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text as string)
    .join(" ")
    .trim();
  if (/Provider request timed out/i.test(text)) return "网页搜索服务超时，请缩短查询范围后重试。";
  if (/no source URL/i.test(text)) return "网页搜索服务未返回可核验来源，请更换查询词后重试。";
  return text ? "网页搜索服务暂时不可用。" : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
