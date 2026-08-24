import "dotenv/config";

import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { CodexAppServerClient } from "../codex/app-server-client.js";
import type { AppServerEvent, ThreadStartInput, TurnStartInput } from "../codex/protocol.js";
import { ensureAppOwnedCodexConfig } from "../codex/runtime-config.js";
import { CommerceProviderClient, CommerceProviderError, type ImageGenerationInput } from "../provider/commerce-provider-client.js";
import { normalizeProviderUsage } from "../provider/provider-usage.js";
import { readGatewayConfig } from "./config.js";
import {
  readThreadContextUsage,
  shouldAutoCompact,
  type ThreadContextUsage,
} from "./compaction-policy.js";
import { GeneratedImageStore } from "./generated-image-store.js";
import { readManagedMcpStatus, type ManagedMcpStatus } from "./managed-mcp-status.js";
import {
  PendingSteerRegistry,
  ThreadOperationQueue,
  type PendingSteerState,
} from "./pending-steer-state.js";
import { PendingSteerStore } from "./pending-steer-store.js";
import {
  AgentEventOutbox,
  type AgentOutboxEvent,
  type RuntimeScope,
  type TurnCompletedEvent,
  type UsageCompletedEvent,
} from "./agent-event-outbox.js";
import {
  isAgentEventPipelineHealthy,
  isAgentEventPipelineWritable,
} from "./agent-event-pipeline-health.js";
import { AgentOutboxProcessLock } from "./agent-outbox-process-lock.js";

type CompactionTrigger = "automatic" | "manual" | "harness";

type CompactionState = {
  threadId: string;
  trigger: CompactionTrigger;
  requestedAt: number;
  turnId: string | null;
  timeout: NodeJS.Timeout | null;
  contextTokens: number | null;
  modelContextWindow: number | null;
  admissionRequestId: string | null;
};

type QueuedSubmissionView = {
  id: string;
  clientUserMessageId: string;
  content: string;
  pendingSteer: boolean;
};

type TurnModelState = {
  requestedModel: string | null;
  effectiveModel: string | null;
};

type ManagedMcpRuntimeState = ManagedMcpStatus & {
  state: "unknown" | "loading" | "ready" | "failed";
  checkedAt: string | null;
  error: string | null;
};

class GatewayRequestError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "GatewayRequestError";
  }
}

const config = readGatewayConfig();
await ensureAppOwnedCodexConfig(config);
const gatewayInstanceId = randomUUID();
const agentEventDeliveryEnabled = Boolean(config.agentEventSinkUrl && config.internalToken);

const provider = new CommerceProviderClient(config.provider);
const generatedImages = new GeneratedImageStore(config.codexHome);
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
const activeTurnsByThread = new Map<string, string>();
const turnStartReservations = new Set<string>();
const latestContextUsage = new Map<string, ThreadContextUsage>();
const compactionStates = new Map<string, CompactionState>();
const pendingSteers = new PendingSteerRegistry();
const pendingSteerStore = new PendingSteerStore(config.codexHome);
const threadOperations = new ThreadOperationQueue();
const threadScopes = new Map<string, RuntimeScope>();
const pendingTurnModels = new Map<string, string | null>();
const turnModels = new Map<string, TurnModelState>();
const agentEventOutbox = new AgentEventOutbox(config.codexHome);
const agentOutboxProcessLock = new AgentOutboxProcessLock(config.codexHome);
const pendingAgentEventWrites = new Set<Promise<void>>();
await agentOutboxProcessLock.acquire("gateway");
pendingSteers.hydrate(await pendingSteerStore.load());
await agentEventOutbox.load();
let managedMcpState: ManagedMcpRuntimeState = {
  state: "unknown",
  available: false,
  serverName: "commerce_web",
  tools: [],
  authStatus: null,
  checkedAt: null,
  error: null,
};
let managedMcpReadyPromise: Promise<void> | null = null;
let agentEventFlushPromise: Promise<void> | null = null;
let agentEventRetryTimer: NodeJS.Timeout | null = null;
let runtimeAuthorizationTimer: NodeJS.Timeout | null = null;
let runtimeAuthorizationPollPromise: Promise<void> | null = null;
let agentEventSinkError: string | null = null;
let agentEventSinkCheckedAt: string | null = null;
let agentEventRetryAttempt = 0;
let runtimeAuthorizationCheckedAt: string | null = null;
let runtimeAuthorizationError: string | null = null;
const pendingRuntimeRevocations = new Map<string, RuntimeScope>();
const notifiedRuntimeRevocations = new Set<string>();
let shuttingDown = false;
const browserEventMethods = new Set([
  "turn/started",
  "turn/completed",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "commerce/imageGeneration/started",
  "commerce/imageGeneration/completed",
  "commerce/contextCompaction/started",
  "commerce/contextCompaction/failed",
  "commerce/authorization/revoked",
  "thread/queue/changed",
  "error",
]);
const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_QUEUED_MESSAGES_PER_THREAD = 50;
const MAX_QUEUED_MESSAGE_BYTES_PER_THREAD = 500_000;

