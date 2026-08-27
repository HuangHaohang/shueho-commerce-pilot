import { createHash } from "node:crypto";

import { config } from "./config.js";
import { appendQueryValue } from "./transport-request.js";
import type { JsonObject, ProviderCallResult, ProviderEndpoint, ProviderTransportRequest } from "./types.js";

export class JustOneApiRestClient {
  readonly configured = Boolean(config.justOneApi.token);

  async call(endpoint: ProviderEndpoint, request: ProviderTransportRequest): Promise<ProviderCallResult> {
    if (!config.justOneApi.token) {
      throw new JustOneApiRestError("JUSTONEAPI_API_TOKEN is not configured.", "NOT_CONFIGURED", false);
    }
    if (endpoint.httpMethod !== "GET" && endpoint.httpMethod !== "POST") {
      throw new JustOneApiRestError(`HTTP method ${endpoint.httpMethod} is not implemented.`, "METHOD_UNSUPPORTED", false);
    }
    if (request.httpMethod !== endpoint.httpMethod || request.apiPath !== endpoint.apiPath && !endpoint.apiPath.includes("{")) {
      throw new JustOneApiRestError("Prepared provider request does not match the endpoint contract.", "INVALID_PARAMETER", false);
    }
    const url = new URL(request.apiPath, config.justOneApi.baseUrl);
    url.searchParams.set("token", config.justOneApi.token);
    for (const [key, value] of Object.entries(request.query)) appendQueryValue(url.searchParams, key, value);

    let response: Response;
    try {
      response = await fetch(url, {
        method: request.httpMethod,
        headers: {
          Accept: "application/json",
          "User-Agent": "SHUEHO-External-Data/0.1",
          ...request.headers,
          ...(request.contentType ? { "Content-Type": request.contentType } : {}),
        },
        ...(request.bodyText === null ? {} : { body: request.bodyText }),
        signal: AbortSignal.timeout(config.justOneApi.timeoutMs),
      });
    } catch (error) {
      throw new JustOneApiRestError(
        `JustOneAPI request result is uncertain: ${safeError(error)}`,
        "RESULT_UNKNOWN",
        true,
      );
    }

    const bytes = await readBoundedBody(response, config.justOneApi.maxResponseBytes);
    const rawBody = new TextDecoder().decode(bytes);
    let payload: JsonObject | null = null;
    let parseMessage: string | null = null;
    try {
      const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
      if (isRecord(parsed)) payload = parsed;
      else parseMessage = "JustOneAPI returned a non-object JSON response.";
    } catch {
      parseMessage = "JustOneAPI returned a non-JSON response.";
    }
    const providerCode = payload && typeof payload.code === "number" ? payload.code : null;
    const providerMessage = payload && typeof payload.message === "string"
      ? payload.message.slice(0, 500)
      : parseMessage;
    return {
      state: response.ok && payload !== null && providerCode === 0 ? "succeeded" : "business_failed",
      httpStatus: response.status,
      payload,
      rawBody,
      rawBytes: bytes,
      responseSha256: createHash("sha256").update(bytes).digest("hex"),
      contentType: response.headers.get("content-type"),
      responseBytes: bytes.byteLength,
      providerCode,
      providerMessage,
      providerRequestId: payload && typeof payload.requestId === "string" ? payload.requestId.slice(0, 255) : null,
      providerRecordedAt: parseProviderTime(payload?.recordTime),
    };
  }
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel();
    throw new JustOneApiRestError(
      `JustOneAPI response exceeded ${maximumBytes} bytes.`,
      "RESULT_TOO_LARGE",
      true,
    );
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw new JustOneApiRestError(
          `JustOneAPI response exceeded ${maximumBytes} bytes.`,
          "RESULT_TOO_LARGE",
          true,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export class JustOneApiRestError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_CONFIGURED" | "METHOD_UNSUPPORTED" | "INVALID_PARAMETER" | "RESULT_UNKNOWN" | "RESULT_TOO_LARGE" | "INVALID_RESPONSE",
    readonly uncertain: boolean,
  ) {
    super(message);
    this.name = "JustOneApiRestError";
  }
}

function parseProviderTime(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time.toISOString();
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown error";
  return message
    .replace(/([?&]token=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .slice(0, 500);
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
