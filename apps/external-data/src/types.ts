export type JsonObject = Record<string, unknown>;

export type ExternalDataScope = {
  tenantId: string;
  workspaceId: string;
  userId: string;
  source: "codex_harness" | "external_mcp" | "archive_import";
  sourceCallId: string;
  rootThreadId?: string | null;
  threadId?: string | null;
  turnId?: string | null;
  requestText: string;
  topN?: number;
  businessIntent?: ExternalDataBusinessIntent | null;
  workflowExecutionId?: string | null;
  workflowStepId?: string | null;
  enrichmentQueryTerms?: string[];
};

export type ExternalDataBusinessIntent = {
  kind: string;
  platform: string;
  targetProduct: string | null;
  objective: string | null;
  requestedMetrics: string[];
  timeRange: {
    start: string;
    end: string;
    startDate: string;
    endDate: string;
    timezone: string;
  } | null;
  windowEnforcement: string | null;
  requestedTopN: number | null;
  workflowId?: string | null;
  workflowVersion?: string | null;
  workflowPlanKey?: string | null;
  workflowStepId?: string | null;
  workflowStepRole?: "discovery" | "detail" | "price" | "reviews" | "sku" | null;
  localizedKeyword?: string | null;
};

export type ProviderEndpoint = {
  endpointId: string;
  platformId: string;
  platformName: string;
  displayName: string;
  capability: string;
  apiPath: string;
  httpMethod: "GET" | "POST";
  schemaVersion: string;
  requestSchema: JsonObject;
  responseSchema: JsonObject;
  requestCodec: JsonObject;
  paginationStrategy: JsonObject;
  responseFamily: string;
  normalizerVersion: string;
  catalogStatus: "active" | "deprecated" | "removed" | "missing_openapi" | "legacy";
  pricingStatus: "priced" | "unavailable" | "missing";
  permissionStatus: "allowed" | "unavailable";
  enabled: boolean;
  documentationUrl: string | null;
  openapiUrl: string | null;
};

export type ProviderTransportRequest = {
  apiPath: string;
  httpMethod: "GET" | "POST";
  query: JsonObject;
  headers: Record<string, string>;
  body: JsonObject | null;
  bodyText: string | null;
  contentType: string | null;
  requestArtifact: JsonObject;
  requestSha256: string;
  requestBytes: number;
};

export type ResearchIntent = {
  platform: string;
  targetProduct: string | null;
  metrics: string[];
  expectedCategories: string[];
  excludedCategories: string[];
  currency: string | null;
  requestedTopN: number;
  originalRequest: string;
  objective?: string | null;
  timeRange?: ExternalDataBusinessIntent["timeRange"];
  windowEnforcement?: string | null;
  localizedKeyword?: string | null;
};

export type QueryIdentity = {
  intent: ResearchIntent;
  intentKey: string;
  queryKey: string;
  pageKey: string;
  canonicalQueryParams: JsonObject;
  paginationParams: JsonObject;
};

export type ProviderCallResult = {
  state: "succeeded" | "business_failed";
  httpStatus: number;
  payload: JsonObject | null;
  rawBody: string;
  rawBytes: Uint8Array;
  responseSha256: string;
  contentType: string | null;
  responseBytes: number;
  providerCode: number | null;
  providerMessage: string | null;
  providerRequestId: string | null;
  providerRecordedAt: string | null;
};

export type QualityDecision = {
  status: "valid" | "suspicious" | "rejected";
  reasons: string[];
  normalizedValue: string | null;
};

export type EnrichmentCandidate = {
  entityType: "taobao_item" | "taobao_brand" | "taobao_property_value" | "social_item" | "generic_record";
  entityId: string;
  sourceJsonPointer: string;
  content: string;
  quality: QualityDecision;
  supportsPrice: boolean;
  supportsSales: boolean;
  metadata: JsonObject;
};

export type EnrichmentDecision = EnrichmentCandidate & {
  lexicalScore: number;
  embeddingScore: number | null;
  rerankScore: number | null;
  relevanceScore: number;
  confidence: number;
  entityMatch: "exact" | "adjacent" | "irrelevant" | "unknown";
  reasonCodes: string[];
  decision: "promote" | "hold" | "reject";
};

export type CompactResearchResult = {
  success: boolean;
  provider_completed: boolean;
  processing_state: string;
  code: number;
  message: string;
  research_request_id: string;
  raw_archive_id: string;
  endpoint_id: string;
  query_key: string;
  observed_at: string;
  coverage: JsonObject;
  metrics: JsonObject;
  products: JsonObject[];
  brands: JsonObject[];
  properties: JsonObject[];
  evidence: JsonObject[];
  exclusions: JsonObject;
  limitations: string[];
};