codex.on("event", (event: AppServerEvent) => {
  if (event.type === "process" && event.event === "exit") {
    loadedThreadIds.clear();
    activeTurnsByThread.clear();
    turnStartReservations.clear();
    latestContextUsage.clear();
    pendingTurnModels.clear();
    turnModels.clear();
    threadOperations.clear();
    managedMcpReadyPromise = null;
    managedMcpState = {
      state: "unknown",
      available: false,
      serverName: "commerce_web",
      tools: [],
      authStatus: null,
      checkedAt: null,
      error: "Codex App Server exited; managed MCP readiness must be revalidated.",
    };
    for (const state of compactionStates.values()) {
      if (state.timeout) {
        clearTimeout(state.timeout);
      }
    }
    compactionStates.clear();
  }
  if (event.type === "notification") {
    handleRuntimeNotification(event);
  }
  broadcastEvent(event);
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
      const eventPipeline = readEventPipelineHealth();
      const runtimeReady =
        codex.isRunning &&
        codex.isInitialized &&
        managedMcpState.state === "ready" &&
        managedMcpState.available &&
        eventPipeline.healthy;
      sendJson(res, runtimeReady ? 200 : 503, {
        ok: runtimeReady,
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
        managedMcp: managedMcpState,
        runtimePolicy: {
          tools: "application-registered-only",
          shell: false,
          hostFilesystem: false,
          processNetwork: false,
          hostedWebSearch: true,
          managedMcpWebSearch: true,
          nativeProviderWebSearch: true,
          legacyDynamicWebSearchHandler: true,
          multiAgent: true,
          localPathImageReader: false,
          hooks: process.env.NODE_ENV === "production" ? "managed-only" : "app-owned-development",
          maxTurnDurationMs: config.maxTurnDurationMs,
          maxAgentThreadsPerSession: config.maxAgentThreadsPerSession,
          autoCompactThresholdPercent: config.autoCompactThresholdPercent,
          compactionTimeoutMs: config.compactionTimeoutMs,
          compactingThreads: compactionStates.size,
          enterpriseRuntime: {
            dedicatedTenant: Boolean(config.runtimeTenantId),
            scopedThreads: threadScopes.size,
            eventSinkConfigured: agentEventDeliveryEnabled,
            authorizationConfigured: Boolean(config.agentAuthorizationUrl),
            authorizationCheckedAt: runtimeAuthorizationCheckedAt,
            authorizationError: runtimeAuthorizationError,
            pendingEvents: agentEventOutbox.list().length,
            deadLetterEvents: agentEventOutbox.deadLetterCount(),
            eventSinkCheckedAt: agentEventSinkCheckedAt,
            eventSinkError: agentEventSinkError,
            eventPipeline,
          },
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
      if (!generatedImages.isSafeFilename(filename)) {
        sendJson(res, 400, { error: "Invalid generated image filename." });
        return;
      }
      const image = await generatedImages.readImage(filename);
      res.writeHead(200, {
        "Content-Type": generatedImages.imageContentType(filename),
        "Content-Length": image.byteLength,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(image);
      return;
    }

    const generatedImageMetadataMatch = matchPath(url.pathname, /^\/api\/generated-images\/([^/]+)\/metadata$/);
    if (req.method === "GET" && generatedImageMetadataMatch) {
      const filename = decodeURIComponent(generatedImageMetadataMatch[1] ?? "");
      if (!generatedImages.isSafeFilename(filename)) {
        sendJson(res, 400, { error: "Invalid generated image filename." });
        return;
      }
      const artifact = await generatedImages.get(filename);
      if (!artifact) {
        sendJson(res, 404, { error: "Generated image metadata not found." });
        return;
      }
      sendJson(res, 200, { artifact });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/codex/events") {
      const threadId = url.searchParams.get("threadId") || undefined;
      if (threadId) {
        if (!isSafeAgentId(threadId)) {
          sendJson(res, 400, { error: "Invalid thread id." });
          return;
        }
        bindRequestRuntimeScope(req, threadId);
      }
      openSse(res, threadId);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/threads") {
      await ensureCommerceWebMcpReady();
      const body = await readJsonBody<ThreadStartInput>(req);
      const model = body.model ?? config.defaultModel;
      const requestedScope = readRequestRuntimeScope(req, "", model ?? null);
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
        config: createRuntimeRequestConfig(),
        developerInstructions: createRuntimeDeveloperInstructions(),
        ephemeral: false,
        experimentalRawEvents: true,
        dynamicTools: createCommerceDynamicToolSpecs(),
      });
      const startedThreadId = readResultThreadId(result);
      if (startedThreadId) {
        loadedThreadIds.add(startedThreadId);
        if (requestedScope) {
          threadScopes.set(startedThreadId, {
            ...requestedScope,
            rootThreadId: startedThreadId,
            parentThreadId: null,
          });
        }
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
      bindRequestRuntimeScope(req, threadId);
      // Resume first so persisted threads receive the current managed MCP catalog
      // and runtime overrides before any read can load them with stale capabilities.
      await ensureThreadLoaded(threadId);
      const result = await readThreadWithStartupRetry(threadId, true);
      const generatedImageArtifacts = await generatedImages.listForThread(threadId);
      sendJson(res, 200, { result, generatedImages: generatedImageArtifacts });
      return;
    }

    const compactMatch = matchPath(url.pathname, /^\/api\/threads\/([^/]+)\/compact$/);
    if (req.method === "POST" && compactMatch) {
      const threadId = decodeURIComponent(compactMatch[1] ?? "");
      const body = await readJsonBody<{ clientRequestId?: unknown }>(req);
      const clientRequestId =
        typeof body.clientRequestId === "string" && isUuid(body.clientRequestId)
          ? body.clientRequestId
          : "";
      if (!isSafeAgentId(threadId)) {
        sendJson(res, 400, { error: "Invalid thread id." });
        return;
      }
      if (!clientRequestId) {
        sendJson(res, 400, { error: "Compaction requires a valid client request id." });
        return;
      }
      bindRequestRuntimeScope(req, threadId);
      if (activeTurnsByThread.has(threadId)) {
        sendJson(res, 409, { error: "Thread has an active turn and cannot be compacted." });
        return;
      }
      await ensureThreadLoaded(threadId);
      const existing = compactionStates.get(threadId);
      if (existing) {
        sendJson(res, 202, { accepted: true, alreadyRunning: true, trigger: existing.trigger });
        return;
      }
      const state = reserveCompaction(threadId, "manual", undefined, clientRequestId);
      broadcastCompactionStarted(state);
      await issueCompactionRequest(state);
      sendJson(res, 202, { accepted: true, alreadyRunning: false, trigger: state.trigger });
      return;
    }

    const turnMatch = matchPath(url.pathname, /^\/api\/threads\/([^/]+)\/turns$/);
    if (req.method === "POST" && turnMatch) {
      if (!isEventPipelineWritable()) {
        sendJson(res, 503, { error: "Enterprise usage event pipeline requires operator attention." });
        return;
      }
      const body = await readJsonBody<Omit<TurnStartInput, "threadId"> & { clientRequestId?: string }>(req);
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
      const clientUserMessageId = isSafeAgentId(body.clientRequestId ?? "")
        ? (body.clientRequestId as string)
        : randomUUID();
      bindRequestRuntimeScope(req, threadId, body.model ?? null);
      if (compactionStates.has(threadId)) {
        sendJson(res, 409, { error: "Thread context is being compacted. Retry after compaction completes." });
        return;
      }
      if (turnStartReservations.has(threadId)) {
        sendJson(res, 409, { error: "Thread turn startup is already in progress.", code: "THREAD_STARTING" });
        return;
      }
      turnStartReservations.add(threadId);
      try {
        if (body.model) {
          await provider.assertAgentModel(body.model);
        }
        await ensureThreadLoaded(threadId, body.model);
        const activeTurnId = await readHarnessActiveTurnId(threadId);
        if (activeTurnId) {
          activeTurnsByThread.set(threadId, activeTurnId);
          const queuedResult = await serializeSteerTransition(threadId, () =>
            addQueuedSubmissionWithCapacity(threadId, clientUserMessageId, message),
          );
          sendJson(res, 202, {
            queued: true,
            activeTurnId,
            queuedSubmission: readQueuedSubmissionResult(queuedResult),
          });
          return;
        }
        const staleTurnId = activeTurnsByThread.get(threadId);
        if (staleTurnId) {
          activeTurnsByThread.delete(threadId);
          clearTurnTimeout(staleTurnId);
        }
        const requestedModel = body.model ?? threadScopes.get(threadId)?.model ?? config.defaultModel ?? null;
        pendingTurnModels.set(threadId, requestedModel);
        const result = await codex
          .request("turn/start", {
            threadId,
            clientUserMessageId,
            input: [{ type: "text", text: message, text_elements: [] }],
            model: body.model,
            effort: body.effort,
          })
          .finally(() => {
            if (pendingTurnModels.get(threadId) === requestedModel) pendingTurnModels.delete(threadId);
          });
        const startedTurnId = readResultTurnId(result);
        if (startedTurnId) {
          bindTurnModel(threadId, startedTurnId, requestedModel);
          updateThreadRuntimeModel(threadId, requestedModel);
          activeTurnsByThread.set(threadId, startedTurnId);
          scheduleTurnTimeout(threadId, startedTurnId);
        }
        sendJson(res, 200, { result });
        return;
      } finally {
        turnStartReservations.delete(threadId);
      }
    }

    const queueMatch = matchPath(url.pathname, /^\/api\/threads\/([^/]+)\/queue$/);
    if (req.method === "GET" && queueMatch) {
      const threadId = decodeURIComponent(queueMatch[1] ?? "");
      if (!isSafeAgentId(threadId)) {
        sendJson(res, 400, { error: "Invalid thread id." });
        return;
      }
      bindRequestRuntimeScope(req, threadId);
      await ensureThreadLoaded(threadId);
      const result = await codex.request("thread/queue/list", {
        threadId,
        cursor: null,
        limit: 100,
      });
      const submissions = readQueuedSubmissions(result);
      const pendingSteers = readPendingSteers(threadId);
      sendJson(res, 200, {
        queue: submissions,
        pendingSteers: pendingSteers.map((item) => ({
          id: item.queuedSubmissionId,
          clientUserMessageId: item.clientUserMessageId,
          content: item.content,
          pendingSteer: true,
        })),
      });
      return;
    }
    if (req.method === "POST" && queueMatch) {
      const threadId = decodeURIComponent(queueMatch[1] ?? "");
      const body = await readJsonBody<{ message?: unknown; clientRequestId?: unknown }>(req);
      const message = typeof body.message === "string" ? body.message.trim() : "";
      const clientUserMessageId = isSafeAgentId(
        typeof body.clientRequestId === "string" ? body.clientRequestId : "",
      )
        ? (body.clientRequestId as string)
        : randomUUID();
      if (!isSafeAgentId(threadId)) {
        sendJson(res, 400, { error: "Invalid thread id." });
        return;
      }
      bindRequestRuntimeScope(req, threadId);
      if (!message || message.length > 50_000) {
        sendJson(res, 400, { error: "Expected a queued message between 1 and 50000 characters." });
        return;
      }
      if (compactionStates.has(threadId)) {
        sendJson(res, 409, { error: "Thread context is being compacted and cannot accept queued input." });
        return;
      }
      await ensureThreadLoaded(threadId);
      const result = await serializeSteerTransition(threadId, () =>
        addQueuedSubmissionWithCapacity(threadId, clientUserMessageId, message),
      );
      sendJson(res, 200, { queuedSubmission: readQueuedSubmissionResult(result) });
      return;
    }

    const queueItemMatch = matchPath(url.pathname, /^\/api\/threads\/([^/]+)\/queue\/([^/]+)$/);
    if ((req.method === "PATCH" || req.method === "DELETE") && queueItemMatch) {
      const threadId = decodeURIComponent(queueItemMatch[1] ?? "");
      const queuedSubmissionId = decodeURIComponent(queueItemMatch[2] ?? "");
      if (!isSafeAgentId(threadId) || !isSafeAgentId(queuedSubmissionId)) {
        sendJson(res, 400, { error: "Invalid thread or queued submission id." });
        return;
      }
      bindRequestRuntimeScope(req, threadId);
      if (hasPendingSteer(threadId, queuedSubmissionId)) {
        sendJson(res, 409, { error: "Queued submission is waiting to be committed to the active turn." });
        return;
      }
      await ensureThreadLoaded(threadId);
      if (req.method === "DELETE") {
        const result = await serializeSteerTransition(threadId, () =>
          codex.request("thread/queue/delete", { threadId, queuedSubmissionId }),
        );
        sendJson(res, 200, { result });
        return;
      }
      const body = await readJsonBody<{ message?: unknown }>(req);
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message || message.length > 50_000) {
        sendJson(res, 400, { error: "Expected a queued message between 1 and 50000 characters." });
        return;
      }
      const result = await serializeSteerTransition(threadId, () =>
        codex.request("thread/queue/update", {
          threadId,
          queuedSubmissionId,
          input: [{ type: "text", text: message, text_elements: [] }],
        }),
      );
      sendJson(res, 200, { queuedSubmission: readQueuedSubmissionResult(result) });
      return;
    }

    const queueSteerMatch = matchPath(url.pathname, /^\/api\/threads\/([^/]+)\/queue\/([^/]+)\/steer$/);
    if (req.method === "POST" && queueSteerMatch) {
      const threadId = decodeURIComponent(queueSteerMatch[1] ?? "");
      const queuedSubmissionId = decodeURIComponent(queueSteerMatch[2] ?? "");
      const body = await readJsonBody<{ expectedTurnId?: unknown; clientUserMessageId?: unknown }>(req);
      const expectedTurnId = typeof body.expectedTurnId === "string" ? body.expectedTurnId : "";
      const clientUserMessageId =
        typeof body.clientUserMessageId === "string" ? body.clientUserMessageId : "";
      if (
        !isSafeAgentId(threadId) ||
        !isSafeAgentId(queuedSubmissionId) ||
        !isSafeAgentId(expectedTurnId) ||
        !isSafeAgentId(clientUserMessageId)
      ) {
        sendJson(res, 400, { error: "Invalid thread, turn, queued submission, or client message id." });
        return;
      }
      bindRequestRuntimeScope(req, threadId);
      try {
        await ensureThreadLoaded(threadId);
        const result = await serializeSteerTransition(threadId, () =>
          promoteQueuedSubmissionToSteer(
            threadId,
            queuedSubmissionId,
            expectedTurnId,
            clientUserMessageId,
          ),
        );
        sendJson(res, 200, { result, pendingSubmissionId: queuedSubmissionId });
      } catch (error) {
        const serialized = serializeError(error);
        sendJson(res, error instanceof GatewayRequestError ? error.statusCode : 500, serialized);
      }
      return;
    }

    const interruptMatch = matchPath(url.pathname, /^\/api\/threads\/([^/]+)\/turns\/([^/]+)\/interrupt$/);
    if (req.method === "POST" && interruptMatch) {
      const threadId = decodeURIComponent(interruptMatch[1] ?? "");
      const turnId = decodeURIComponent(interruptMatch[2] ?? "");
      if (!isSafeAgentId(threadId) || !isSafeAgentId(turnId)) {
        sendJson(res, 400, { error: "Invalid thread or turn id." });
        return;
      }
      bindRequestRuntimeScope(req, threadId);
      const result = await codex.request("turn/interrupt", {
        threadId,
        turnId,
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
        "GET /api/codex/events",
        "POST /api/threads",
        "GET /api/threads/:threadId",
        "POST /api/threads/:threadId/compact",
        "POST /api/threads/:threadId/turns",
        "GET /api/threads/:threadId/queue",
        "POST /api/threads/:threadId/queue",
        "PATCH /api/threads/:threadId/queue/:queuedSubmissionId",
        "DELETE /api/threads/:threadId/queue/:queuedSubmissionId",
        "POST /api/threads/:threadId/queue/:queuedSubmissionId/steer",
        "POST /api/threads/:threadId/turns/:turnId/interrupt",
      ],
    });
  } catch (error) {
    const serialized = serializeError(error);
    const statusCode =
      error instanceof CommerceProviderError || error instanceof GatewayRequestError
        ? error.statusCode
        : 500;
    sendJson(res, statusCode, serialized);
  }
});

await ensureCommerceWebMcpReady(true);
scheduleAgentEventFlush(0);
startRuntimeAuthorizationPoll();

server.listen(config.port, config.host, () => {
  console.log(`Commerce Agent Gateway listening on http://${config.host}:${config.port}`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (agentEventRetryTimer) {
    clearTimeout(agentEventRetryTimer);
    agentEventRetryTimer = null;
  }
  if (runtimeAuthorizationTimer) {
    clearInterval(runtimeAuthorizationTimer);
    runtimeAuthorizationTimer = null;
  }
  for (const timeout of turnTimeouts.values()) {
    clearTimeout(timeout);
  }
  turnTimeouts.clear();
  for (const state of compactionStates.values()) {
    if (state.timeout) {
      clearTimeout(state.timeout);
    }
  }
  compactionStates.clear();
  for (const client of sseClients.keys()) {
    client.end();
  }
  sseClients.clear();
  await codex.stop();
  if (runtimeAuthorizationPollPromise) await runtimeAuthorizationPollPromise.catch(() => undefined);
  await Promise.allSettled([...pendingAgentEventWrites]);
  await agentEventOutbox.flush();
  await flushAgentEventOutbox().catch(() => undefined);
  await agentEventOutbox.flush();
  await agentOutboxProcessLock.release();
  server.close(() => {
    process.exit(0);
  });
}

function handleRuntimeNotification(event: Extract<AppServerEvent, { type: "notification" }>): void {
  if (event.method === "thread/started") {
    inheritSubagentRuntimeScope(event.params);
    return;
  }

  if (event.method === "rawResponse/completed") {
    const usageEvent = readUsageCompletedEvent(event);
    if (usageEvent) scheduleAgentEvent(usageEvent);
    return;
  }

  if (event.method === "thread/tokenUsage/updated") {
    const usage = readThreadContextUsage(event.params);
    if (usage && isSafeAgentId(usage.threadId) && isSafeAgentId(usage.turnId)) {
      latestContextUsage.set(usage.threadId, usage);
    }
    return;
  }

  if (event.method === "model/rerouted") {
    const reroute = readModelReroute(event.params);
    if (reroute) {
      const key = turnModelKey(reroute.threadId, reroute.turnId);
      const existing = turnModels.get(key);
      turnModels.set(key, {
        requestedModel: existing?.requestedModel ?? reroute.fromModel,
        effectiveModel: reroute.toModel,
      });
    }
    return;
  }

  const threadId = getEventThreadId(event);
  if (!threadId) {
    return;
  }

  if (event.method === "item/started" || event.method === "item/completed") {
    if (event.method === "item/completed") {
      const providerUsageEvent = readManagedMcpProviderUsageEvent(event);
      if (providerUsageEvent) scheduleAgentEvent(providerUsageEvent);
    }
    const clientId = readUserMessageClientId(event.params);
    const pendingSteer = readPendingSteers(threadId)[0] ?? null;
    if (clientId && pendingSteer?.clientUserMessageId === clientId) {
      pendingSteers.acknowledgeFront(threadId, clientId);
      void persistPendingSteers().catch(() => undefined);
    }
  }

  if (event.method === "turn/started") {
    const turnId = readEventTurnId(event.params);
    if (turnId) {
      const requestedModel = pendingTurnModels.get(threadId) ?? threadScopes.get(threadId)?.model ?? null;
      bindTurnModel(threadId, turnId, requestedModel);
      activeTurnsByThread.set(threadId, turnId);
      const state = compactionStates.get(threadId);
      if (state && !state.turnId) {
        state.turnId = turnId;
      }
    }
    return;
  }

  if (event.method === "item/started" && isContextCompactionItem(event.params)) {
    const turnId = readEventTurnIdFromItemParams(event.params);
    let state = compactionStates.get(threadId);
    let created = false;
    if (!state) {
      state = reserveCompaction(threadId, "harness");
      created = true;
      broadcastCompactionStarted(state);
    }
    if (turnId) {
      state.turnId = turnId;
    }
    if (created) void admitHarnessCompaction(state);
    return;
  }

  if (event.method === "error") {
    const state = compactionStates.get(threadId);
    if (state) {
      failCompaction(state, "Codex context compaction failed.");
    }
    return;
  }

  if (event.method !== "turn/completed") {
    return;
  }

  const turnId = readEventTurnId(event.params);
  if (!turnId) {
    return;
  }
  clearTurnTimeout(turnId);
  const completedEvent = readTurnCompletedOutboxEvent(event, threadId, turnId);
  if (completedEvent) scheduleAgentEvent(completedEvent);
  turnModels.delete(turnModelKey(threadId, turnId));
  if (activeTurnsByThread.get(threadId) === turnId) {
    activeTurnsByThread.delete(threadId);
  }

  if (readPendingSteers(threadId).some((pending) => pending.turnId === turnId)) {
    queueMicrotask(() => {
      void serializeSteerTransition(threadId, () => restorePendingSteersToQueue(threadId, turnId, true));
    });
  }

  const state = compactionStates.get(threadId);
  if (state && state.turnId === turnId) {
    finishCompaction(state);
    return;
  }

  const usage = latestContextUsage.get(threadId);
  if (
    readTurnCompletionStatus(event.params) === "completed" &&
    usage?.turnId === turnId &&
    !state &&
    shouldAutoCompact(usage, config.autoCompactThresholdPercent)
  ) {
    queueMicrotask(() => {
      void startAutomaticCompaction(threadId, usage);
    });
  }
}

function reserveCompaction(
  threadId: string,
  trigger: CompactionTrigger,
  usage?: ThreadContextUsage,
  admissionRequestId: string | null = null,
): CompactionState {
  const existing = compactionStates.get(threadId);
  if (existing) {
    return existing;
  }
  const state: CompactionState = {
    threadId,
    trigger,
    requestedAt: Date.now(),
    turnId: null,
    timeout: null,
    contextTokens: usage?.totalTokens ?? null,
    modelContextWindow: usage?.modelContextWindow ?? null,
    admissionRequestId,
  };
  compactionStates.set(threadId, state);
  return state;
}

async function issueCompactionRequest(state: CompactionState): Promise<void> {
  try {
    if (!isEventPipelineWritable()) {
      throw new GatewayRequestError("Enterprise usage event pipeline requires operator attention.", 503);
    }
    await codex.request("thread/compact/start", { threadId: state.threadId }, 30_000);
    state.timeout = setTimeout(() => {
      if (state.turnId) {
        void codex
          .request("turn/interrupt", { threadId: state.threadId, turnId: state.turnId }, 10_000)
          .catch(() => undefined);
      }
      failCompaction(state, "Codex context compaction timed out.");
    }, config.compactionTimeoutMs);
    state.timeout.unref();
  } catch (error) {
    failCompaction(state, "Codex context compaction could not start.");
    throw error;
  }
}

async function startAutomaticCompaction(threadId: string, usage: ThreadContextUsage): Promise<void> {
  if (compactionStates.has(threadId) || activeTurnsByThread.has(threadId)) return;
  const admission = await reserveRuntimeCompactionAdmission(threadId);
  if (!admission || !admission.requestId) return;
  if (compactionStates.has(threadId) || activeTurnsByThread.has(threadId)) {
    await releaseRuntimeCompactionAdmission(threadId, admission.requestId);
    return;
  }
  const state = reserveCompaction(threadId, "automatic", usage, admission.requestId);
  broadcastCompactionStarted(state);
  await issueCompactionRequest(state).catch(() => undefined);
}

async function admitHarnessCompaction(state: CompactionState): Promise<void> {
  const admission = await reserveRuntimeCompactionAdmission(state.threadId, state.turnId);
  if (compactionStates.get(state.threadId) !== state) {
    if (admission?.requestId) await releaseRuntimeCompactionAdmission(state.threadId, admission.requestId);
    return;
  }
  if (admission?.attached) return;
  if (admission?.requestId) {
    state.admissionRequestId = admission.requestId;
    return;
  }
  if (state.turnId) {
    await codex
      .request("turn/interrupt", { threadId: state.threadId, turnId: state.turnId }, 10_000)
      .catch(() => undefined);
  }
  failCompaction(state, "Enterprise quota denied context compaction.");
}

function finishCompaction(state: CompactionState): void {
  if (state.timeout) {
    clearTimeout(state.timeout);
  }
  if (compactionStates.get(state.threadId) === state) {
    compactionStates.delete(state.threadId);
  }
  latestContextUsage.delete(state.threadId);
}

function failCompaction(state: CompactionState, message: string): void {
  if (state.timeout) {
    clearTimeout(state.timeout);
  }
  if (compactionStates.get(state.threadId) === state) {
    compactionStates.delete(state.threadId);
  }
  if (state.admissionRequestId && !state.turnId) {
    void releaseRuntimeCompactionAdmission(state.threadId, state.admissionRequestId);
  }
  broadcastEvent({
    type: "notification",
    method: "commerce/contextCompaction/failed",
    params: {
      threadId: state.threadId,
      turnId: state.turnId,
      trigger: state.trigger,
      message,
    },
    at: new Date().toISOString(),
  });
}

function broadcastCompactionStarted(state: CompactionState): void {
  broadcastEvent({
    type: "notification",
    method: "commerce/contextCompaction/started",
    params: {
      threadId: state.threadId,
      trigger: state.trigger,
      contextTokens: state.contextTokens,
      modelContextWindow: state.modelContextWindow,
      thresholdPercent: config.autoCompactThresholdPercent,
    },
    at: new Date().toISOString(),
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

async function readHarnessActiveTurnId(threadId: string): Promise<string | null> {
  const statusResult = await readThreadWithStartupRetry(threadId, false);
  if (!isRecord(statusResult) || !isRecord(statusResult.thread) || !isRecord(statusResult.thread.status)) {
    throw new Error("Codex App Server returned an invalid thread while reconciling active turn state.");
  }
  if (statusResult.thread.status.type !== "active") {
    return null;
  }
  const result = await readThreadWithStartupRetry(threadId, true);
  if (!isRecord(result) || !isRecord(result.thread) || !Array.isArray(result.thread.turns)) {
    throw new Error("Codex App Server returned no turns for an active thread.");
  }
  const turns = result.thread.turns.filter(isRecord);
  const activeTurn = [...turns].reverse().find(
    (turn) =>
      typeof turn.id === "string" &&
      (turn.status === "inProgress" || turn.status === "running"),
  );
  return activeTurn && typeof activeTurn.id === "string" ? activeTurn.id : null;
}

function readQueuedSubmissionResult(result: unknown): QueuedSubmissionView {
  if (!isRecord(result) || !isRecord(result.queuedSubmission)) {
    throw new Error("Codex App Server returned an invalid queued submission.");
  }
  const queued = normalizeQueuedSubmission(result.queuedSubmission);
  if (!queued) {
    throw new Error("Codex App Server returned an invalid queued submission.");
  }
  return queued;
}

function readQueuedSubmissions(result: unknown): QueuedSubmissionView[] {
  if (!isRecord(result) || !Array.isArray(result.data)) {
    throw new Error("Codex App Server returned an invalid thread queue.");
  }
  return result.data.map(normalizeQueuedSubmission).filter((item): item is QueuedSubmissionView => Boolean(item));
}

function normalizeQueuedSubmission(value: unknown): QueuedSubmissionView | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.clientUserMessageId !== "string") {
    return null;
  }
  const input = Array.isArray(value.input) ? value.input.filter(isRecord) : [];
  const content = input
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("\n")
    .trim();
  return content
    ? { id: value.id, clientUserMessageId: value.clientUserMessageId, content, pendingSteer: false }
    : null;
}

function readPendingSteers(threadId: string): PendingSteerState[] {
  return pendingSteers.list(threadId);
}

function hasPendingSteer(threadId: string, queuedSubmissionId: string): boolean {
  return pendingSteers.hasQueuedSubmission(threadId, queuedSubmissionId);
}

function readUserMessageClientId(params: unknown): string | null {
  if (!isRecord(params) || !isRecord(params.item) || params.item.type !== "userMessage") {
    return null;
  }
  return typeof params.item.clientId === "string" ? params.item.clientId : null;
}

async function serializeSteerTransition<T>(threadId: string, task: () => Promise<T>): Promise<T> {
  return threadOperations.run(threadId, task);
}

async function addQueuedSubmissionWithCapacity(
  threadId: string,
  clientUserMessageId: string,
  message: string,
): Promise<unknown> {
  const listed = await codex.request("thread/queue/list", { threadId, cursor: null, limit: 100 });
  const queued = readQueuedSubmissions(listed);
  if (queued.length >= MAX_QUEUED_MESSAGES_PER_THREAD) {
    throw new GatewayRequestError("Thread queue has reached its item limit.", 429);
  }
  const queuedBytes = queued.reduce((total, item) => total + Buffer.byteLength(item.content, "utf8"), 0);
  if (queuedBytes + Buffer.byteLength(message, "utf8") > MAX_QUEUED_MESSAGE_BYTES_PER_THREAD) {
    throw new GatewayRequestError("Thread queue has reached its storage limit.", 413);
  }
  return codex.request("thread/queue/add", {
    threadId,
    clientUserMessageId,
    input: [{ type: "text", text: message, text_elements: [] }],
  });
}

async function promoteQueuedSubmissionToSteer(
  threadId: string,
  queuedSubmissionId: string,
  expectedTurnId: string,
  clientUserMessageId: string,
): Promise<unknown> {
  const cachedTurnId = activeTurnsByThread.get(threadId) ?? null;
  const actualTurnId =
    cachedTurnId === expectedTurnId
      ? cachedTurnId
      : await readHarnessActiveTurnId(threadId);
  if (!actualTurnId) {
    const committedTurnId = await findCommittedUserMessageTurnIdWithRetry(threadId, clientUserMessageId);
    if (committedTurnId) {
      return { mode: "alreadyStarted", turnId: committedTurnId, result: null };
    }
    return startQueuedSubmission(threadId, queuedSubmissionId, "startedAfterTurnEnded");
  }
  let steerTurnId = actualTurnId;
  if (actualTurnId !== expectedTurnId) {
    const committedTurnId = await findCommittedUserMessageTurnIdWithRetry(threadId, clientUserMessageId);
    if (committedTurnId) {
      return { mode: "alreadyStarted", turnId: committedTurnId, result: null };
    }
    activeTurnsByThread.set(threadId, actualTurnId);
    steerTurnId = actualTurnId;
  }
  activeTurnsByThread.set(threadId, steerTurnId);

  const listResult = await codex.request("thread/queue/list", { threadId, cursor: null, limit: 100 });
  const queuedSubmission = readQueuedSubmissions(listResult).find((item) => item.id === queuedSubmissionId);
  if (!queuedSubmission) {
    const committedTurnId = await findCommittedUserMessageTurnIdWithRetry(threadId, clientUserMessageId);
    if (committedTurnId) {
      return { mode: "alreadyStarted", turnId: committedTurnId, result: null };
    }
    throw new GatewayRequestError("Queued submission not found.", 404);
  }
  if (queuedSubmission.clientUserMessageId !== clientUserMessageId) {
    throw new GatewayRequestError("Queued submission client id mismatch.", 409);
  }
  if (pendingSteers.hasClientId(queuedSubmission.clientUserMessageId)) {
    throw new GatewayRequestError("Queued submission is already pending as a steer.", 409);
  }

  const pendingSteer = pendingSteers.add({
    threadId,
    turnId: steerTurnId,
    queuedSubmissionId,
    clientUserMessageId: queuedSubmission.clientUserMessageId,
    content: queuedSubmission.content,
  });

  try {
    await persistPendingSteers();
    await codex.request("thread/queue/delete", { threadId, queuedSubmissionId });
  } catch (error) {
    pendingSteers.delete(pendingSteer.clientUserMessageId);
    await persistPendingSteers().catch(() => undefined);
    throw error;
  }

  try {
    const result = await codex.request("turn/steer", {
      threadId,
      expectedTurnId: steerTurnId,
      clientUserMessageId: pendingSteer.clientUserMessageId,
      input: [{ type: "text", text: pendingSteer.content, text_elements: [] }],
    });
    const completion = waitForTurnCompletion(threadId, steerTurnId, 15_000);
    void completion.catch(() => undefined);
    await interruptTurnWithRaceRetry(threadId, steerTurnId);
    await completion;
    const restored = await restorePendingSteersToQueue(
      threadId,
      steerTurnId,
      true,
      new Set([pendingSteer.clientUserMessageId]),
    );
    return {
      mode: "interruptedAndResubmitted",
      turnId: restored.startedTurnId,
      interruptedTurnId: steerTurnId,
      result,
    };
  } catch (error) {
    if (isNoLongerActiveTurnError(error)) {
      const restored = await restorePendingSteersToQueue(
        threadId,
        steerTurnId,
        true,
        new Set([pendingSteer.clientUserMessageId]),
      );
      return {
        mode: "startedAfterTurnEnded",
        turnId: restored.startedTurnId,
        result: null,
      };
    }
    await restorePendingSteersToQueue(
      threadId,
      steerTurnId,
      true,
      new Set([pendingSteer.clientUserMessageId]),
    ).catch(() => undefined);
    throw error;
  }
}

async function interruptTurnWithRaceRetry(threadId: string, turnId: string): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await codex.request("turn/interrupt", { threadId, turnId }, 10_000);
      return;
    } catch (error) {
      lastError = error;
      if (!isNoActiveInterruptError(error)) {
        throw error;
      }
      if (attempt === 7) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
  throw lastError;
}

function waitForTurnCompletion(
  threadId: string,
  turnId: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      codex.off("event", handleEvent);
      reject(new Error(`Timed out waiting for interrupted turn ${turnId} to complete.`));
    }, timeoutMs);
    const handleEvent = (event: AppServerEvent) => {
      if (
        event.type !== "notification" ||
        event.method !== "turn/completed" ||
        getEventThreadId(event) !== threadId ||
        readEventTurnId(event.params) !== turnId
      ) {
        return;
      }
      clearTimeout(timeout);
      codex.off("event", handleEvent);
      resolve();
    };
    codex.on("event", handleEvent);
  });
}

