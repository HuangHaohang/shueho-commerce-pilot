import { createHash } from "node:crypto";

import { config } from "./config.js";
import { sha256Json } from "./canonical.js";
import { getEndpoint, validateEndpointParams } from "./endpoint-registry.js";
import { buildEnrichmentQueryText, enrichCandidates } from "./enrichment.js";
import { JustOneApiRestClient, JustOneApiRestError } from "./justoneapi-rest-client.js";
import { LocalModelClient } from "./local-model-client.js";
import { buildProviderTransportRequest } from "./transport-request.js";
import { unwrapProviderPayload } from "./normalizers.js";
import { drainIndexOutbox } from "./search-index.js";
import type { CompactResearchResult, ExternalDataScope, JsonObject, ProviderCallResult } from "./types.js";
import {
  completeRawWarehouseCall,
  createEnrichmentJob,
  failEnrichmentJob,
  loadNormalizedWarehouseCandidates,
  loadCompactResearchResult,
  markWarehouseCallBusinessFailed,
  markResearchEnrichingForReprocess,
  markResearchProcessingFailed,
  markWarehouseCallUnknown,
  persistEnrichmentDecisions,
  persistNormalizedWarehouseData,
  prepareWarehouseCall,
  readWarehouseProcessingState,
  type PersistedNormalization,
} from "./warehouse.js";

export class ExternalDataPipeline {
  constructor(
    private readonly provider = new JustOneApiRestClient(),
    private readonly models = new LocalModelClient(),
  ) {}

  get providerConfigured(): boolean {
    return this.provider.configured;
  }

  async preflight(endpointId: string, params: JsonObject): Promise<JsonObject> {
    const endpoint = await getEndpoint(endpointId);
    const normalizedParams = validateEndpointParams(endpoint, params);
    const request = buildProviderTransportRequest(endpoint, normalizedParams);
    return {
      success: true,
      endpoint_id: endpoint.endpointId,
      platform: endpoint.platformId,
      schema_version: endpoint.schemaVersion,
      normalized_params: normalizedParams,
      parameter_keys: Object.keys(normalizedParams).sort(),
      request_sha256: request.requestSha256,
      request_method: request.httpMethod,
      request_path: request.apiPath,
      request_content_type: request.contentType,
      preflight_key: sha256Json({ endpointId: endpoint.endpointId, schemaVersion: endpoint.schemaVersion, normalizedParams }),
    };
  }

  async execute(scope: ExternalDataScope, endpointId: string, params: JsonObject): Promise<CompactResearchResult> {
    await this.models.health();
    const prepared = await prepareWarehouseCall(scope, endpointId, params);
    if (prepared.reused) return this.resumeProcessingOrLoad(scope, prepared);
    let providerResult: ProviderCallResult;
    try {
      providerResult = await this.provider.call(prepared.endpoint, prepared.transportRequest);
    } catch (error) {
      if (error instanceof JustOneApiRestError && !error.uncertain) {
        await markWarehouseCallBusinessFailed(scope, prepared, safeMessage(error));
        return loadCompactResearchResult(scope, prepared.researchRequestId);
      } else {
        await markWarehouseCallUnknown(scope, prepared, safeMessage(error));
      }
      throw error;
    }
    await completeRawWarehouseCall(scope, prepared, providerResult);
    if (providerResult.state !== "succeeded" || !providerResult.payload) {
      return loadCompactResearchResult(scope, prepared.researchRequestId);
    }
    return this.normalizeEnrichAndLoad(scope, prepared, providerResult.payload, providerResult.providerRecordedAt);
  }

  async resumeStored(scope: ExternalDataScope, endpointId: string, params: JsonObject): Promise<CompactResearchResult> {
    await this.models.health();
    const prepared = await prepareWarehouseCall(scope, endpointId, params);
    if (!prepared.reused) {
      throw new Error("Stored-result recovery requires an existing source_call_id and will never dispatch a provider request.");
    }
    return this.resumeProcessingOrLoad(scope, prepared);
  }

  async reprocessEnrichment(scope: ExternalDataScope, endpointId: string, params: JsonObject): Promise<CompactResearchResult> {
    await this.models.health();
    const prepared = await prepareWarehouseCall(scope, endpointId, params);
    if (!prepared.reused) {
      throw new Error("Enrichment recovery requires an existing source_call_id and will never dispatch a provider request.");
    }
    const state = await readWarehouseProcessingState(scope, prepared.researchRequestId);
    if (state.rawState !== "succeeded" || !state.responsePayload) {
      throw new Error("Enrichment recovery requires a confirmed stored provider response.");
    }
    await markResearchEnrichingForReprocess(scope, prepared.researchRequestId);
    const normalized = await loadNormalizedWarehouseCandidates(scope, prepared);
    return this.enrichPersistAndLoad(scope, prepared, normalized);
  }

