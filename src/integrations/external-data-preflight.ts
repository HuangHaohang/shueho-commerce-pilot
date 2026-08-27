import type { ExternalDataServiceMcpClient } from "./external-data-service-mcp-client.js";

export type ExternalDataPreflight = {
  endpointId: string;
  platform: string;
  normalizedParams: Record<string, unknown>;
  requestSha256: string | null;
};

export class ExternalDataPreflightError extends Error {
  readonly code = "EXTERNAL_DATA_PREFLIGHT_FAILED";
  readonly providerDispatched = false;

  constructor(message: string) {
    super(message);
    this.name = "ExternalDataPreflightError";
  }
}

export async function preflightExternalDataCall(
  service: Pick<ExternalDataServiceMcpClient, "preflightEndpoint">,
  endpointId: string,
  params: Record<string, unknown>,
): Promise<ExternalDataPreflight> {
  const result = await service.preflightEndpoint({ endpoint_id: endpointId, params });
  const payload = result.payload;
  if (payload.success !== true || !isRecord(payload.normalized_params)) {
    throw new ExternalDataPreflightError(
      typeof payload.message === "string" ? payload.message : "外部数据接口参数未通过官方 OpenAPI 校验。",
    );
  }
  if (payload.endpoint_id !== endpointId) throw new ExternalDataPreflightError("外部数据预检返回了不同的接口标识。");
  return {
    endpointId,
    platform: typeof payload.platform === "string" ? payload.platform : endpointId.split(".")[0] ?? "",
    normalizedParams: payload.normalized_params,
    requestSha256: typeof payload.request_sha256 === "string" ? payload.request_sha256 : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
