import "dotenv/config";

import { randomUUID, timingSafeEqual } from "node:crypto";
import { rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";

import { CodexAppServerClient } from "../codex/app-server-client.js";
import {
  buildExplicitSkillTurn,
  CODEX_SKILL_NAME_PATTERN,
  readVisibleExplicitSkillMessage,
  resolveExplicitSkillFromCatalog,
} from "../codex/explicit-skill.js";
import { buildManagedWorkflowTurn, isManagedWorkflowId } from "../codex/managed-workflows.js";
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
import {
  ManagedSkillStore,
  validateManagedSkillDraft,
  type ManagedSkillDraft,
} from "./managed-skill-store.js";
import { readManagedMcpStatus, type ManagedMcpStatus } from "./managed-mcp-status.js";
import {
  PendingSteerRegistry,
  ThreadOperationQueue,
  type PendingSteerState,
} from "./pending-steer-state.js";
import { PendingSteerStore } from "./pending-steer-store.js";
import {
  formatRequestUserInputAnswerMessage,
  normalizeRequestUserInputAnswers,
  readPendingRequestUserInput,
  serializePendingRequestUserInput,
  type PendingRequestUserInput,
} from "./request-user-input.js";
import {
  AgentEventOutbox,
  type AgentOutboxEvent,
  type RuntimeScope,
  type SkillPublishedEvent,
  type TurnCompletedEvent,
  type UsageCompletedEvent,
} from "./agent-event-outbox.js";
import {
  isAgentEventPipelineHealthy,
  isAgentEventPipelineWritable,
} from "./agent-event-pipeline-health.js";
import { AgentOutboxProcessLock } from "./agent-outbox-process-lock.js";
import {
  sanitizeBrowserAppServerEvent,
  stripAttachmentContextBlocks,
} from "./browser-event-sanitizer.js";
import {
  MAX_THREAD_ATTACHMENT_BYTES,
  MAX_THREAD_ATTACHMENTS_PER_TURN,
  MAX_THREAD_ATTACHMENT_TOTAL_BYTES,
  ThreadArtifactStore,
  type ThreadArtifact,
} from "./thread-artifact-store.js";

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

type PendingSkillPublishApproval = {
  requestId: string;
  draft: ManagedSkillDraft;
  scope: RuntimeScope;
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
const threadArtifacts = new ThreadArtifactStore(config.codexHome);
const managedSkills = new ManagedSkillStore(config.runtimeRoot);
const pendingRequestUserInputs = new Map<string, PendingRequestUserInput>();
const pendingSkillPublishApprovals = new Map<string, PendingSkillPublishApproval>();
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
const managedMcpReadyThreadIds = new Set<string>();
const managedMcpThreadReadyPromises = new Map<string, Promise<void>>();
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
  "commerce/skillPublish/completed",
  "commerce/contextCompaction/started",
  "commerce/contextCompaction/failed",
  "commerce/authorization/revoked",
  "thread/queue/changed",
  "thread/deleted",
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
    pendingRequestUserInputs.clear();
    pendingSkillPublishApprovals.clear();
    managedMcpReadyPromise = null;
    managedMcpReadyThreadIds.clear();
    managedMcpThreadReadyPromises.clear();
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
    if (event.method === "serverRequest/resolved" && isRecord(event.params)) {
      const requestId = event.params.requestId;
      if (typeof requestId === "string" || typeof requestId === "number") {
        const resolvedId = String(requestId);
        for (const [pendingId, pending] of pendingRequestUserInputs) {
          if (String(pending.id) !== resolvedId) continue;
          pendingRequestUserInputs.delete(pendingId);
          pendingSkillPublishApprovals.delete(pendingId);
        }
      }
    }
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
  if (event.method === "item/tool/requestUserInput" || event.method === "tool/requestUserInput") {
    const pending = readPendingRequestUserInput(event);
    if (!pending) {
      codex.rejectServerRequest(event.id, {
        code: -32602,
        message: "Invalid request_user_input payload.",
      });
      return;
    }
    pendingRequestUserInputs.set(pending.requestId, pending);
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
          titleModel: config.titleModel,
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

    if (req.method === "GET" && url.pathname === "/api/skills") {
      const result = await codex.request("skills/list", {
        cwds: [config.runtimeRoot],
        forceReload: true,
      });
      sendJson(res, 200, readBrowserSkillInventory(result));
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
        managedMcpReadyThreadIds.add(startedThreadId);
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
    if (req.method === "DELETE" && threadReadMatch) {
      const threadId = decodeURIComponent(threadReadMatch[1] ?? "");
      if (!isSafeAgentId(threadId)) {
        sendJson(res, 400, { error: "Invalid thread id." });
        return;
      }
      bindRequestRuntimeScope(req, threadId);
      const result = await permanentlyDeleteThreadTree(threadId);
      sendJson(res, 200, result);
      return;
    }
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
      const attachments = await threadArtifacts.listForThread(threadId);
      sendJson(res, 200, { result, generatedImages: generatedImageArtifacts, attachments });
      return;
    }

    const threadAttachmentsMatch = matchPath(url.pathname, /^\/api\/threads\/([^/]+)\/attachments$/);
    if (req.method === "POST" && threadAttachmentsMatch) {
      const threadId = decodeURIComponent(threadAttachmentsMatch[1] ?? "");
      if (!isSafeAgentId(threadId)) {
        sendJson(res, 400, { error: "Invalid thread id." });
        return;
      }
      bindRequestRuntimeScope(req, threadId);
      const scope = threadScopes.get(threadId);
      if (!scope) throw new GatewayRequestError("Attachment upload requires an enterprise scope.", 400);
      const clientRequestId = readSingleHeader(req, "x-commerce-client-request-id") ?? "";
      const encodedFilename = readSingleHeader(req, "x-commerce-filename") ?? "";
      const originalName = decodeHeaderComponent(encodedFilename, "attachment filename");
      const existing = (await threadArtifacts.listForThread(threadId))
        .filter((artifact) => artifact.clientRequestId === clientRequestId);
      if (existing.length >= MAX_THREAD_ATTACHMENTS_PER_TURN) {
        throw new GatewayRequestError("Too many attachments for one turn.", 413);
      }
      const bytes = await readRawBody(req, MAX_THREAD_ATTACHMENT_BYTES);
      const existingBytes = existing.reduce((total, artifact) => total + artifact.size, 0);
      if (existingBytes + bytes.byteLength > MAX_THREAD_ATTACHMENT_TOTAL_BYTES) {
        throw new GatewayRequestError("Attachment total exceeds the turn limit.", 413);
      }
      const artifact = await threadArtifacts.save({
        threadId,
        scope,
        clientRequestId,
        originalName,
        declaredMimeType: readSingleHeader(req, "content-type") ?? "",
        bytes,
      });
      sendJson(res, 201, { artifact });
      return;
    }

    const threadAttachmentContentMatch = matchPath(
      url.pathname,
      /^\/api\/threads\/([^/]+)\/attachments\/([^/]+)\/content$/,
    );
    if (req.method === "GET" && threadAttachmentContentMatch) {
      const threadId = decodeURIComponent(threadAttachmentContentMatch[1] ?? "");
      const artifactId = decodeURIComponent(threadAttachmentContentMatch[2] ?? "");
      if (!isSafeAgentId(threadId)) {
        sendJson(res, 400, { error: "Invalid thread id." });
        return;
      }
      bindRequestRuntimeScope(req, threadId);
      const scope = threadScopes.get(threadId);
      if (!scope) throw new GatewayRequestError("Attachment read requires an enterprise scope.", 400);
      const artifact = await threadArtifacts.get(threadId, artifactId);
      if (!artifact) {
        sendJson(res, 404, { error: "Attachment not found." });
        return;
      }
      threadArtifacts.assertReadableByScope(artifact, scope);
      const content = await threadArtifacts.readContent(artifact);
      res.writeHead(200, {
        "Content-Type": artifact.mimeType,
        "Content-Length": content.byteLength,
        "Content-Disposition": `${artifact.kind === "image" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(artifact.originalName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(content);
      return;
    }

    const threadAttachmentMatch = matchPath(
      url.pathname,
      /^\/api\/threads\/([^/]+)\/attachments\/([^/]+)$/,
    );
    if (req.method === "DELETE" && threadAttachmentMatch) {
      const threadId = decodeURIComponent(threadAttachmentMatch[1] ?? "");
      const artifactId = decodeURIComponent(threadAttachmentMatch[2] ?? "");
      if (!isSafeAgentId(threadId)) {
        sendJson(res, 400, { error: "Invalid thread id." });
        return;
      }
      bindRequestRuntimeScope(req, threadId);
      const scope = threadScopes.get(threadId);
      if (!scope) throw new GatewayRequestError("Attachment removal requires an enterprise scope.", 400);
      const clientRequestId = readSingleHeader(req, "x-commerce-client-request-id") ?? "";
      const removed = await threadArtifacts.removePending(threadId, artifactId, scope, clientRequestId);
      sendJson(res, 200, { removed });
      return;
    }

    const threadTitleMatch = matchPath(url.pathname, /^\/api\/threads\/([^/]+)\/title$/);
    if (req.method === "POST" && threadTitleMatch) {
      const threadId = decodeURIComponent(threadTitleMatch[1] ?? "");
      if (!isSafeAgentId(threadId)) {
        sendJson(res, 400, { error: "Invalid thread id." });
        return;
      }
      bindRequestRuntimeScope(req, threadId, config.titleModel);
      await ensureThreadLoaded(threadId);
      const result = await readThreadWithStartupRetry(threadId, true);
      const titleContext = readThreadTitleContext(result);
      if (!titleContext) {
        sendJson(res, 409, { error: "Thread has no completed result for title generation." });
        return;
      }
      const generated = await provider.generateThreadTitle({
        model: config.titleModel,
        userText: titleContext.userText,
        assistantText: titleContext.assistantText,
      });
      await codex.request("thread/name/set", { threadId, name: generated.title });
      const scope = threadScopes.get(threadId);
      if (scope) {
        await enqueueAgentEvent(
          createProviderUsageEvent({
            scope,
            source: "title_generation",
            responseId: generated.responseId ?? `title-${randomUUID()}`,
            threadId,
            turnId: titleContext.turnId,
            model: generated.model,
            usage: generated.usage,
            occurredAt: new Date().toISOString(),
          }),
        );
      }
      sendJson(res, 200, {
        title: generated.title,
        model: generated.model,
        category: generated.category,
      });
      return;
    }

    const pendingUserInputMatch = matchPath(url.pathname, /^\/api\/threads\/([^/]+)\/user-input$/);
    if (req.method === "GET" && pendingUserInputMatch) {
      const threadId = decodeURIComponent(pendingUserInputMatch[1] ?? "");
      if (!isSafeAgentId(threadId)) {
        sendJson(res, 400, { error: "Invalid thread id." });
        return;
      }
      bindRequestRuntimeScope(req, threadId);
      sendJson(res, 200, {
        requests: Array.from(pendingRequestUserInputs.values())
          .filter((request) => request.threadId === threadId)
          .map(serializePendingRequestUserInput),
      });
      return;
    }

    const userInputResponseMatch = matchPath(
      url.pathname,
      /^\/api\/threads\/([^/]+)\/user-input\/([^/]+)$/,
    );
    if (req.method === "POST" && userInputResponseMatch) {
      const threadId = decodeURIComponent(userInputResponseMatch[1] ?? "");
      const requestId = decodeURIComponent(userInputResponseMatch[2] ?? "");
      if (!isSafeAgentId(threadId) || !requestId || requestId.length > 128) {
        sendJson(res, 400, { error: "Invalid user-input request." });
        return;
      }
      bindRequestRuntimeScope(req, threadId);
      const pending = pendingRequestUserInputs.get(requestId);
      if (!pending || pending.threadId !== threadId) {
        sendJson(res, 404, { error: "Pending user-input request not found." });
        return;
      }
      const body = await readJsonBody<{ answers?: unknown }>(req);
      const answers = normalizeRequestUserInputAnswers(body.answers, pending.questions);
      if (!answers) {
        sendJson(res, 400, { error: "Invalid user-input answers." });
        return;
      }
      const answerMessage = formatRequestUserInputAnswerMessage(pending.questions, answers);
      const answerPersisted = answerMessage
        ? await injectUserInputAnswer(threadId, answerMessage)
        : false;
      const skillApproval = pendingSkillPublishApprovals.get(requestId);
      if (skillApproval) {
        await resolveSkillPublishApproval(pending, skillApproval, answers);
        pendingRequestUserInputs.delete(requestId);
        pendingSkillPublishApprovals.delete(requestId);
        sendJson(res, 200, {
          accepted: true,
          requestId,
          published: answers.publish_skill?.answers[0] === "发布",
          answerMessage,
          answerPersisted,
        });
        return;
      }
      pendingRequestUserInputs.delete(requestId);
      codex.respondToServerRequest(pending.id, { answers });
      sendJson(res, 200, { accepted: true, requestId, answerMessage, answerPersisted });
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
      const attachmentIds = readAttachmentIds(body.attachmentIds);
      if ((!message && attachmentIds.length === 0) || message.length > 50_000) {
        sendJson(res, 400, { error: "Expected a message or at least one attachment." });
        return;
      }
      if (body.workflow !== undefined && !isManagedWorkflowId(body.workflow)) {
        sendJson(res, 400, { error: "Unknown managed workflow." });
        return;
      }
      const workflow = isManagedWorkflowId(body.workflow) ? body.workflow : null;
      const skillName = typeof body.skillName === "string" ? body.skillName.trim() : "";
      if (body.skillName !== undefined && !CODEX_SKILL_NAME_PATTERN.test(skillName)) {
        sendJson(res, 400, { error: "Invalid Skill name." });
        return;
      }
      if (workflow && skillName) {
        sendJson(res, 400, { error: "A managed workflow and an explicit Skill cannot be combined." });
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
          if (workflow || skillName || attachmentIds.length) {
            sendJson(res, 409, {
              error: "Skill and attachment turns cannot be queued behind an active turn.",
              code: workflow
                ? "MANAGED_WORKFLOW_ACTIVE_TURN"
                : skillName
                  ? "EXPLICIT_SKILL_ACTIVE_TURN"
                  : "ATTACHMENT_ACTIVE_TURN",
            });
            return;
          }
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
        const scope = threadScopes.get(threadId);
        if (attachmentIds.length && !scope) {
          throw new GatewayRequestError("Attachment turns require an enterprise scope.", 400);
        }
        const attachments = attachmentIds.length
          ? await readBoundTurnAttachments(threadId, attachmentIds, scope as RuntimeScope, clientUserMessageId)
          : [];
        const turnMessage = formatTurnMessageWithAttachments(message, attachments);
        const managedWorkflowTurn = workflow
          ? buildManagedWorkflowTurn(config.runtimeRoot, workflow, turnMessage)
          : null;
        const explicitSkillTurn = skillName
          ? buildExplicitSkillTurn(
              await resolveExplicitSkill(skillName),
              turnMessage,
            )
          : null;
        const attachmentInputs = attachments.length
          ? await threadArtifacts.buildTurnInputs(
              threadId,
              attachmentIds,
              scope as RuntimeScope,
              clientUserMessageId,
            )
          : [];
        const baseInput = managedWorkflowTurn?.input ??
          explicitSkillTurn?.input ??
          [{ type: "text", text: turnMessage, text_elements: [] }];
        const result = await codex
          .request("turn/start", {
            threadId,
            clientUserMessageId,
            input: [...baseInput, ...attachmentInputs],
            model: body.model,
            effort: body.effort,
            outputSchema: managedWorkflowTurn?.outputSchema,
          })
          .finally(() => {
            if (pendingTurnModels.get(threadId) === requestedModel) pendingTurnModels.delete(threadId);
          });
        const startedTurnId = readResultTurnId(result);
        if (startedTurnId) {
          if (attachmentIds.length) await threadArtifacts.bindToTurn(threadId, attachmentIds, startedTurnId);
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
        "DELETE /api/threads/:threadId",
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
  if (event.method === "mcpServer/startupStatus/updated") {
    const params = isRecord(event.params) ? event.params : {};
    if (
      params.name === "commerce_web" &&
      typeof params.threadId === "string" &&
      params.status !== "ready"
    ) {
      managedMcpReadyThreadIds.delete(params.threadId);
    }
    return;
  }
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

function readThreadTitleContext(result: unknown): {
  userText: string;
  assistantText: string;
  turnId: string;
} | null {
  if (!isRecord(result) || !isRecord(result.thread) || !Array.isArray(result.thread.turns)) return null;
  let userText = "";
  let assistantText = "";
  let assistantTurnId = "";
  for (const turn of result.thread.turns.filter(isRecord)) {
    const turnId = typeof turn.id === "string" ? turn.id : "";
    const items = Array.isArray(turn.items) ? turn.items.filter(isRecord) : [];
    for (const item of items) {
      if (item.type === "userMessage" && !userText && Array.isArray(item.content)) {
        userText = stripAttachmentContextBlocks(readVisibleExplicitSkillMessage(
          item.content
            .filter(isRecord)
            .filter((content) => content.type === "text" && typeof content.text === "string")
            .map((content) => content.text as string)
            .join("\n")
            .trim(),
        ));
      }
      if (
        item.type === "agentMessage" &&
        typeof item.text === "string" &&
        item.text.trim() &&
        item.phase !== "commentary"
      ) {
        assistantText = item.text.trim();
        assistantTurnId = turnId;
      }
    }
  }
  return userText && assistantText && assistantTurnId
    ? { userText, assistantText, turnId: assistantTurnId }
    : null;
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

async function permanentlyDeleteThreadTree(threadId: string): Promise<{
  deleted: true;
  threadIds: string[];
  generatedImagesDeleted: number;
  generatedImageMetadataDeleted: number;
  artifactDirectoriesDeleted: number;
}> {
  return threadOperations.run(threadId, async () => {
    const scope = threadScopes.get(threadId);
    if (!scope) throw new Error("Thread deletion requires a bound enterprise scope.");
    if (!(await readRuntimeAuthorization(scope))) {
      throw new Error("Enterprise authorization was revoked before thread deletion.");
    }
    const threadIds = await listThreadTreeIds(threadId);
    await interruptThreadTree(threadIds, scope.rootThreadId);
    await codex.request("thread/delete", { threadId }, 60_000);
    const imageDeletion = await generatedImages.deleteForThreads(threadIds);
    let artifactDirectoriesDeleted = 0;
    for (const deletedThreadId of threadIds) {
      const artifactDirectory = join(config.codexHome, "thread_artifacts", deletedThreadId);
      try {
        await rm(artifactDirectory, { recursive: true, force: false });
        artifactDirectoriesDeleted += 1;
      } catch (error) {
        if (!isNodeNotFoundError(error)) throw error;
      }
    }
    await clearDeletedThreadRuntimeState(threadIds);
    return {
      deleted: true,
      threadIds,
      generatedImagesDeleted: imageDeletion.files,
      generatedImageMetadataDeleted: imageDeletion.metadata,
      artifactDirectoriesDeleted,
    };
  });
}

async function listThreadTreeIds(rootThreadId: string): Promise<string[]> {
  const ids = new Set([rootThreadId]);
  for (const archived of [false, true]) {
    let cursor: string | null = null;
    do {
      const result = await codex.request(
        "thread/list",
        {
          cursor,
          limit: 100,
          archived,
          ancestorThreadId: rootThreadId,
        },
        30_000,
      );
      if (!isRecord(result)) throw new Error("App Server returned an invalid thread tree.");
      const data = Array.isArray(result.data) ? result.data.filter(isRecord) : [];
      for (const thread of data) {
        if (typeof thread.id === "string" && isSafeAgentId(thread.id)) ids.add(thread.id);
      }
      cursor = typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : null;
    } while (cursor);
  }
  return [...ids];
}

async function interruptThreadTree(threadIds: string[], rootThreadId: string): Promise<void> {
  const targets = [...activeTurnsByThread.entries()].filter(([candidate]) => {
    const candidateScope = threadScopes.get(candidate);
    return threadIds.includes(candidate) || candidateScope?.rootThreadId === rootThreadId;
  });
  await Promise.all(
    targets.map(async ([candidateThreadId, turnId]) => {
      const completion = waitForTurnCompletion(candidateThreadId, turnId, 12_000).catch(() => null);
      await codex
        .request("turn/interrupt", { threadId: candidateThreadId, turnId }, 10_000)
        .catch((error) => {
          if (!isNoActiveInterruptError(error) && !isNoLongerActiveTurnError(error)) throw error;
        });
      await completion;
    }),
  );
}

async function clearDeletedThreadRuntimeState(threadIds: string[]): Promise<void> {
  let pendingSteersChanged = false;
  for (const deletedThreadId of threadIds) {
    const activeTurnId = activeTurnsByThread.get(deletedThreadId);
    if (activeTurnId) clearTurnTimeout(activeTurnId);
    activeTurnsByThread.delete(deletedThreadId);
    loadedThreadIds.delete(deletedThreadId);
    turnStartReservations.delete(deletedThreadId);
    latestContextUsage.delete(deletedThreadId);
    pendingTurnModels.delete(deletedThreadId);
    threadScopes.delete(deletedThreadId);
    managedMcpReadyThreadIds.delete(deletedThreadId);
    managedMcpThreadReadyPromises.delete(deletedThreadId);
    const compaction = compactionStates.get(deletedThreadId);
    if (compaction?.timeout) clearTimeout(compaction.timeout);
    compactionStates.delete(deletedThreadId);
    for (const pending of readPendingSteers(deletedThreadId)) {
      pendingSteersChanged = pendingSteers.delete(pending.clientUserMessageId) || pendingSteersChanged;
    }
    for (const [requestId, pending] of pendingRequestUserInputs) {
      if (pending.threadId !== deletedThreadId) continue;
      pendingRequestUserInputs.delete(requestId);
      pendingSkillPublishApprovals.delete(requestId);
    }
    for (const key of turnModels.keys()) {
      if (key.startsWith(`${deletedThreadId}:`)) turnModels.delete(key);
    }
  }
  if (pendingSteersChanged) await persistPendingSteers();
}

function isNodeNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

async function ensureThreadLoaded(threadId: string, model?: string): Promise<void> {
  await ensureCommerceWebMcpReady();
  if (loadedThreadIds.has(threadId)) {
    await ensureCommerceWebMcpReadyForThread(threadId);
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
  await ensureCommerceWebMcpReadyForThread(threadId);
  if (readPendingSteers(threadId).length > 0) {
    // A restarted Gateway may restore application-authorized input to the
    // durable queue, but it must not start billable work without a fresh BFF
    // quota lease.
    await serializeSteerTransition(threadId, () => restorePendingSteersToQueue(threadId, undefined, false));
  }
}

async function ensureCommerceWebMcpReadyForThread(threadId: string): Promise<void> {
  if (managedMcpReadyThreadIds.has(threadId)) return;
  const existing = managedMcpThreadReadyPromises.get(threadId);
  if (existing) return existing;

  const promise = (async () => {
    // App Server reload refreshes already-loaded threads. A global-ready MCP
    // catalog alone does not prove that a resumed thread received the tool.
    await codex.request("config/mcpServer/reload", {}, 30_000);
    const deadline = Date.now() + 20_000;
    let lastStatus = readManagedMcpStatus(null, "commerce_web");
    while (Date.now() < deadline) {
      const result = await codex.request(
        "mcpServerStatus/list",
        { threadId, cursor: null, limit: 100, detail: "toolsAndAuthOnly" },
        30_000,
      );
      lastStatus = readManagedMcpStatus(result, "commerce_web");
      if (lastStatus.available && lastStatus.tools.includes("search")) {
        managedMcpReadyThreadIds.add(threadId);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new GatewayRequestError(
      `Thread ${threadId} did not receive required MCP tool commerce_web.search; discovered tools: ${lastStatus.tools.join(", ") || "none"}.`,
      503,
    );
  })().finally(() => managedMcpThreadReadyPromises.delete(threadId));
  managedMcpThreadReadyPromises.set(threadId, promise);
  return promise;
}

async function ensureCommerceWebMcpReady(forceReload = false): Promise<void> {
  if (!forceReload && managedMcpState.state === "ready" && managedMcpState.available) {
    return;
  }
  if (managedMcpReadyPromise) {
    return managedMcpReadyPromise;
  }

  managedMcpReadyPromise = (async () => {
    if (forceReload) managedMcpReadyThreadIds.clear();
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
  source: "commerce_web_mcp" | "commerce_web_tool" | "commerce_image_tool" | "title_generation";
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

function createSkillPublishedEvent(input: {
  scope: RuntimeScope;
  threadId: string;
  turnId: string;
  skillName: string;
  operation: "created" | "updated" | "unchanged";
  contentHash: string;
  occurredAt: string;
}): SkillPublishedEvent {
  return {
    kind: "skill.published",
    eventId: `skill:${input.scope.tenantId}:${input.scope.workspaceId}:${input.skillName}:${input.contentHash}`,
    ...input.scope,
    model: input.scope.model,
    threadId: input.threadId,
    turnId: input.turnId,
    skillName: input.skillName,
    operation: input.operation,
    contentHash: input.contentHash,
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
  const browserNotification = event.type === "notification" && browserEventMethods.has(event.method);
  const browserUserInputRequest =
    event.type === "server_request" &&
    (event.method === "item/tool/requestUserInput" || event.method === "tool/requestUserInput");
  if (!browserNotification && !browserUserInputRequest) {
    return;
  }
  const browserEvent = sanitizeBrowserAppServerEvent(event);
  const payload = `event: ${browserEvent.type}\ndata: ${JSON.stringify(browserEvent)}\n\n`;
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

async function readRawBody(req: IncomingMessage, maximumBytes: number): Promise<Buffer> {
  const contentLength = Number.parseInt(req.headers["content-length"] || "0", 10);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new GatewayRequestError("Attachment is too large.", 413);
  }
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > maximumBytes) throw new GatewayRequestError("Attachment is too large.", 413);
    chunks.push(buffer);
  }
  if (!chunks.length) throw new GatewayRequestError("Attachment body is empty.", 400);
  return Buffer.concat(chunks);
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
  if (namespace === "commerce_skill" && tool === "publish") {
    const draft = validateManagedSkillDraft(isRecord(event.params.arguments) ? event.params.arguments : {});
    const requestId = `skill_${callId}`;
    if (pendingRequestUserInputs.has(requestId)) {
      throw new Error("This Skill publish request is already waiting for approval.");
    }
    const pending: PendingRequestUserInput = {
      id: event.id,
      requestId,
      threadId,
      turnId,
      itemId: callId,
      questions: [
        {
          id: "publish_skill",
          header: "发布技能",
          question: `将“${draft.displayName}”发布到当前 Commerce Pilot 技能目录？`,
          isOther: false,
          isSecret: false,
          options: [
            {
              label: "发布",
              description: "通过应用校验后创建或更新这个纯指令技能，并立即加入 Agent 技能目录。",
            },
            {
              label: "取消",
              description: "不写入任何技能文件，当前工具调用会安全结束。",
            },
          ],
        },
      ],
      isBlocking: true,
      receivedAt: new Date().toISOString(),
      action: "skill.publish",
    };
    pendingRequestUserInputs.set(requestId, pending);
    pendingSkillPublishApprovals.set(requestId, { requestId, draft, scope });
    broadcastEvent({
      type: "server_request",
      id: requestId,
      method: "tool/requestUserInput",
      params: serializePendingRequestUserInput(pending),
      at: pending.receivedAt,
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

async function resolveSkillPublishApproval(
  pending: PendingRequestUserInput,
  approval: PendingSkillPublishApproval,
  answers: Record<string, { answers: string[] }>,
): Promise<void> {
  const selection = answers.publish_skill?.answers[0];
  if (selection !== "发布") {
    codex.respondToServerRequest(pending.id, {
      success: true,
      contentItems: [
        {
          type: "inputText",
          text: JSON.stringify({
            status: "cancelled",
            instruction: "The user cancelled Skill publication. Do not claim that the Skill was created.",
          }),
        },
      ],
    });
    return;
  }
  const activeScope = threadScopes.get(pending.threadId);
  if (!activeScope || runtimeRootKey(activeScope) !== runtimeRootKey(approval.scope) || activeScope.userId !== approval.scope.userId) {
    throw new Error("Skill publish approval no longer belongs to the active Commerce Pilot principal.");
  }
  if (!isEventPipelineWritable() || !(await readRuntimeAuthorization(activeScope))) {
    throw new Error("Commerce Pilot authorization changed before Skill publication.");
  }
  const published = await managedSkills.publish(approval.draft, activeScope);
  const inventory = await codex.request(
    "skills/list",
    { cwds: [config.runtimeRoot], forceReload: true },
    30_000,
  );
  if (!skillCatalogContains(inventory, published.name)) {
    throw new Error("App Server did not discover the published Skill during readback.");
  }
  await enqueueAgentEvent(
    createSkillPublishedEvent({
      scope: activeScope,
      threadId: pending.threadId,
      turnId: pending.turnId,
      skillName: published.name,
      operation: published.operation,
      contentHash: published.contentHash,
      occurredAt: new Date().toISOString(),
    }),
  );
  codex.respondToServerRequest(pending.id, {
    success: true,
    contentItems: [
      {
        type: "inputText",
        text: JSON.stringify({
          status: "completed",
          name: published.name,
          displayName: published.displayName,
          operation: published.operation,
          instruction: "The Skill was validated, published, and discovered by App Server. Report this readback to the user.",
        }),
      },
    ],
  });
  broadcastEvent({
    type: "notification",
    method: "commerce/skillPublish/completed",
    params: {
      threadId: pending.threadId,
      turnId: pending.turnId,
      callId: pending.itemId,
      name: published.name,
      displayName: published.displayName,
      operation: published.operation,
    },
    at: new Date().toISOString(),
  });
}

async function injectUserInputAnswer(threadId: string, answerMessage: string): Promise<boolean> {
  try {
    await codex.request(
      "thread/inject_items",
      {
        threadId,
        items: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: answerMessage }],
          },
        ],
      },
      10_000,
    );
    return true;
  } catch {
    return false;
  }
}

function skillCatalogContains(value: unknown, name: string): boolean {
  if (!isRecord(value) || !Array.isArray(value.data)) return false;
  const entry = value.data.find((item) => isRecord(item) && item.cwd === config.runtimeRoot);
  return Boolean(
    isRecord(entry) &&
      Array.isArray(entry.skills) &&
      entry.skills.some((skill) => isRecord(skill) && skill.name === name && skill.enabled !== false),
  );
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

function createCommerceSkillToolSpec(): Record<string, unknown> {
  return {
    type: "namespace",
    name: "commerce_skill",
    description: "Create or update an instruction-only Commerce Pilot Skill through application validation and explicit user approval.",
    tools: [
      {
        type: "function",
        name: "publish",
        description: "Publish a validated instruction-only Skill. This call pauses for explicit user approval and never accepts a filesystem path or executable scripts.",
        deferLoading: false,
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: {
              type: "string",
              pattern: "^commerce-[a-z0-9]+(?:-[a-z0-9]+)*$",
              description: "Stable unreserved commerce-* skill slug.",
            },
            displayName: {
              type: "string",
              description: "Short user-facing Chinese or English skill name.",
            },
            description: {
              type: "string",
              description: "Precise trigger scope including when the Skill should and should not run.",
            },
            shortDescription: {
              type: "string",
              description: "Concise directory description.",
            },
            instructions: {
              type: "string",
              description: "Complete instruction-only Markdown body without YAML frontmatter, paths, scripts, or secrets.",
            },
          },
          required: ["name", "displayName", "description", "shortDescription", "instructions"],
        },
      },
    ],
  };
}

function createCommerceDynamicToolSpecs(): Record<string, unknown>[] {
  return [createCommerceImageToolSpec(), createCommerceSkillToolSpec()];
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
    "Commerce Pilot provides the host tool `commerce_skill.publish` for creating or updating instruction-only Skills through an application-owned validator and explicit user approval.",
    "When the user asks to create or update a Skill, use the bundled `skill-creator` Skill, gather the required purpose and trigger boundaries with request_user_input when needed, then call commerce_skill.publish with the complete draft.",
    "Never claim that this environment can only produce a SKILL.md draft while commerce_skill.publish is present. Never request a host path, shell access, scripts, secrets, or filesystem permission for Skill creation.",
    "The publish tool is authoritative: only report success after its result confirms that App Server discovered the Skill.",
    "Commerce Pilot provides MCP server `commerce_web` with tool `search` for live web research through the configured provider; its model-facing identifier may appear as `mcp__commerce_web__search`.",
    "The current tool catalog is authoritative over older conversation messages that claimed Web Search was missing.",
    "Use that MCP Web Search tool whenever the user explicitly asks to search the web or when current external information is required. Do not look for a dynamic tool named `commerce_web.search`. Cite returned source URLs and never claim Web Search is unavailable while the MCP tool is present.",
    "If one search call fails or times out, retry once with a shorter and more specific query before reporting the provider failure. Do not tell the user to enable, install, or register Web Search when the tool is already present.",
  ].join(" ");
}

function readBrowserSkillInventory(value: unknown): {
  skills: Array<Record<string, unknown>>;
  errors: string[];
} {
  if (!isRecord(value) || !Array.isArray(value.data)) return { skills: [], errors: ["Invalid skills/list response."] };
  const entry = value.data.find((item) => isRecord(item) && item.cwd === config.runtimeRoot);
  if (!isRecord(entry)) return { skills: [], errors: ["Runtime skill catalog was not returned."] };
  const errors = Array.isArray(entry.errors)
    ? entry.errors.filter((error): error is string => typeof error === "string").slice(0, 20)
    : [];
  const skills = Array.isArray(entry.skills)
    ? entry.skills
        .filter(isRecord)
        .map((skill) => {
          const skillInterface = isRecord(skill.interface) ? skill.interface : {};
          const dependencies = isRecord(skill.dependencies) && Array.isArray(skill.dependencies.tools)
            ? skill.dependencies.tools.length
            : 0;
          const name = typeof skill.name === "string" ? skill.name : "";
          return {
            name,
            description: typeof skill.description === "string" ? skill.description : "",
            enabled: skill.enabled !== false,
            scope: typeof skill.scope === "string" ? skill.scope : "unknown",
            displayName:
              name === "skill-creator"
                ? "创建技能"
                : typeof skillInterface.displayName === "string"
                  ? skillInterface.displayName
                  : formatSkillDisplayName(name),
            shortDescription:
              name === "skill-creator"
                ? "创建或更新可复用的 Agent 技能"
                : typeof skillInterface.shortDescription === "string"
                ? skillInterface.shortDescription
                : typeof skill.description === "string"
                  ? skill.description
                  : "",
            dependencyCount: dependencies,
            creator: name === "skill-creator",
            applicationManaged: name.startsWith("commerce-"),
          };
        })
        .filter((skill) => skill.name)
    : [];
  return { skills, errors };
}

async function resolveExplicitSkill(skillName: string) {
  const inventory = await codex.request(
    "skills/list",
    { cwds: [config.runtimeRoot], forceReload: true },
    30_000,
  );
  const skill = resolveExplicitSkillFromCatalog(inventory, config.runtimeRoot, skillName);
  if (!skill) {
    throw new GatewayRequestError("The selected Skill is unavailable or disabled.", 409);
  }
  return skill;
}

function readAttachmentIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_THREAD_ATTACHMENTS_PER_TURN) {
    throw new GatewayRequestError("Invalid attachment id list.", 400);
  }
  const ids = value.filter((item): item is string => typeof item === "string" && isUuid(item));
  if (ids.length !== value.length || new Set(ids).size !== ids.length) {
    throw new GatewayRequestError("Invalid or duplicate attachment id.", 400);
  }
  return ids;
}

async function readBoundTurnAttachments(
  threadId: string,
  attachmentIds: string[],
  scope: RuntimeScope,
  clientRequestId: string,
): Promise<ThreadArtifact[]> {
  const attachments: ThreadArtifact[] = [];
  for (const attachmentId of attachmentIds) {
    const artifact = await threadArtifacts.get(threadId, attachmentId);
    if (!artifact || artifact.clientRequestId !== clientRequestId) {
      throw new GatewayRequestError("Attachment is unavailable for this request.", 409);
    }
    try {
      threadArtifacts.assertReadableByScope(artifact, scope);
    } catch {
      throw new GatewayRequestError("Attachment ownership does not match this thread.", 404);
    }
    attachments.push(artifact);
  }
  return attachments;
}

function formatTurnMessageWithAttachments(message: string, attachments: ThreadArtifact[]): string {
  if (!attachments.length) return message;
  const names = attachments.map((attachment) => attachment.originalName.replace(/[\]\n\r]/g, " "));
  return [`[附件：${names.join("、")}]`, message].filter(Boolean).join("\n");
}

function decodeHeaderComponent(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new GatewayRequestError(`Invalid ${label}.`, 400);
  }
}

function formatSkillDisplayName(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