  async ingestArchived(
    scope: ExternalDataScope,
    endpointId: string,
    params: JsonObject,
    payload: JsonObject,
    metadata: { providerRequestId?: string | null; providerRecordedAt?: string | null } = {},
  ): Promise<CompactResearchResult> {
    const prepared = await prepareWarehouseCall(scope, endpointId, params);
    if (prepared.reused) return this.resumeProcessingOrLoad(scope, prepared);
    const rawBody = JSON.stringify(payload);
    const providerPayload = unwrapProviderPayload(payload);
    const providerCode = typeof providerPayload.code === "number" ? providerPayload.code : null;
    const providerResult: ProviderCallResult = {
      state: providerCode === 0 ? "succeeded" : "business_failed",
      httpStatus: 200,
      payload,
      rawBody,
      rawBytes: Buffer.from(rawBody, "utf8"),
      responseSha256: createHash("sha256").update(rawBody, "utf8").digest("hex"),
      contentType: "application/json; legacy-commerce-archive=true",
      responseBytes: Buffer.byteLength(rawBody, "utf8"),
      providerCode,
      providerMessage: typeof providerPayload.message === "string" ? providerPayload.message : null,
      providerRequestId: metadata.providerRequestId ?? (typeof providerPayload.requestId === "string" ? providerPayload.requestId : null),
      providerRecordedAt: metadata.providerRecordedAt ?? (typeof providerPayload.recordTime === "string" ? parseTime(providerPayload.recordTime) : null),
    };
    await completeRawWarehouseCall(scope, prepared, providerResult);
    if (providerResult.state !== "succeeded" || !providerResult.payload) return loadCompactResearchResult(scope, prepared.researchRequestId);
    return this.normalizeEnrichAndLoad(scope, prepared, payload, providerResult.providerRecordedAt);
  }

  private async normalizeEnrichAndLoad(
    scope: ExternalDataScope,
    prepared: Awaited<ReturnType<typeof prepareWarehouseCall>>,
    payload: JsonObject,
    providerRecordedAt: string | null,
  ): Promise<CompactResearchResult> {
    let normalized: Awaited<ReturnType<typeof persistNormalizedWarehouseData>>;
    try {
      normalized = await persistNormalizedWarehouseData(scope, prepared, payload, providerRecordedAt);
    } catch (error) {
      await markResearchProcessingFailed(scope, prepared.researchRequestId, "normalization", error);
      return loadCompactResearchResult(scope, prepared.researchRequestId);
    }
    return this.enrichPersistAndLoad(scope, prepared, normalized);
  }

  private async enrichPersistAndLoad(
    scope: ExternalDataScope,
    prepared: Awaited<ReturnType<typeof prepareWarehouseCall>>,
    normalized: PersistedNormalization,
  ): Promise<CompactResearchResult> {
    const enrichmentQueryText = buildEnrichmentQueryText(
      scope.requestText,
      prepared.identity.intent,
      scope.enrichmentQueryTerms,
    );
    let jobId: string;
    try {
      jobId = await createEnrichmentJob(scope, prepared, normalized.candidates, {
        embeddingModel: config.localModels.embeddingVersion,
        embeddingDimensions: config.localModels.embeddingDimensions,
        rerankerModel: config.localModels.rerankerVersion,
      }, enrichmentQueryText);
    } catch (error) {
      await markResearchProcessingFailed(scope, prepared.researchRequestId, "enrichment", error);
      return loadCompactResearchResult(scope, prepared.researchRequestId);
    }
    try {
      const enriched = await enrichCandidates({
        requestText: scope.requestText,
        intent: prepared.identity.intent,
        candidates: normalized.candidates,
        models: this.models,
        additionalQueryTerms: scope.enrichmentQueryTerms,
      });
      await persistEnrichmentDecisions(scope, prepared, jobId, enriched.decisions, enriched.embeddings, {
        embeddingModel: config.localModels.embeddingVersion,
        rerankerModel: config.localModels.rerankerVersion,
      });
    } catch (error) {
      await failEnrichmentJob(scope, prepared.researchRequestId, jobId, error);
      return loadCompactResearchResult(scope, prepared.researchRequestId);
    }
    await drainIndexOutbox(100).catch(() => undefined);
    return loadCompactResearchResult(scope, prepared.researchRequestId);
  }

  private async resumeProcessingOrLoad(
    scope: ExternalDataScope,
    prepared: Awaited<ReturnType<typeof prepareWarehouseCall>>,
  ): Promise<CompactResearchResult> {
    const state = await readWarehouseProcessingState(scope, prepared.researchRequestId);
    if (state.rawState !== "succeeded" || !state.responsePayload) {
      return loadCompactResearchResult(scope, prepared.researchRequestId);
    }
    if (state.requestStatus === "normalizing" || (state.requestStatus === "failed" && state.failureStage === "normalization")) {
      return this.normalizeEnrichAndLoad(scope, prepared, state.responsePayload, state.providerRecordedAt);
    }
    if (state.requestStatus === "enriching" || (state.requestStatus === "failed" && state.failureStage === "enrichment")) {
      try {
        const normalized = await loadNormalizedWarehouseCandidates(scope, prepared);
        return this.enrichPersistAndLoad(scope, prepared, normalized);
      } catch (error) {
        await markResearchProcessingFailed(scope, prepared.researchRequestId, "enrichment", error);
      }
    }
    return loadCompactResearchResult(scope, prepared.researchRequestId);
  }
}

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function parseTime(value: string): string | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
