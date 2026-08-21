import "dotenv/config";

import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, extname, join } from "node:path";

import { CodexAppServerClient } from "../codex/app-server-client.js";
import type { AppServerEvent, ThreadStartInput, TurnStartInput } from "../codex/protocol.js";
import { ensureAppOwnedCodexConfig } from "../codex/runtime-config.js";
import { CommerceProviderClient, CommerceProviderError, type ImageGenerationInput } from "../provider/commerce-provider-client.js";
import { readGatewayConfig } from "./config.js";

const config = readGatewayConfig();
await ensureAppOwnedCodexConfig(config);
const gatewayInstanceId = randomUUID();

const provider = new CommerceProviderClient(config.provider);
const codexEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  CODEX_HOME: config.codexHome,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || config.provider.baseUrl,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || config.provider.apiKey,
};
const codex = new CodexAppServerClient({
  codexBin: config.codexBin,
  cwd: config.runtimeRoot,
  env: codexEnvironment,
});

const sseClients = new Map<ServerResponse, { threadId?: string }>();
const turnTimeouts = new Map<string, NodeJS.Timeout>();
const loadedThreadIds = new Set<string>();
const browserEventMethods = new Set([
  "turn/started",
  "turn/completed",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "commerce/imageGeneration/started",
  "commerce/imageGeneration/completed",
  "error",
]);

codex.on("event", (event: AppServerEvent) => {
  if (event.type === "process" && event.event === "exit") {
    loadedThreadIds.clear();
  }
  broadcastEvent(event);
  if (event.type === "notification" && event.method === "turn/completed") {
    const turnId = readEventTurnId(event.params);
    if (turnId) {
      clearTurnTimeout(turnId);
    }
  }
  if (event.type !== "server_request") {
    return;
  }
  if (event.method === "item/tool/call") {
    void handleCommerceHostToolRequest(event).catch((error) => {
      codex.rejectServerRequest(event.id, {
        code: -32603,
        message: error instanceof Error ? error.message : "Commerce host tool failed.",
      });
    });
    return;
  }
  codex.rejectServerRequest(event.id, {
    code: -32601,
    message: `Server request ${event.method} is not allowed by the Commerce Pilot runtime policy.`,
  });
});