async function startQueuedSubmission(
  threadId: string,
  queuedSubmissionId: string,
  mode: "startedAfterTurnEnded",
): Promise<Record<string, unknown>> {
  const result = await codex.request("thread/queue/start", { threadId, queuedSubmissionId });
  const startedTurnId = readResultTurnId(result);
  if (startedTurnId) {
    activeTurnsByThread.set(threadId, startedTurnId);
    scheduleTurnTimeout(threadId, startedTurnId);
  }
  return { mode, turnId: startedTurnId, result };
}

async function restorePendingSteersToQueue(
  threadId: string,
  turnId?: string,
  startWhenIdle = false,
  clientUserMessageIds?: ReadonlySet<string>,
): Promise<{ restoredSubmissionIds: string[]; startedTurnId: string | null }> {
  const committedClientIds = await readCommittedUserMessageClientIds(threadId);
  let pendingStateChanged = false;
  for (const state of readPendingSteers(threadId)) {
    if (committedClientIds.has(state.clientUserMessageId)) {
      pendingSteers.delete(state.clientUserMessageId);
      pendingStateChanged = true;
    }
  }
  if (pendingStateChanged) {
    await persistPendingSteers();
  }

  const pending = readPendingSteers(threadId).filter(
    (state) =>
      (!turnId || state.turnId === turnId) &&
      (!clientUserMessageIds || clientUserMessageIds.has(state.clientUserMessageId)),
  );
  if (pending.length === 0) {
    return { restoredSubmissionIds: [], startedTurnId: null };
  }

  const existingResult = await codex.request("thread/queue/list", { threadId, cursor: null, limit: 100 });
  const existing = readQueuedSubmissions(existingResult);
  const existingByClientId = new Map(existing.map((item) => [item.clientUserMessageId, item]));
  const restoredIds: string[] = [];
  let restoreError: unknown = null;
  for (const state of pending) {
    const alreadyQueued = existingByClientId.get(state.clientUserMessageId);
    if (alreadyQueued) {
      restoredIds.push(alreadyQueued.id);
      pendingSteers.delete(state.clientUserMessageId);
      pendingStateChanged = true;
      continue;
    }
    try {
      const restored = readQueuedSubmissionResult(
        await codex.request("thread/queue/add", {
          threadId,
          clientUserMessageId: state.clientUserMessageId,
          input: [{ type: "text", text: state.content, text_elements: [] }],
        }),
      );
      restoredIds.push(restored.id);
      pendingSteers.delete(state.clientUserMessageId);
      pendingStateChanged = true;
    } catch (error) {
      restoreError = error;
      break;
    }
  }

  if (pendingStateChanged) {
    await persistPendingSteers();
  }

  if (restoredIds.length > 0) {
    const currentResult = await codex.request("thread/queue/list", { threadId, cursor: null, limit: 100 });
    const current = readQueuedSubmissions(currentResult);
    const restoredIdSet = new Set(restoredIds);
    await codex.request("thread/queue/reorder", {
      threadId,
      queuedSubmissionIds: [
        ...restoredIds,
        ...current.filter((item) => !restoredIdSet.has(item.id)).map((item) => item.id),
      ],
    });
    if (startWhenIdle && !(await readHarnessActiveTurnId(threadId))) {
      const startResult = await codex
        .request("thread/queue/start", { threadId, queuedSubmissionId: restoredIds[0] ?? null })
        .catch(() => null);
      const startedTurnId = readResultTurnId(startResult);
      if (startedTurnId) {
        activeTurnsByThread.set(threadId, startedTurnId);
        scheduleTurnTimeout(threadId, startedTurnId);
      }
      if (restoreError) {
        throw restoreError;
      }
      return { restoredSubmissionIds: restoredIds, startedTurnId };
    }
  }

  if (restoreError) {
    throw restoreError;
  }
  return { restoredSubmissionIds: restoredIds, startedTurnId: null };
}

