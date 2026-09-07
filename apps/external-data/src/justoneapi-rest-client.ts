import { createHash } from "node:crypto";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";

import { config } from "./config.js";
import { type JustOneApiProxyPool, type ProxyLease } from "./justoneapi-proxy-pool.js";
import { getJustOneApiProxyPool } from "./justoneapi-proxy-runtime.js";
import { appendQueryValue } from "./transport-request.js";
import type { JsonObject, ProviderCallResult, ProviderEndpoint, ProviderTransportRequest } from "./types.js";

export class JustOneApiRestClient {
  readonly configured = Boolean(config.justOneApi.token);

  constructor(private readonly proxyPool?: JustOneApiProxyPool) {}

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
    let base: URL;
    let url: URL;
    try {
      base = new URL(config.justOneApi.baseUrl);
      url = new URL(request.apiPath, base);
    } catch {
      throw new JustOneApiRestError("Invalid provider transport URL.", "INVALID_PARAMETER", false);
    }
    if (url.origin !== base.origin || url.username || url.password || url.hash ||
        !request.apiPath.startsWith("/") || request.apiPath.startsWith("//") ||
        !["http:", "https:"].includes(url.protocol) ||
        (config.environment === "production" && url.protocol !== "https:") ||
        Object.keys(request.headers).some((key) => /^(host|authorization|proxy-authorization|cookie|connection|content-length|transfer-encoding|accept-encoding)$/i.test(key))) {
      throw new JustOneApiRestError("Unsafe provider transport target or headers.", "INVALID_PARAMETER", false);
    }
    url.searchParams.set("token", config.justOneApi.token);
    for (const [key, value] of Object.entries(request.query)) appendQueryValue(url.searchParams, key, value);

    let lease: ProxyLease | undefined;
    const deadline = Date.now() + config.justOneApi.timeoutMs;
    try {
      const pool = this.proxyPool ?? await getJustOneApiProxyPool();
      if (pool) {
        if (!pool.allowsTarget(url)) throw new Error("Proxy target mismatch.");
        // Failover is allowed only here, before creation of the paid HTTP request.
        lease = await pool.acquire(deadline);
      }
    } catch {
      throw new JustOneApiRestError("JustOneAPI proxy unavailable; provider request was not sent.", "PROXY_UNAVAILABLE", false);
    }

    const agent = lease ? new HttpsAgent({ keepAlive: false, maxSockets: 1 }) : undefined;
    if (agent && lease) {
      const socket = lease.socket;
      let claimed = false;
      agent.createConnection = () => {
        if (claimed) throw new Error("JustOneAPI proxy tunnel cannot be reused.");
        claimed = true;
        return socket;
      };
    }
    try {
      const response = await new Promise<IncomingMessage>((resolve, reject) => {
        // Node ClientRequest does not redirect or replay GET/POST. No global proxy state is consulted.
        const outgoing = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
          method: request.httpMethod,
          headers: {
            Accept: "application/json",
            "User-Agent": "SHUEHO-External-Data/0.1",
            ...request.headers,
            ...(request.contentType ? { "Content-Type": request.contentType } : {}),
            "Accept-Encoding": "identity",
            Connection: "close",
          },
          agent: agent ?? false,
          signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
          maxHeaderSize: 32_768,
        }, resolve);
        outgoing.once("error", reject);
        outgoing.end(request.bodyText ?? undefined);
      });
      return await readProviderResult(response);
    } catch (error) {
      if (error instanceof JustOneApiRestError) throw error;
      lease?.failed();
      throw new JustOneApiRestError(
        "JustOneAPI request result is uncertain; automatic retry is prohibited.",
        "RESULT_UNKNOWN",
        true,
      );
    } finally {
      agent?.destroy();
      lease?.socket.destroy();
    }
  }
}

async function readProviderResult(response: IncomingMessage): Promise<ProviderCallResult> {
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
    state: response.statusCode! >= 200 && response.statusCode! < 300 && payload !== null && providerCode === 0 ? "succeeded" : "business_failed",
    httpStatus: response.statusCode ?? 502,
    payload,
    rawBody,
    rawBytes: bytes,
    responseSha256: createHash("sha256").update(bytes).digest("hex"),
    contentType: response.headers["content-type"] ?? null,
    responseBytes: bytes.byteLength,
    providerCode,
    providerMessage,
    providerRequestId: payload && typeof payload.requestId === "string" ? payload.requestId.slice(0, 255) : null,
    providerRecordedAt: parseProviderTime(payload?.recordTime),
  };
}

async function readBoundedBody(response: IncomingMessage, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    response.destroy();
    throw new JustOneApiRestError(
      `JustOneAPI response exceeded ${maximumBytes} bytes.`,
      "RESULT_TOO_LARGE",
      true,
    );
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const value of response) {
    length += value.byteLength;
    if (length > maximumBytes) {
      response.destroy();
      throw new JustOneApiRestError(
        `JustOneAPI response exceeded ${maximumBytes} bytes.`,
        "RESULT_TOO_LARGE",
        true,
      );
    }
    chunks.push(value);
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
    readonly code: "NOT_CONFIGURED" | "METHOD_UNSUPPORTED" | "INVALID_PARAMETER" | "RESULT_UNKNOWN" | "RESULT_TOO_LARGE" | "INVALID_RESPONSE" | "PROXY_UNAVAILABLE",
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

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