const server = createServer(async (req, res) => {
  try {
    if (!req.url) {
      sendJson(res, 400, { error: "Missing URL." });
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    if (!isAuthorizedGatewayRequest(req)) {
      sendJson(res, 401, { error: "Unauthorized Gateway request." });
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        gateway: "shueho-commerce-pilot",
        instanceId: gatewayInstanceId,
        codex: {
          running: codex.isRunning,
          initialized: codex.isInitialized,
          pendingServerRequests: codex.listPendingServerRequests().length,
        },
        provider: {
          id: config.provider.id,
          configured: Boolean(config.provider.apiKey),
          imageModel: config.provider.imageModel,
          wireApi: "responses",
        },
        runtimePolicy: {
          tools: "application-registered-only",
          shell: false,
          hostFilesystem: false,
          processNetwork: false,
          hostedWebSearch: true,
          multiAgent: true,
          localPathImageReader: false,
          hooks: process.env.NODE_ENV === "production" ? "managed-only" : "app-owned-development",
          maxTurnDurationMs: config.maxTurnDurationMs,
        },
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/models") {
      const result = await provider.listModels(url.searchParams.get("refresh") === "true");
      sendJson(res, 200, result);
      return;
    }

    const generatedImageMatch = matchPath(url.pathname, /^\/api\/generated-images\/([^/]+)$/);
    if (req.method === "GET" && generatedImageMatch) {
      const filename = decodeURIComponent(generatedImageMatch[1] ?? "");
      if (!isSafeGeneratedImageFilename(filename)) {
        sendJson(res, 400, { error: "Invalid generated image filename." });
        return;
      }
      const image = await readFile(join(config.codexHome, "generated_images", filename));
      res.writeHead(200, {
        "Content-Type": imageContentType(filename),
        "Content-Length": image.byteLength,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(image);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/images/generations") {
      const body = await readJsonBody<ImageGenerationInput>(req);
      const validated = validateImageGenerationInput(body, config.provider.imageModel);
      const result = await provider.generateImage(validated);
      sendJson(res, 200, { result });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/codex/events") {
      openSse(res, url.searchParams.get("threadId") || undefined);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/threads") {
      const body = await readJsonBody<ThreadStartInput>(req);
      const model = body.model ?? config.defaultModel;
      const modelProvider = config.defaultModelProvider;
      if (modelProvider === config.provider.id && model) {
        await provider.assertAgentModel(model);
      }
      const result = await codex.request("thread/start", {
        serviceName: "shueho-commerce-agent",
        model,
        modelProvider,
        cwd: config.runtimeRoot,
        approvalPolicy: "never",
        sandbox: "read-only",
        config: process.env.NODE_ENV === "production" ? undefined : { bypass_hook_trust: true },
        developerInstructions: createRuntimeDeveloperInstructions(),
        ephemeral: false,
        dynamicTools: createCommerceDynamicToolSpecs(),
      });
      const startedThreadId = readResultThreadId(result);
      if (startedThreadId) {
        loadedThreadIds.add(startedThreadId);
      }
      sendJson(res, 200, { result });
      return;
    }

    const threadReadMatch = matchPath(url.pathname, /^\/api\/threads\/([^/]+)$/);
    if (req.method === "GET" && threadReadMatch) {
      const threadId = decodeURIComponent(threadReadMatch[1] ?? "");
      if (!isSafeAgentId(threadId)) {
        sendJson(res, 400, { error: "Invalid thread id." });
        return;
      }
      const result = await codex.request("thread/read", { threadId, includeTurns: true });
      sendJson(res, 200, { result });
      return;
    }

    const turnMatch = matchPath(url.pathname, /^\/api\/threads\/([^/]+)\/turns$/);
    if (req.method === "POST" && turnMatch) {
      const body = await readJsonBody<Omit<TurnStartInput, "threadId">>(req);
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message || message.length > 50_000) {
        sendJson(res, 400, { error: "Expected a message between 1 and 50000 characters." });
        return;
      }
      const threadId = decodeURIComponent(turnMatch[1] ?? "");
      if (!isSafeAgentId(threadId)) {
        sendJson(res, 400, { error: "Invalid thread id." });
        return;
      }
      if (body.model) {
        await provider.assertAgentModel(body.model);
      }
      await ensureThreadLoaded(threadId, body.model);

      const result = await codex.request("turn/start", {
        threadId,
        input: [{ type: "text", text: message, text_elements: [] }],
        model: body.model,
        effort: body.effort,
      });
      const startedTurnId = readResultTurnId(result);
      if (startedTurnId) {
        scheduleTurnTimeout(threadId, startedTurnId);
      }
      sendJson(res, 200, { result });
      return;
    }

    const interruptMatch = matchPath(url.pathname, /^\/api\/threads\/([^/]+)\/turns\/([^/]+)\/interrupt$/);
    if (req.method === "POST" && interruptMatch) {
      const result = await codex.request("turn/interrupt", {
        threadId: decodeURIComponent(interruptMatch[1] ?? ""),
        turnId: decodeURIComponent(interruptMatch[2] ?? ""),
      });
      sendJson(res, 200, { result });
      return;
    }

    sendJson(res, 404, {
      error: "Not found.",
      routes: [
        "GET /health",
        "GET /api/models",
        "GET /api/generated-images/:filename",
        "POST /api/images/generations",
        "GET /api/codex/events",
        "POST /api/threads",
        "GET /api/threads/:threadId",
        "POST /api/threads/:threadId/turns",
        "POST /api/threads/:threadId/turns/:turnId/interrupt",
      ],
    });
  } catch (error) {
    const serialized = serializeError(error);
    const statusCode = error instanceof CommerceProviderError ? error.statusCode : 500;
    sendJson(res, statusCode, serialized);
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Commerce Agent Gateway listening on http://${config.host}:${config.port}`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function shutdown(): Promise<void> {
  for (const timeout of turnTimeouts.values()) {
    clearTimeout(timeout);
  }
  turnTimeouts.clear();
  for (const client of sseClients.keys()) {
    client.end();
  }
  sseClients.clear();
  await codex.stop();
  server.close(() => {
    process.exit(0);
  });
}

function scheduleTurnTimeout(threadId: string, turnId: string): void {
  clearTurnTimeout(turnId);
  const timeout = setTimeout(() => {
    turnTimeouts.delete(turnId);
    void codex.request("turn/interrupt", { threadId, turnId }, 10_000).catch(() => undefined);
  }, config.maxTurnDurationMs);
  timeout.unref();
  turnTimeouts.set(turnId, timeout);
}

function clearTurnTimeout(turnId: string): void {
  const timeout = turnTimeouts.get(turnId);
  if (timeout) {
    clearTimeout(timeout);
    turnTimeouts.delete(turnId);
  }
}

function readResultTurnId(result: unknown): string | null {
  if (!isRecord(result) || !isRecord(result.turn)) {
    return null;
  }
  return typeof result.turn.id === "string" ? result.turn.id : null;
}

function readResultThreadId(result: unknown): string | null {
  if (!isRecord(result) || !isRecord(result.thread)) {
    return null;
  }
  return typeof result.thread.id === "string" ? result.thread.id : null;
}

async function ensureThreadLoaded(threadId: string, model?: string): Promise<void> {
  if (loadedThreadIds.has(threadId)) {
    return;
  }
  await codex.request("thread/resume", {
    threadId,
    model: model ?? config.defaultModel,
    modelProvider: config.defaultModelProvider,
    cwd: config.runtimeRoot,
    approvalPolicy: "never",
    sandbox: "read-only",
    config: process.env.NODE_ENV === "production" ? undefined : { bypass_hook_trust: true },
    developerInstructions: createRuntimeDeveloperInstructions(),
    dynamicTools: createCommerceDynamicToolSpecs(),
    excludeTurns: true,
  });
  loadedThreadIds.add(threadId);
}

function readEventTurnId(params: unknown): string | null {
  if (!isRecord(params) || !isRecord(params.turn)) {
    return null;
  }
  return typeof params.turn.id === "string" ? params.turn.id : null;
}

function openSse(res: ServerResponse, threadId?: string): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`event: gateway/connected\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
  sseClients.set(res, { threadId });
  const heartbeat = setInterval(() => {
    res.write(`: keepalive ${Date.now()}\n\n`);
  }, 20_000);
  res.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
}

function broadcastEvent(event: AppServerEvent): void {
  if (event.type !== "notification" || !browserEventMethods.has(event.method)) {
    return;
  }
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  const threadId = getEventThreadId(event);
  for (const [client, filter] of sseClients) {
    if (filter.threadId && filter.threadId !== threadId) {
      continue;
    }
    client.write(payload);
  }
}

function getEventThreadId(event: AppServerEvent): string | undefined {
  if ((event.type === "notification" || event.type === "server_request") && isRecord(event.params)) {
    if (typeof event.params.threadId === "string") {
      return event.params.threadId;
    }
    if (isRecord(event.params.thread) && typeof event.params.thread.id === "string") {
      return event.params.thread.id;
    }
  }
  return undefined;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {} as T;
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw) as T;
}

function matchPath(pathname: string, pattern: RegExp): RegExpMatchArray | null {
  return pathname.match(pattern);
}

function serializeError(error: unknown): { error: string; code?: number; data?: unknown } {
  if (error instanceof CommerceProviderError) {
    return {
      error: error.message,
      code: error.statusCode,
      data: {
        upstreamStatus: error.upstreamStatus,
        traceId: error.traceId,
      },
    };
  }
  if (error instanceof Error) {
    const maybeError = error as Error & { code?: number; data?: unknown };
    return {
      error: error.message,
      code: maybeError.code,
      data: maybeError.data,
    };
  }

  return { error: String(error) };
}

function validateImageGenerationInput(input: ImageGenerationInput, configuredModel: string): ImageGenerationInput {
  if (!input || typeof input !== "object") {
    throw new CommerceProviderError("Expected an image generation request body.", 400);
  }
  if (input.model !== configuredModel) {
    throw new CommerceProviderError(`Image generation model must be ${configuredModel}.`, 400);
  }
  if (typeof input.prompt !== "string" || input.prompt.trim().length === 0 || input.prompt.length > 20_000) {
    throw new CommerceProviderError("Image prompt must contain between 1 and 20000 characters.", 400);
  }
  if (input.n !== undefined && (!Number.isInteger(input.n) || input.n < 1 || input.n > 4)) {
    throw new CommerceProviderError("Image count must be between 1 and 4.", 400);
  }
  if (input.quality && !["auto", "low", "medium", "high"].includes(input.quality)) {
    throw new CommerceProviderError("Unsupported image quality.", 400);
  }
  return {
    model: input.model,
    prompt: input.prompt.trim(),
    quality: input.quality,
    size: input.size,
    n: input.n,
  };
}

async function handleCommerceHostToolRequest(event: Extract<AppServerEvent, { type: "server_request" }>): Promise<void> {
  if (!isRecord(event.params)) {
    throw new Error("Invalid Commerce host tool request.");
  }
  const namespace = typeof event.params.namespace === "string" ? event.params.namespace : null;
  const tool = typeof event.params.tool === "string" ? event.params.tool : "";
  if (namespace === "commerce_web" && tool === "search") {
    const args = isRecord(event.params.arguments) ? event.params.arguments : {};
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query || query.length > 4_000) {
      throw new Error("Web search query must contain between 1 and 4000 characters.");
    }
    const model = config.defaultModel;
    if (!model) {
      throw new Error("Commerce web search requires CODEX_DEFAULT_MODEL.");
    }
    const result = await provider.searchWeb({ model, query });
    codex.respondToServerRequest(event.id, {
      success: true,
      contentItems: [
        {
          type: "inputText",
          text: JSON.stringify({
            status: "completed",
            answer: result.answer,
            sources: result.sources,
            instruction: "Use this answer and cite the returned source URLs. Do not claim the search was unavailable.",
          }),
        },
      ],
    });
    return;
  }
  if (namespace !== "commerce_image" || tool !== "generate") {
    throw new Error(`Host tool ${namespace ?? "unknown"}.${tool || "unknown"} is not registered.`);
  }

  const args = isRecord(event.params.arguments) ? event.params.arguments : {};
  const input = validateImageGenerationInput(
    {
      model: config.provider.imageModel,
      prompt: typeof args.prompt === "string" ? args.prompt : "",
      quality: readImageQuality(args.quality),
      size: typeof args.size === "string" ? args.size : undefined,
      n: 1,
    },
    config.provider.imageModel,
  );

  broadcastEvent({
    type: "notification",
    method: "commerce/imageGeneration/started",
    params: {
      callId: event.params.callId,
      threadId: event.params.threadId,
      turnId: event.params.turnId,
      model: config.provider.imageModel,
    },
    at: new Date().toISOString(),
  });

  const generated = await provider.generateImage(input);
  const saved = await saveGeneratedImage(generated.base64, generated.mimeType);
  const publicUrl = `/api/provider/generated-images/${encodeURIComponent(saved.filename)}`;
  codex.respondToServerRequest(event.id, {
    success: true,
    contentItems: [
      {
        type: "inputText",
        text: JSON.stringify({
          status: "completed",
          model: generated.model,
          publicUrl,
          mimeType: generated.mimeType,
          quality: generated.quality,
          size: generated.size,
          instruction: "The image is complete. Do not retry this generation. Return the public URL to the user.",
        }),
      },
    ],
  });

  broadcastEvent({
    type: "notification",
    method: "commerce/imageGeneration/completed",
    params: {
      callId: event.params.callId,
      threadId: event.params.threadId,
      turnId: event.params.turnId,
      model: generated.model,
      filename: saved.filename,
      publicUrl,
      mimeType: generated.mimeType,
      quality: generated.quality,
      size: generated.size,
      usage: generated.usage,
    },
    at: new Date().toISOString(),
  });
}

function createCommerceImageToolSpec(): Record<string, unknown> {
  return {
    type: "namespace",
    name: "commerce_image",
    description: "Commerce Pilot image generation powered by the runtime's configured GPT Image model.",
    tools: [
      {
        type: "function",
        name: "generate",
        description: "Generate a new bitmap image with gpt-image-2. Use this for image creation requests.",
        deferLoading: false,
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            prompt: {
              type: "string",
              description: "A complete, production-ready image prompt.",
            },
            quality: {
              type: "string",
              enum: ["auto", "low", "medium", "high"],
              description: "Image quality. Use low for drafts and auto for normal generation.",
            },
            size: {
              type: "string",
              description: "Image size, such as auto or 1024x1024.",
            },
          },
          required: ["prompt"],
        },
      },
    ],
  };
}

function createCommerceWebToolSpec(): Record<string, unknown> {
  return {
    type: "namespace",
    name: "commerce_web",
    description: "Commerce Pilot hosted web research through the configured application provider.",
    tools: [
      {
        type: "function",
        name: "search",
        description: "Search the live web and return a grounded answer with source URLs. Use for current facts, websites, news, prices, schedules, and explicit web-search requests.",
        deferLoading: false,
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: {
              type: "string",
              description: "A complete search question including the facts and source scope needed.",
            },
          },
          required: ["query"],
        },
      },
    ],
  };
}

function createCommerceDynamicToolSpecs(): Record<string, unknown>[] {
  return [createCommerceImageToolSpec(), createCommerceWebToolSpec()];
}

function createRuntimeDeveloperInstructions(): string {
  return [
    "Commerce Pilot is a hosted e-commerce agent, not a local coding agent.",
    "Use only application-registered dynamic tools. Never run shell commands, inspect or modify host files, spawn processes, use local developer tools, or request additional filesystem or network permissions.",
    "If a requested capability has no registered tool, explain that it is unavailable instead of attempting a local workaround.",
    "Commerce Pilot provides the host tool `commerce_image.generate` for bitmap image generation.",
    `It is backed by ${config.provider.imageModel} through the configured application provider.`,
    "Use it when the user asks to generate an image. Do not claim image generation is unavailable while this tool is present.",
    "A completed tool result contains the authoritative publicUrl. Do not retry a completed generation because it omits inline image bytes.",
    "Use quality=low only for explicit drafts or probes; otherwise use quality=auto.",
    "Commerce Pilot provides `commerce_web.search` for live web research through the configured provider.",
    "Use it whenever the user explicitly asks to search the web or when current external information is required. Cite its returned source URLs and never claim Web Search is unavailable while this tool is present.",
  ].join(" ");
}

async function saveGeneratedImage(base64: string, mimeType: string): Promise<{ path: string; filename: string }> {
  const directory = join(config.codexHome, "generated_images");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  const filename = `${Date.now()}-${randomUUID()}.${extension}`;
  const path = join(directory, filename);
  await writeFile(path, Buffer.from(base64, "base64"), { mode: 0o600 });
  return { path, filename };
}

function readImageQuality(value: unknown): ImageGenerationInput["quality"] {
  return value === "low" || value === "medium" || value === "high" || value === "auto" ? value : "auto";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSafeGeneratedImageFilename(filename: string): boolean {
  return (
    filename === basename(filename) &&
    /^[0-9]+-[0-9a-f-]+\.(png|jpg|webp)$/i.test(filename)
  );
}

function isSafeAgentId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

function isAuthorizedGatewayRequest(req: IncomingMessage): boolean {
  if (!config.internalToken) {
    return true;
  }
  const provided = req.headers["x-commerce-gateway-token"];
  if (typeof provided !== "string") {
    return false;
  }
  const expectedBuffer = Buffer.from(config.internalToken);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

function imageContentType(filename: string): string {
  const extension = extname(filename).toLowerCase();
  return extension === ".jpg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "image/png";
}