async function persistPendingSteers(): Promise<void> {
  await pendingSteerStore.save(pendingSteers.snapshot());
}

async function readCommittedUserMessageClientIds(threadId: string): Promise<Set<string>> {
  const result = await readThreadWithStartupRetry(threadId, true);
  if (!isRecord(result) || !isRecord(result.thread) || !Array.isArray(result.thread.turns)) {
    throw new Error("Codex App Server returned invalid thread history while reconciling pending steers.");
  }
  const clientIds = new Set<string>();
  for (const turn of result.thread.turns.filter(isRecord)) {
    const items = Array.isArray(turn.items) ? turn.items.filter(isRecord) : [];
    for (const item of items) {
      if (item.type === "userMessage" && typeof item.clientId === "string") {
        clientIds.add(item.clientId);
      }
    }
  }
  return clientIds;
}

async function findCommittedUserMessageTurnId(
  threadId: string,
  clientUserMessageId: string,
): Promise<string | null> {
  const result = await readThreadWithStartupRetry(threadId, true);
  if (!isRecord(result) || !isRecord(result.thread) || !Array.isArray(result.thread.turns)) {
    throw new Error("Codex App Server returned invalid thread history while locating a queued message.");
  }
  for (const turn of result.thread.turns.filter(isRecord)) {
    const items = Array.isArray(turn.items) ? turn.items.filter(isRecord) : [];
    if (
      items.some(
        (item) => item.type === "userMessage" && item.clientId === clientUserMessageId,
      )
    ) {
      return typeof turn.id === "string" ? turn.id : null;
    }
  }
  return null;
}

