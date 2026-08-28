import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { GatewayConfig } from "../gateway/config.js";

const ACTOR_AUTHORIZATION_HEADER = "x-openai-actor-authorization";
const PROXY_PATH_PREFIX = "/api/internal/provider/v1";
const MAX_PROVIDER_REQUEST_BYTES = 64 * 1024 * 1024;
const processActorSeed = randomBytes(32);

type RuntimeProviderProxyIdentity = {
  actorAuthorization: string;
  baseUrl: string;
};

type ProviderRoute = {
  method: "GET" | "POST";
  suffix: string;
};

const allowedRoutes: ProviderRoute[] = [
  { method: "GET", suffix: "/models" },
  { method: "POST", suffix: "/responses" },
  { method: "POST", suffix: "/responses/compact" },
  { method: "POST", suffix: "/images/generations" },
  { method: "POST", suffix: "/images/edits" },
];

export function createRuntimeProviderProxyIdentity(config: GatewayConfig): RuntimeProviderProxyIdentity {
  const signingKey = config.internalToken || config.provider.apiKey || processActorSeed;
  const actorAuthorization = `CommercePilot ${createHmac("sha256", signingKey)
    .update("codex-runtime-provider\0")
    .update(config.runtimeTenantId ?? "local")
    .update("\0")
    .update(config.provider.id)
    .update("\0")
    .update(config.provider.baseUrl)
    .digest("base64url")}`;
  return {
    actorAuthorization,
    baseUrl: `http://127.0.0.1:${config.port}${PROXY_PATH_PREFIX}`,
  };
}

export class RuntimeProviderProxy {
  readonly identity: RuntimeProviderProxyIdentity;

  constructor(private readonly config: GatewayConfig) {
    this.identity = createRuntimeProviderProxyIdentity(config);
  }

  matches(pathname: string): boolean {
    return pathname === PROXY_PATH_PREFIX || pathname.startsWith(`${PROXY_PATH_PREFIX}/`);
  }

  async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    if (!this.isAuthorized(request)) {
      sendJson(response, 401, { error: "Invalid runtime provider actor authorization." });
      return;
    }
    if (!this.config.provider.apiKey) {
      sendJson(response, 503, { error: `${this.config.provider.apiKeyEnvName} is not configured.` });
      return;
    }

    const suffix = url.pathname.slice(PROXY_PATH_PREFIX.length) || "/";
    const method = request.method === "GET" || request.method === "POST" ? request.method : null;
    if (!method || !allowedRoutes.some((route) => route.method === method && route.suffix === suffix)) {
      sendJson(response, 404, { error: "Unsupported runtime provider route." });
      return;
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    request.once("aborted", abort);
    response.once("close", abort);
    try {
      const body = method === "POST" ? await readBoundedBody(request, MAX_PROVIDER_REQUEST_BYTES) : undefined;
      const upstreamUrl = new URL(`${this.config.provider.baseUrl}${suffix}`);
      upstreamUrl.search = url.search;
      const upstream = await fetch(upstreamUrl, {
        method,
        headers: buildUpstreamHeaders(request, this.config.provider.apiKey),
        body,
        signal: controller.signal,
      });
      response.statusCode = upstream.status;
      copyResponseHeaders(upstream.headers, response);
      if (!upstream.body) {
        response.end();
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const stream = Readable.fromWeb(upstream.body as ReadableStream<Uint8Array>);
        stream.once("error", reject);
        response.once("error", reject);
        response.once("finish", resolve);
        stream.pipe(response);
      });
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      const statusCode = error instanceof RuntimeProviderProxyError
        ? error.statusCode
        : controller.signal.aborted
          ? 499
          : 502;
      sendJson(response, statusCode, {
        error:
          error instanceof RuntimeProviderProxyError
            ? error.message
            : controller.signal.aborted
              ? "Runtime provider request was cancelled."
              : "Runtime provider is unavailable.",
      });
    } finally {
      request.off("aborted", abort);
      response.off("close", abort);
    }
  }

  private isAuthorized(request: IncomingMessage): boolean {
    const provided = request.headers[ACTOR_AUTHORIZATION_HEADER];
    if (typeof provided !== "string") return false;
    const expectedBuffer = Buffer.from(this.identity.actorAuthorization);
    const providedBuffer = Buffer.from(provided);
    return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
  }
}

function buildUpstreamHeaders(request: IncomingMessage, apiKey: string): Headers {
  const headers = new Headers({
    accept: typeof request.headers.accept === "string" ? request.headers.accept : "application/json",
    authorization: `Bearer ${apiKey}`,
  });
  for (const [name, value] of Object.entries(request.headers)) {
    if (
      name === ACTOR_AUTHORIZATION_HEADER ||
      !(
        name === "content-type" ||
        name === "content-encoding" ||
        name === "user-agent" ||
        name === "originator" ||
        name === "x-client-request-id" ||
        name.startsWith("x-codex-") ||
        name.startsWith("x-oai-") ||
        name.startsWith("openai-")
      )
    ) {
      continue;
    }
    if (typeof value === "string" && value) headers.set(name, value);
  }
  return headers;
}

function copyResponseHeaders(headers: Headers, response: ServerResponse): void {
  for (const [name, value] of headers) {
    const normalized = name.toLowerCase();
    if (
      normalized === "content-type" ||
      normalized === "cache-control" ||
      normalized === "retry-after" ||
      normalized === "x-request-id" ||
      normalized === "x-cpa-trace-id" ||
      normalized.startsWith("x-codex-") ||
      normalized.startsWith("x-oai-") ||
      normalized.startsWith("x-ratelimit-") ||
      normalized.startsWith("x-openai-") ||
      normalized.startsWith("openai-")
    ) {
      response.setHeader(name, value);
    }
  }
}

async function readBoundedBody(request: IncomingMessage, maximumBytes: number): Promise<Buffer> {
  const contentLength = Number.parseInt(request.headers["content-length"] ?? "0", 10);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new RuntimeProviderProxyError("Runtime provider request is too large.", 413);
  }
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.length;
    if (totalBytes > maximumBytes) {
      throw new RuntimeProviderProxyError("Runtime provider request is too large.", 413);
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, totalBytes);
}

export class RuntimeProviderProxyError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "RuntimeProviderProxyError";
  }
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  if (response.headersSent) return;
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

export const runtimeProviderActorAuthorizationHeader = ACTOR_AUTHORIZATION_HEADER;
