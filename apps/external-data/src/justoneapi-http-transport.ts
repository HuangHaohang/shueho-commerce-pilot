import { createHash } from "node:crypto";
import { request as httpRequest, type ClientRequest, type IncomingMessage } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { parseRetryAfter } from "./justoneapi-retry-policy.js";
import { JustOneApiError } from "./justoneapi-errors.js";
import type { JustOneApiProxyPool, ProxyLease } from "./justoneapi-proxy-pool.js";
import type { JustOneApiCredential } from "./justoneapi-credentials.js";
import { appendQueryValue } from "./transport-request.js";
import type { JsonObject, ProviderCallResult, ProviderEndpoint, ProviderTransportRequest } from "./types.js";

export type PreparedJustOneApiRequest = {
  proxyNodeId: string | null;
  send(credential: JustOneApiCredential): Promise<ProviderCallResult>;
  close(): void;
};
export interface JustOneApiTransport {
  prepare(endpoint: ProviderEndpoint, request: ProviderTransportRequest, deadline: number): Promise<PreparedJustOneApiRequest>;
}

/** Internal network adapter. Only JustOneApiClient may send credential-bearing provider requests. */
export class JustOneApiHttpTransport implements JustOneApiTransport {
  constructor(
    private readonly options: { baseUrl: string; maxResponseBytes: number; production: boolean },
    private readonly getProxyPool: () => Promise<JustOneApiProxyPool | null>,
  ) {}

  async prepare(endpoint: ProviderEndpoint, input: ProviderTransportRequest, deadline: number): Promise<PreparedJustOneApiRequest> {
    if (endpoint.httpMethod !== "GET" && endpoint.httpMethod !== "POST") {
      throw new JustOneApiError("Unsupported provider HTTP method.", "METHOD_UNSUPPORTED", false);
    }
    if (input.httpMethod !== endpoint.httpMethod || (input.apiPath !== endpoint.apiPath && !endpoint.apiPath.includes("{"))) {
      throw new JustOneApiError("Provider request does not match its endpoint contract.", "INVALID_PARAMETER", false);
    }
    let base: URL;
    let url: URL;
    try { base = new URL(this.options.baseUrl); url = new URL(input.apiPath, base); }
    catch { throw new JustOneApiError("Invalid provider transport URL.", "INVALID_PARAMETER", false); }
    if (url.origin !== base.origin || url.username || url.password || url.hash ||
        !input.apiPath.startsWith("/") || input.apiPath.startsWith("//") || !["http:", "https:"].includes(url.protocol) ||
        (this.options.production && url.protocol !== "https:") ||
        Object.keys(input.headers).some((key) => /^(host|authorization|proxy-authorization|cookie|connection|content-length|transfer-encoding|accept-encoding)$/i.test(key)) ||
        Object.keys(input.query).some((key) => /^(token|access_token|api_key)$/i.test(key))) {
      throw new JustOneApiError("Unsafe provider transport target or headers.", "INVALID_PARAMETER", false);
    }
    for (const [key, value] of Object.entries(input.query)) appendQueryValue(url.searchParams, key, value);
    let lease: ProxyLease | undefined;
    try {
      const pool = await this.getProxyPool();
      if (pool) {
        if (!pool.allowsTarget(url)) throw new Error();
        lease = await pool.acquire(deadline);
      }
    } catch { throw new JustOneApiError("JustOneAPI proxy unavailable; no provider request was sent.", "PROXY_UNAVAILABLE", false); }
    const agent = lease ? new HttpsAgent({ keepAlive: false, maxSockets: 1 }) : undefined;
    if (agent && lease) {
      const socket = lease.socket;
      let claimed = false;
      agent.createConnection = () => {
        if (claimed) throw new Error("Provider tunnel reuse is prohibited.");
        claimed = true;
        return socket;
      };
    }
    let sent = false;
    let closed = false;
    return {
      proxyNodeId: lease?.nodeId ?? null,
      close() { closed = true; agent?.destroy(); lease?.socket.destroy(); },
      send: async (credential) => {
        if (sent || closed) throw new JustOneApiError("Provider transport is single-use.", "CALL_ALREADY_CLAIMED", true);
        sent = true;
        url.searchParams.set("token", credential.token);
        try {
          return await new Promise<ProviderCallResult>((resolve, reject) => {
            let outgoing: ClientRequest | undefined;
            let response: IncomingMessage | undefined;
            let settled = false;
            const finish = (error?: unknown, result?: ProviderCallResult) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              lease?.socket.off("close", tunnelClosed);
              if (error) {
                outgoing?.destroy();
                response?.destroy();
                lease?.socket.destroy();
                reject(error);
              } else resolve(result!);
            };
            const tunnelClosed = () => {
              if (!response?.complete) finish(new Error("PROVIDER_TUNNEL_CLOSED"));
            };
            // A preconnected proxy socket may close before ClientRequest attaches
            // its listeners. Bound the promise itself, including body consumption.
            const timer = setTimeout(() => finish(new Error("PROVIDER_DEADLINE_EXCEEDED")), Math.max(1, deadline - Date.now()));
            lease?.socket.once("close", tunnelClosed);
            if (lease?.socket.destroyed) { finish(new Error("PROVIDER_TUNNEL_CLOSED")); return; }
            try {
              outgoing = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
              method: input.httpMethod,
              headers: {
                Accept: "application/json", "User-Agent": "SHUEHO-External-Data/0.1", ...input.headers,
                ...(input.contentType ? { "Content-Type": input.contentType } : {}),
                "Accept-Encoding": "identity", Connection: "close",
              },
              agent: agent ?? false,
              signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())), maxHeaderSize: 32768,
            }, (incoming) => {
              if (settled) { incoming.destroy(); return; }
              response = incoming;
              void readProviderResult(incoming, this.options.maxResponseBytes).then(
                (result) => finish(undefined, result), finish,
              );
            });
              outgoing.once("error", finish);
              outgoing.end(input.bodyText ?? undefined);
            } catch (error) { finish(error); }
          });
        } catch (error) {
          if (error instanceof JustOneApiError) throw error;
          lease?.failed();
          const reason = error instanceof Error && ["PROVIDER_DEADLINE_EXCEEDED", "PROVIDER_TUNNEL_CLOSED"].includes(error.message)
            ? error.message
            : error && typeof error === "object" && "code" in error && ["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "ABORT_ERR"].includes(String(error.code))
              ? String(error.code) : "TRANSPORT_INTERRUPTED";
          throw new JustOneApiError(`Provider transport result is uncertain (${reason}); replay is prohibited.`, "RESULT_UNKNOWN", true);
        }
      },
    };
  }
}

async function readProviderResult(response: IncomingMessage, maximumBytes: number): Promise<ProviderCallResult> {
  const bytes = await readBoundedBody(response, maximumBytes);
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
    retryAfterMs: parseRetryAfter(response.headers["retry-after"]),
    providerMessage,
    providerRequestId: payload && typeof payload.requestId === "string" ? payload.requestId.slice(0, 255) : null,
    providerRecordedAt: parseProviderTime(payload?.recordTime),
  };
}

async function readBoundedBody(response: IncomingMessage, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    response.destroy();
    throw new JustOneApiError(
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
      throw new JustOneApiError(
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

function parseProviderTime(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time.toISOString();
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