async function findCommittedUserMessageTurnIdWithRetry(
  threadId: string,
  clientUserMessageId: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const turnId = await findCommittedUserMessageTurnId(threadId, clientUserMessageId);
    if (turnId) {
      return turnId;
    }
    if (attempt < 7) {
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
  return null;
}

async function readThreadWithStartupRetry(threadId: string, includeTurns: boolean): Promise<unknown> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await codex.request("thread/read", { threadId, includeTurns });
    } catch (error) {
      lastError = error;
      if (!isEmptyRolloutError(error) || attempt === 5) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  throw lastError;
}

function isEmptyRolloutError(error: unknown): boolean {
  return error instanceof Error && /rollout .* is empty/i.test(error.message);
}

function isNoLongerActiveTurnError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /(expected turn is no longer active|no active turn|thread .* active turn|turn .* not active)/i.test(error.message)
  );
}

function isNoActiveInterruptError(error: unknown): boolean {
  return error instanceof Error && /no active turn to interrupt/i.test(error.message);
}

async function ensureThreadLoaded(threadId: string, model?: string): Promise<void> {
  await ensureCommerceWebMcpReady();
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
    config: createRuntimeRequestConfig(),
    developerInstructions: createRuntimeDeveloperInstructions(),
    dynamicTools: createCommerceDynamicToolSpecs(),
    excludeTurns: true,
  });
  loadedThreadIds.add(threadId);
  if (readPendingSteers(threadId).length > 0) {
    // A restarted Gateway may restore application-authorized input to the
    // durable queue, but it must not start billable work without a fresh BFF
    // quota lease.
    await serializeSteerTransition(threadId, () => restorePendingSteersToQueue(threadId, undefined, false));
  }
}

async function ensureCommerceWebMcpReady(forceReload = false): Promise<void> {
  if (!forceReload && managedMcpState.state === "ready" && managedMcpState.available) {
    return;
  }
  if (managedMcpReadyPromise) {
    return managedMcpReadyPromise;
  }

  managedMcpReadyPromise = (async () => {
    managedMcpState = {
      ...managedMcpState,
      state: "loading",
      available: false,
      checkedAt: new Date().toISOString(),
      error: null,
    };
    try {
      await codex.request("config/mcpServer/reload", {}, 30_000);
      const deadline = Date.now() + 20_000;
      let lastStatus = readManagedMcpStatus(null, "commerce_web");
      while (Date.now() < deadline) {
        const result = await codex.request(
          "mcpServerStatus/list",
          { cursor: null, limit: 100, detail: "toolsAndAuthOnly" },
          30_000,
        );
        lastStatus = readManagedMcpStatus(result, "commerce_web");
        if (lastStatus.available && lastStatus.tools.includes("search")) {
          managedMcpState = {
            ...lastStatus,
            state: "ready",
            checkedAt: new Date().toISOString(),
            error: null,
          };
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error(
        `Required MCP tool commerce_web.search was not available; discovered tools: ${lastStatus.tools.join(", ") || "none"}.`,
      );
    } catch (error) {
      managedMcpState = {
        ...managedMcpState,
        state: "failed",
        available: false,
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Managed MCP readiness check failed.",
      };
      throw error;
    } finally {
      managedMcpReadyPromise = null;
    }
  })();

  return managedMcpReadyPromise;
}

function readRequestRuntimeScope(
  req: IncomingMessage,
  rootThreadId: string,
  model: string | null,
): RuntimeScope | null {
  const tenantId = readSingleHeader(req, "x-commerce-tenant-id");
  const workspaceId = readSingleHeader(req, "x-commerce-workspace-id");
  const userId = readSingleHeader(req, "x-commerce-user-id");
  const supplied = [tenantId, workspaceId, userId].filter(Boolean).length;
  if (supplied === 0) {
    if (process.env.NODE_ENV === "production") {
      throw new GatewayRequestError("Enterprise runtime scope is required.", 400);
    }
    return null;
  }
  if (
    supplied !== 3 ||
    !isUuid(tenantId as string) ||
    !isUuid(workspaceId as string) ||
    !userId ||
    userId.length > 255 ||
    /[\r\n\0]/.test(userId)
  ) {
    throw new GatewayRequestError("Invalid enterprise runtime scope.", 400);
  }
  if (config.runtimeTenantId && tenantId !== config.runtimeTenantId) {
    throw new GatewayRequestError("Enterprise tenant is not assigned to this runtime.", 404);
  }
  return {
    tenantId: tenantId as string,
    workspaceId: workspaceId as string,
    userId,
    rootThreadId,
    parentThreadId: null,
    model,
  };
}

function bindRequestRuntimeScope(req: IncomingMessage, threadId: string, model: string | null = null): void {
  const incoming = readRequestRuntimeScope(req, threadId, model);
  if (!incoming) return;
  const existing = threadScopes.get(threadId);
  if (
    existing &&
    (existing.tenantId !== incoming.tenantId ||
      existing.workspaceId !== incoming.workspaceId ||
      existing.userId !== incoming.userId)
  ) {
    throw new GatewayRequestError("Thread runtime scope does not match.", 404);
  }
  threadScopes.set(threadId, {
    ...(existing ?? incoming),
    model: existing?.model ?? model ?? null,
  });
}

function updateThreadRuntimeModel(threadId: string, model: string | null): void {
  const scope = threadScopes.get(threadId);
  if (!scope) return;
  threadScopes.set(threadId, { ...scope, model });
}

function turnModelKey(threadId: string, turnId: string): string {
  return `${threadId}:${turnId}`;
}

function bindTurnModel(threadId: string, turnId: string, requestedModel: string | null): void {
  const key = turnModelKey(threadId, turnId);
  const existing = turnModels.get(key);
  turnModels.set(key, {
    requestedModel: existing?.requestedModel ?? requestedModel,
    effectiveModel: existing?.effectiveModel ?? requestedModel,
  });
}

function readModelReroute(params: unknown): {
  threadId: string;
  turnId: string;
  fromModel: string;
  toModel: string;
} | null {
  if (!isRecord(params)) return null;
  const threadId = typeof params.threadId === "string" ? params.threadId : "";
  const turnId = typeof params.turnId === "string" ? params.turnId : "";
  const fromModel = typeof params.fromModel === "string" ? params.fromModel : "";
  const toModel = typeof params.toModel === "string" ? params.toModel : "";
  return isSafeAgentId(threadId) && isSafeAgentId(turnId) && fromModel && toModel
    ? { threadId, turnId, fromModel, toModel }
    : null;
}

function inheritSubagentRuntimeScope(params: unknown): void {
  if (!isRecord(params) || !isRecord(params.thread)) return;
  const threadId = typeof params.thread.id === "string" ? params.thread.id : "";
  const parentThreadId = typeof params.thread.parentThreadId === "string" ? params.thread.parentThreadId : "";
  if (!isSafeAgentId(threadId) || !isSafeAgentId(parentThreadId)) return;
  const parent = threadScopes.get(parentThreadId);
  if (!parent) return;
  threadScopes.set(threadId, {
    ...parent,
    parentThreadId,
    rootThreadId: parent.rootThreadId,
    model: typeof params.thread.model === "string" ? params.thread.model : parent.model,
  });
}

function readUsageCompletedEvent(
  event: Extract<AppServerEvent, { type: "notification" }>,
): UsageCompletedEvent | null {
  if (!isRecord(event.params)) return null;
  const threadId = typeof event.params.threadId === "string" ? event.params.threadId : "";
  const turnId = typeof event.params.turnId === "string" ? event.params.turnId : "";
  const responseId = typeof event.params.responseId === "string" ? event.params.responseId : "";
  const scope = threadScopes.get(threadId);
  const turnModel = turnModels.get(turnModelKey(threadId, turnId));
  const reportedUsage = isRecord(event.params.usage) ? readUsageBreakdown(event.params.usage) : null;
  const usage = reportedUsage ?? {
    totalTokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
  if (!scope || !isSafeAgentId(threadId) || !isSafeAgentId(turnId) || !responseId) return null;
  return {
    kind: "usage.response.completed",
    eventId: `usage:${scope.tenantId}:${config.provider.id}:${responseId}`,
    ...scope,
    threadId,
    turnId,
    responseId,
    providerId: config.provider.id,
    source: "codex_harness",
    requestedModel: turnModel?.requestedModel ?? scope.model,
    usageStatus: reportedUsage ? "reported" : "missing",
    model: turnModel?.effectiveModel ?? scope.model,
    usage,
    occurredAt: event.at,
  };
}

function readManagedMcpProviderUsageEvent(
  event: Extract<AppServerEvent, { type: "notification" }>,
): UsageCompletedEvent | null {
  if (!isRecord(event.params) || !isRecord(event.params.item)) return null;
  const item = event.params.item;
  if (
    item.type !== "mcpToolCall" ||
    item.server !== "commerce_web" ||
    item.tool !== "search" ||
    item.status !== "completed" ||
    !isRecord(item.result) ||
    !isRecord(item.result._meta) ||
    !isRecord(item.result._meta.commercePilotUsage)
  ) {
    return null;
  }
  const metadata = item.result._meta.commercePilotUsage;
  if (metadata.source !== "commerce_web_mcp" || metadata.providerId !== config.provider.id) return null;
  const threadId = typeof event.params.threadId === "string" ? event.params.threadId : "";
  const turnId = typeof event.params.turnId === "string" ? event.params.turnId : "";
  const itemId = typeof item.id === "string" ? item.id : "";
  const scope = threadScopes.get(threadId);
  if (!scope || !isSafeAgentId(threadId) || !isSafeAgentId(turnId) || !isSafeAgentId(itemId)) return null;
  const responseId =
    typeof metadata.responseId === "string" && metadata.responseId.length <= 255
      ? metadata.responseId
      : `mcp-${itemId}`;
  const model = typeof metadata.model === "string" ? metadata.model : scope.model;
  return createProviderUsageEvent({
    scope,
    source: "commerce_web_mcp",
    responseId,
    threadId,
    turnId,
    model,
    usage: metadata.usage,
    occurredAt: event.at,
  });
}

function createProviderUsageEvent(input: {
  scope: RuntimeScope;
  source: "commerce_web_mcp" | "commerce_web_tool" | "commerce_image_tool";
  responseId: string;
  threadId: string;
  turnId: string;
  model: string | null;
  usage: unknown;
  occurredAt: string;
}): UsageCompletedEvent {
  const turnModel = turnModels.get(turnModelKey(input.threadId, input.turnId));
  const normalized = normalizeProviderUsage(input.usage);
  const { usageStatus, ...usage } = normalized;
  return {
    kind: "usage.response.completed",
    eventId: `usage:${input.scope.tenantId}:${config.provider.id}:${input.responseId}`,
    ...input.scope,
    source: input.source,
    usageStatus,
    requestedModel: turnModel?.requestedModel ?? input.model,
    model: input.model,
    threadId: input.threadId,
    turnId: input.turnId,
    responseId: input.responseId,
    providerId: config.provider.id,
    usage,
    occurredAt: input.occurredAt,
  };
}

function readTurnCompletedOutboxEvent(
  event: Extract<AppServerEvent, { type: "notification" }>,
  threadId: string,
  turnId: string,
): TurnCompletedEvent | null {
  const scope = threadScopes.get(threadId);
  const turnModel = turnModels.get(turnModelKey(threadId, turnId));
  const compaction = compactionStates.get(threadId);
  const status = readTurnCompletionStatus(event.params);
  if (!scope || (status !== "completed" && status !== "interrupted" && status !== "failed")) return null;
  const turn = isRecord(event.params) && isRecord(event.params.turn) ? event.params.turn : null;
  return {
    kind: "turn.completed",
    eventId: `turn:${threadId}:${turnId}:${status}`,
    ...scope,
    model: turnModel?.effectiveModel ?? scope.model,
    threadId,
    turnId,
    status,
    durationMs: turn && typeof turn.durationMs === "number" ? turn.durationMs : null,
    ...(compaction?.turnId === turnId && compaction.admissionRequestId
      ? { requestId: compaction.admissionRequestId }
      : {}),
    occurredAt: event.at,
  };
}

function readUsageBreakdown(value: Record<string, unknown>): UsageCompletedEvent["usage"] | null {
  const keys = [
    "totalTokens",
    "inputTokens",
    "cachedInputTokens",
    "cacheWriteInputTokens",
    "outputTokens",
    "reasoningOutputTokens",
  ] as const;
  const values = Object.fromEntries(
    keys.map((key) => [key, readSafeTokenCount(value[key])]),
  ) as Record<(typeof keys)[number], number | null>;
  if (keys.some((key) => values[key] === null)) return null;
  return values as UsageCompletedEvent["usage"];
}

async function enqueueAgentEvent(event: AgentOutboxEvent): Promise<void> {
  if (!agentEventDeliveryEnabled) return;
  await agentEventOutbox.enqueue(event);
  scheduleAgentEventFlush(0);
}

function scheduleAgentEvent(event: AgentOutboxEvent): void {
  const task = enqueueAgentEvent(event).finally(() => pendingAgentEventWrites.delete(task));
  pendingAgentEventWrites.add(task);
}

function scheduleAgentEventFlush(delayMs: number): void {
  if (!agentEventDeliveryEnabled || agentEventRetryTimer) return;
  agentEventRetryTimer = setTimeout(() => {
    agentEventRetryTimer = null;
    void flushAgentEventOutbox();
  }, delayMs);
  agentEventRetryTimer.unref();
}

async function flushAgentEventOutbox(): Promise<void> {
  if (agentEventFlushPromise) return agentEventFlushPromise;
  if (!agentEventDeliveryEnabled) return;
  agentEventFlushPromise = (async () => {
    let shouldRetry = false;
    const acknowledged: string[] = [];
    try {
      for (const event of agentEventOutbox.list()) {
        const response = await fetch(config.agentEventSinkUrl as string, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Commerce-Gateway-Token": config.internalToken as string,
          },
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok && [400, 404, 409, 422].includes(response.status)) {
          await agentEventOutbox.quarantine(event.eventId, `Agent event sink returned HTTP ${response.status}.`);
          continue;
        }
        if (!response.ok) throw new Error(`Agent event sink returned HTTP ${response.status}.`);
        acknowledged.push(event.eventId);
      }
      await agentEventOutbox.acknowledgeMany(acknowledged);
      agentEventSinkCheckedAt = new Date().toISOString();
      agentEventSinkError = null;
      agentEventRetryAttempt = 0;
    } catch (error) {
      agentEventSinkCheckedAt = new Date().toISOString();
      agentEventSinkError = error instanceof Error ? error.message.slice(0, 300) : "Agent event delivery failed.";
      agentEventRetryAttempt += 1;
      shouldRetry = true;
    } finally {
      agentEventFlushPromise = null;
      if (shouldRetry && !shuttingDown) {
        scheduleAgentEventFlush(Math.min(60_000, 1_000 * 2 ** Math.min(agentEventRetryAttempt, 6)));
      } else if (!shuttingDown && agentEventOutbox.list().length > 0) {
        // An event may have been persisted after this flush captured its list
        // while another caller observed the in-flight promise. Drain again.
        scheduleAgentEventFlush(0);
      }
    }
  })();
  return agentEventFlushPromise;
}

function readEventPipelineHealth(): {
  healthy: boolean;
  deliveryEnabled: boolean;
  pendingEvents: number;
  oldestPendingAgeMs: number;
  deadLetterEvents: number;
} {
  const pending = agentEventOutbox.list();
  const oldestOccurredAt = pending.reduce<number | null>((oldest, event) => {
    const timestamp = Date.parse(event.occurredAt);
    if (!Number.isFinite(timestamp)) return oldest;
    return oldest === null ? timestamp : Math.min(oldest, timestamp);
  }, null);
  const oldestPendingAgeMs = oldestOccurredAt === null ? 0 : Math.max(0, Date.now() - oldestOccurredAt);
  const deadLetterEvents = agentEventOutbox.deadLetterCount();
  const healthInput = {
    deliveryEnabled: agentEventDeliveryEnabled,
    pendingEvents: pending.length,
    oldestPendingAgeMs,
    deadLetterEvents,
    sinkError: agentEventSinkError,
  };
  return {
    healthy: isAgentEventPipelineHealthy(healthInput),
    deliveryEnabled: agentEventDeliveryEnabled,
    pendingEvents: pending.length,
    oldestPendingAgeMs,
    deadLetterEvents,
  };
}

function isEventPipelineWritable(): boolean {
  const health = readEventPipelineHealth();
  return isAgentEventPipelineWritable({
    deliveryEnabled: health.deliveryEnabled,
    pendingEvents: health.pendingEvents,
    oldestPendingAgeMs: health.oldestPendingAgeMs,
    deadLetterEvents: health.deadLetterEvents,
    sinkError: agentEventSinkError,
  });
}

function startRuntimeAuthorizationPoll(): void {
  if (!config.agentAuthorizationUrl || !config.internalToken || runtimeAuthorizationTimer) return;
  runtimeAuthorizationTimer = setInterval(() => {
    void pollRuntimeAuthorizations();
  }, config.authorizationPollMs);
  runtimeAuthorizationTimer.unref();
}

async function pollRuntimeAuthorizations(): Promise<void> {
  if (runtimeAuthorizationPollPromise) return runtimeAuthorizationPollPromise;
  runtimeAuthorizationPollPromise = (async () => {
    const scopes = new Map<string, RuntimeScope>(pendingRuntimeRevocations);
    for (const threadId of activeTurnsByThread.keys()) {
      const scope = threadScopes.get(threadId);
      if (scope) scopes.set(runtimeRootKey(scope), scope);
    }
    await Promise.all(
      [...scopes.entries()].map(async ([key, scope]) => {
        const authorized = await readRuntimeAuthorization(scope);
        if (authorized) {
          pendingRuntimeRevocations.delete(key);
          notifiedRuntimeRevocations.delete(key);
          return;
        }
        pendingRuntimeRevocations.set(key, scope);
        if (!notifiedRuntimeRevocations.has(key)) {
          notifiedRuntimeRevocations.add(key);
          broadcastEvent({
            type: "notification",
            method: "commerce/authorization/revoked",
            params: { threadId: scope.rootThreadId },
            at: new Date().toISOString(),
          });
        }
        if (await revokeRuntimeRoot(scope)) pendingRuntimeRevocations.delete(key);
      }),
    );
  })().finally(() => {
    runtimeAuthorizationPollPromise = null;
  });
  return runtimeAuthorizationPollPromise;
}

async function readRuntimeAuthorization(scope: RuntimeScope): Promise<boolean> {
  if (!config.agentAuthorizationUrl || !config.internalToken) {
    return process.env.NODE_ENV !== "production";
  }
  try {
    const response = await fetch(config.agentAuthorizationUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Commerce-Gateway-Token": config.internalToken,
      },
      body: JSON.stringify({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        rootThreadId: scope.rootThreadId,
        runtimeMaxAgentThreads: config.maxAgentThreadsPerSession,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    runtimeAuthorizationCheckedAt = new Date().toISOString();
    if (!response.ok) {
      runtimeAuthorizationError = `Authorization endpoint returned HTTP ${response.status}.`;
      return false;
    }
    const payload = (await response.json().catch(() => null)) as { authorized?: unknown } | null;
    const authorized = payload?.authorized === true;
    runtimeAuthorizationError = authorized ? null : "Authorization endpoint denied the runtime scope.";
    return authorized;
  } catch (error) {
    runtimeAuthorizationCheckedAt = new Date().toISOString();
    runtimeAuthorizationError = error instanceof Error ? error.message.slice(0, 300) : "Authorization check failed.";
    return false;
  }
}

async function reserveRuntimeCompactionAdmission(
  threadId: string,
  turnId: string | null = null,
): Promise<{ requestId: string | null; attached: boolean } | null> {
  const scope = threadScopes.get(threadId);
  if (!scope || !config.agentAdmissionUrl || !config.internalToken) return null;
  const requestId = randomUUID();
  try {
    const response = await fetch(config.agentAdmissionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Commerce-Gateway-Token": config.internalToken,
      },
      body: JSON.stringify({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        rootThreadId: scope.rootThreadId,
        runtimeMaxAgentThreads: config.maxAgentThreadsPerSession,
        requestId,
        kind: "context_compaction",
        action: turnId ? "attach_or_reserve" : "reserve",
        ...(turnId ? { turnId } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as {
      admitted?: unknown;
      attached?: unknown;
    } | null;
    if (payload?.admitted !== true) return null;
    return payload.attached === true
      ? { requestId: null, attached: true }
      : { requestId, attached: false };
  } catch {
    return null;
  }
}

async function releaseRuntimeCompactionAdmission(threadId: string, requestId: string): Promise<void> {
  const scope = threadScopes.get(threadId);
  if (!scope || !config.agentAdmissionUrl || !config.internalToken) return;
  await fetch(config.agentAdmissionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Commerce-Gateway-Token": config.internalToken,
    },
    body: JSON.stringify({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      rootThreadId: scope.rootThreadId,
      runtimeMaxAgentThreads: config.maxAgentThreadsPerSession,
      requestId,
      kind: "context_compaction",
      action: "release",
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

async function revokeRuntimeRoot(scope: RuntimeScope): Promise<boolean> {
  const key = runtimeRootKey(scope);
  const targets: Array<{ threadId: string; turnId: string }> = [];
  for (const [threadId, turnId] of activeTurnsByThread) {
    const activeScope = threadScopes.get(threadId);
    if (!activeScope || runtimeRootKey(activeScope) !== key) continue;
    targets.push({ threadId, turnId });
  }
  const interruptionResults = await Promise.allSettled(
    targets.map(({ threadId, turnId }) => codex.request("turn/interrupt", { threadId, turnId }, 10_000)),
  );
  const interruptsAccepted = interruptionResults.every((result) => result.status === "fulfilled");
  let queueEmpty = false;
  try {
    await ensureThreadLoaded(scope.rootThreadId);
    queueEmpty = await serializeSteerTransition(scope.rootThreadId, async () => {
      const listed = await codex.request("thread/queue/list", {
        threadId: scope.rootThreadId,
        cursor: null,
        limit: 100,
      });
      for (const queued of readQueuedSubmissions(listed)) {
        await codex.request("thread/queue/delete", {
          threadId: scope.rootThreadId,
          queuedSubmissionId: queued.id,
        });
      }
      const verified = await codex.request("thread/queue/list", {
        threadId: scope.rootThreadId,
        cursor: null,
        limit: 100,
      });
      return readQueuedSubmissions(verified).length === 0;
    });
  } catch {
    queueEmpty = false;
  }
  const activeChecks = await Promise.allSettled(
    targets.map(({ threadId }) => readHarnessActiveTurnId(threadId)),
  );
  const noActiveTurns = activeChecks.every(
    (result) => result.status === "fulfilled" && result.value === null,
  );
  return interruptsAccepted && queueEmpty && noActiveTurns;
}

function runtimeRootKey(scope: RuntimeScope): string {
  return `${scope.tenantId}:${scope.workspaceId}:${scope.userId}:${scope.rootThreadId}`;
}

function readSingleHeader(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function readSafeTokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readEventTurnId(params: unknown): string | null {
  if (!isRecord(params) || !isRecord(params.turn)) {
    return null;
  }
  return typeof params.turn.id === "string" ? params.turn.id : null;
}

function readEventTurnIdFromItemParams(params: unknown): string | null {
  return isRecord(params) && typeof params.turnId === "string" ? params.turnId : null;
}

function readTurnCompletionStatus(params: unknown): string | null {
  if (!isRecord(params) || !isRecord(params.turn)) {
    return null;
  }
  return typeof params.turn.status === "string" ? params.turn.status : null;
}

function isContextCompactionItem(params: unknown): boolean {
  return isRecord(params) && isRecord(params.item) && params.item.type === "contextCompaction";
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
  const contentLength = Number.parseInt(req.headers["content-length"] || "0", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    throw new GatewayRequestError("JSON request body is too large.", 413);
  }
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > MAX_JSON_BODY_BYTES) {
      throw new GatewayRequestError("JSON request body is too large.", 413);
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {} as T;
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new GatewayRequestError("Request body must be valid JSON.", 400);
  }
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
  const threadId = typeof event.params.threadId === "string" ? event.params.threadId : "";
  const turnId = typeof event.params.turnId === "string" ? event.params.turnId : "";
  const callId = typeof event.params.callId === "string" ? event.params.callId : "";
  const scope = threadScopes.get(threadId);
  if (
    !scope ||
    !isSafeAgentId(threadId) ||
    !isSafeAgentId(turnId) ||
    !isSafeAgentId(callId)
  ) {
    throw new Error("Commerce tool calls require a bound enterprise thread, turn, and call id.");
  }
  if (!isEventPipelineWritable()) {
    throw new Error("Enterprise usage event pipeline requires operator attention.");
  }
  if (!(await readRuntimeAuthorization(scope))) {
    throw new Error("Enterprise authorization was revoked before the commerce tool call.");
  }
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
    await enqueueAgentEvent(
      createProviderUsageEvent({
        scope,
        source: "commerce_web_tool",
        responseId: result.responseId ?? `web-${callId}`,
        threadId,
        turnId,
        model: result.model,
        usage: result.usage,
        occurredAt: new Date().toISOString(),
      }),
    );
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
  const saved = await generatedImages.save({
    base64: generated.base64,
    threadId,
    turnId,
    callId: typeof event.params.callId === "string" ? event.params.callId : null,
    model: generated.model,
    mimeType: generated.mimeType,
    quality: generated.quality,
    size: generated.size,
  });
  await enqueueAgentEvent(
    createProviderUsageEvent({
      scope,
      source: "commerce_image_tool",
      responseId: generated.responseId ?? `image-${callId}`,
      threadId,
      turnId,
      model: generated.model,
      usage: generated.usage,
      occurredAt: new Date().toISOString(),
    }),
  );
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

function createCommerceDynamicToolSpecs(): Record<string, unknown>[] {
  return [createCommerceImageToolSpec()];
}

function createRuntimeRequestConfig(): Record<string, unknown> {
  return {
    web_search: "live",
    ...(process.env.NODE_ENV === "production" ? {} : { bypass_hook_trust: true }),
  };
}

function createRuntimeDeveloperInstructions(): string {
  return [
    "Commerce Pilot is a hosted e-commerce agent, not a local coding agent.",
    "Use only application-registered dynamic tools and application-managed MCP tools. Never run shell commands, inspect or modify host files, spawn processes, use local developer tools, or request additional filesystem or network permissions.",
    "If a requested capability has no registered tool, explain that it is unavailable instead of attempting a local workaround.",
    "Commerce Pilot provides the host tool `commerce_image.generate` for bitmap image generation.",
    `It is backed by ${config.provider.imageModel} through the configured application provider.`,
    "Use it when the user asks to generate an image. Do not claim image generation is unavailable while this tool is present.",
    "A completed tool result contains the authoritative publicUrl. Do not retry a completed generation because it omits inline image bytes.",
    "Use quality=low only for explicit drafts or probes; otherwise use quality=auto.",
    "Commerce Pilot provides MCP server `commerce_web` with tool `search` for live web research through the configured provider; its model-facing identifier may appear as `mcp__commerce_web__search`.",
    "The current tool catalog is authoritative over older conversation messages that claimed Web Search was missing.",
    "Use that MCP Web Search tool whenever the user explicitly asks to search the web or when current external information is required. Do not look for a dynamic tool named `commerce_web.search`. Cite returned source URLs and never claim Web Search is unavailable while the MCP tool is present.",
    "If one search call fails or times out, retry once with a shorter and more specific query before reporting the provider failure. Do not tell the user to enable, install, or register Web Search when the tool is already present.",
  ].join(" ");
}

function readImageQuality(value: unknown): ImageGenerationInput["quality"] {
  return value === "low" || value === "medium" || value === "high" || value === "auto" ? value : "auto";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
