"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  findMatchingConversationMessage,
  mergeAuthoritativeMessages,
} from "./message-reconciliation";
import {
  activateTurnClock,
} from "./turn-lifecycle";
import {
  readWebSourcesFromToolItem,
  type WebSource,
} from "./web-sources";
import {
  readDynamicToolActivity,
  readMcpToolActivity,
  type ResearchToolProjection,
} from "./tool-activity";
import type { AgentRecipeId, AgentWorkflowId, TaskCategory } from "./task-category";
import type { CreativeMethod } from "@/lib/creative/creative-method-contract";
import type { ProductInsightMethod } from "@/lib/research/product-insight-contract";
import { readNativeSkillMessage, readVisibleAttachmentMessage } from "./skill-invocation";
import {
  isAgentMessageFeedbackRating,
  type AgentMessageFeedbackRating,
} from "./message-feedback-contract";
import {
  shouldDisplayRequestUserInputAnswer,
  type RequestUserInputOrigin,
} from "./request-user-input-visibility";
import {
  isEndedRequestUserInputResponse,
  terminalTurnMessage,
} from "./request-user-input-lifecycle";
import type { ProductSummary } from "@/lib/products/catalog";

export type { AgentMessageFeedbackRating } from "./message-feedback-contract";

export type QueuedMessage = {
  id: string;
  clientUserMessageId: string;
  content: string;
};

const CODEX_REQUEST_USER_INPUT_METHOD = "item/tool/requestUserInput";
const COMMERCE_APPROVAL_REQUESTED_METHOD = "commerce/approval/requested";
const COMMERCE_APPROVAL_RESOLVED_METHOD = "commerce/approval/resolved";

export type ConversationMessage = {
  id: string;
  sequence: number;
  turnId?: string | null;
  role: "user" | "assistant";
  content: string;
  variant?: "default" | "steer";
  clientId?: string | null;
  delivery?: "pending" | "committed";
  phase?: "commentary" | "final_answer" | null;
  skillName?: string | null;
  attachments?: ConversationAttachment[];
  products?: ProductSummary[];
  feedback?: AgentMessageFeedbackRating | null;
  artifactStatus?: "missing_image" | null;
  status: "streaming" | "completed";
};

export type ConversationAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "document";
  url: string;
};

export type PendingAttachmentUpload = ConversationAttachment & {
  file: File;
  local: true;
};

export type AgentActivity = {
  id: string;
  sequence: number;
  turnId?: string | null;
  kind: "command" | "file" | "tool" | "search" | "image" | "compact";
  label: string;
  detail?: string;
  durationMs?: number | null;
  research?: ResearchToolProjection;
  sources?: WebSource[];
  status: "running" | "completed" | "failed";
};

export type GeneratedImageItem = {
  id: string;
  sequence: number;
  turnId?: string | null;
  url: string;
  model: string;
  filename: string;
};

export type AgentThreadStatus = "idle" | "connecting" | "running" | "completed" | "interrupted" | "failed";

export type RequestUserInputQuestionOption = {
  label: string;
  description: string;
};

export type RequestUserInputQuestion = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: RequestUserInputQuestionOption[];
};

export type PendingRequestUserInput = {
  requestId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  questions: RequestUserInputQuestion[];
  isBlocking: boolean;
  receivedAt: string;
  origin: RequestUserInputOrigin;
  action?: "skill.publish" | "external_data.call" | "product_catalog.activate_import";
};

export type AgentSubmitOptions = {
  workflow?: AgentWorkflowId;
  creativeMethod?: CreativeMethod;
  insightMethod?: ProductInsightMethod;
  skillName?: string;
  displaySkillName?: string;
  attachments?: PendingAttachmentUpload[];
  externalDataApprovalMode?: "always_ask" | "task" | "policy";
  productIds?: string[];
  productContextMode?: "auto" | "selected" | "none";
  /** Browser-only product summaries used to render the optimistic user message. */
  displayProducts?: ProductSummary[];
  /** Browser-only acknowledgement hook; it runs only after the Turn is confirmed accepted. */
  onTurnAccepted?: () => void;
};

export type AgentRetryOptions = Pick<AgentSubmitOptions, "externalDataApprovalMode">;

export function buildAgentTurnRequestBody(input: {
  message: string;
  model: string;
  effort?: string;
  options?: AgentSubmitOptions;
  attachmentIds: string[];
  clientRequestId: string;
}) {
  return {
    message: input.message,
    model: input.model,
    effort: input.effort,
    workflow: input.options?.workflow,
    creativeMethod: input.options?.creativeMethod,
    insightMethod: input.options?.insightMethod,
    skillName: input.options?.skillName,
    attachmentIds: input.attachmentIds,
    externalDataApprovalMode: input.options?.externalDataApprovalMode ?? "always_ask",
    productIds: input.options?.productIds ?? [],
    productContextMode: input.options?.productContextMode ?? "none",
    clientRequestId: input.clientRequestId,
  };
}

export function isPersistedQueuedTurnResponse(
  status: number,
  payload: Record<string, unknown> | null,
): boolean {
  return status === 202 && payload?.queued === true;
}

export type AgentThreadSummary = {
  threadId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: "idle" | "running" | "completed" | "interrupted" | "failed";
  activeTurnId: string | null;
  turnStartedAt: string | null;
  durationMs: number | null;
  recipeId: AgentRecipeId | null;
  category: TaskCategory;
  toolContractVersion: number;
};

type StoredThreadResponse = {
  thread: {
    id: string;
    title: string;
    lastTurnId: string | null;
    status: "running" | "completed" | "interrupted" | "failed";
    durationMs: number | null;
    startedAt: string | null;
    recipeId: AgentRecipeId | null;
    category: TaskCategory;
  };
  messages: ConversationMessage[];
  activities: AgentActivity[];
  images: GeneratedImageItem[];
  nextCursor: string | null;
};

type StoredThreadStatusResponse = {
  thread: {
    id: string;
    lastTurnId: string | null;
    status: "idle" | "running" | "completed" | "interrupted" | "failed";
    durationMs: number | null;
    startedAt: string | null;
  };
};

type UseAgentThreadOptions = {
  model: string;
  effort?: string;
  runtimeHealth?: {
    available: boolean;
    observedAt: number;
    instanceId: string | null;
    maxTurnDurationMs: number;
  } | null;
};

export function useAgentThread({ model, effort, runtimeHealth }: UseAgentThreadOptions) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threadTitle, setThreadTitle] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [images, setImages] = useState<GeneratedImageItem[]>([]);
  const [status, setStatus] = useState<AgentThreadStatus>("idle");
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [lastTurnId, setLastTurnId] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [interrupting, setInterrupting] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingOlderHistory, setLoadingOlderHistory] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [compacting, setCompacting] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const [queueSubmitting, setQueueSubmitting] = useState(false);
  const [queueOperationId, setQueueOperationId] = useState<string | null>(null);
  const [pendingUserInput, setPendingUserInput] = useState<PendingRequestUserInput | null>(null);
  const [answeringUserInput, setAnsweringUserInput] = useState(false);
  const [feedbackSubmittingIds, setFeedbackSubmittingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const messagesRef = useRef<ConversationMessage[]>([]);
  const pendingUserInputRef = useRef<PendingRequestUserInput | null>(null);
  const sequenceRef = useRef(0);
  const activeTurnIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const runtimeInstanceIdRef = useRef<string | null>(null);
  const compactingRef = useRef(false);
  const queueRefreshSuppressionRef = useRef(0);
  const threadReconcileInFlightRef = useRef(false);
  const titleGenerationAttemptRef = useRef(new Set<string>());
  const feedbackSubmittingIdsRef = useRef(new Set<string>());
  const retryingMessageIdRef = useRef<string | null>(null);
  const pendingSubmitClientIdRef = useRef<string | null>(null);
  const pendingSubmitStartedAtRef = useRef<number | null>(null);
  const pendingSubmitAcceptanceRef = useRef<{
    clientId: string;
    onAccepted: (() => void) | null;
  } | null>(null);
  const pendingSteerClientIdRef = useRef<string | null>(null);
  const confirmedSteerClientIdRef = useRef<string | null>(null);
  const unconfirmedSteerRef = useRef<{
    threadId: string;
    turnId: string;
    workflow: AgentWorkflowId;
    insightMethod?: ProductInsightMethod;
    message: string;
    clientRequestId: string;
  } | null>(null);
  const historySequenceFloorRef = useRef(0);
  const historyLoadRequestRef = useRef(0);
  const historyLoadControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const refreshQueue = useCallback(async (id: string): Promise<void> => {
    try {
      const response = await fetch(`/api/agent/threads/${encodeURIComponent(id)}/queue`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as { queue?: unknown } | null;
      if (!response.ok || !payload || !Array.isArray(payload.queue)) {
        return;
      }
      const normalizeQueue = (items: unknown[]) =>
        items
          .filter(isRecord)
          .map((item) => ({
            id: typeof item.id === "string" ? item.id : "",
            clientUserMessageId:
              typeof item.clientUserMessageId === "string" ? item.clientUserMessageId : "",
            content: typeof item.content === "string" ? item.content : "",
          }))
          .filter((item) => item.id && item.clientUserMessageId && item.content);
      setQueuedMessages(normalizeQueue(payload.queue));
    } catch {
      // Queue notifications are advisory; the active turn remains usable if a refresh fails.
    }
  }, []);

  const refreshPendingUserInput = useCallback(async (id: string): Promise<void> => {
    try {
      const response = await fetch(`/api/agent/threads/${encodeURIComponent(id)}/user-input`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as { requests?: unknown } | null;
      if (!response.ok || !payload || !Array.isArray(payload.requests)) return;
      const pending = payload.requests
        .map(readPendingRequestUserInputPayload)
        .find((request): request is PendingRequestUserInput => Boolean(request));
      pendingUserInputRef.current = pending ?? null;
      setPendingUserInput(pending ?? null);
    } catch {
      // The SSE server request remains authoritative; reconnect reconciliation retries this read.
    }
  }, []);

  const activateTurn = useCallback((turnId: string, observedAt = Date.now()) => {
    const nextClock = activateTurnClock(
      { turnId: activeTurnIdRef.current, startedAt: startedAtRef.current },
      turnId,
      observedAt,
    );
    activeTurnIdRef.current = nextClock.turnId;
    startedAtRef.current = nextClock.startedAt;
    setActiveTurnId(nextClock.turnId);
    setLastTurnId(nextClock.turnId);
    setStartedAt(nextClock.startedAt);
  }, []);

  const confirmPendingSubmit = useCallback((clientId: string) => {
    const pending = pendingSubmitAcceptanceRef.current;
    if (!pending || pending.clientId !== clientId) return;
    pendingSubmitAcceptanceRef.current = null;
    pending.onAccepted?.();
  }, []);

  const handleGatewayEvent = useCallback((event: MessageEvent<string>) => {
    const gatewayEvent = parseObject(event.data);
    if (!gatewayEvent) {
      return;
    }
    if (
      (gatewayEvent.type === "server_request" && gatewayEvent.method === CODEX_REQUEST_USER_INPUT_METHOD) ||
      (gatewayEvent.type === "notification" && gatewayEvent.method === COMMERCE_APPROVAL_REQUESTED_METHOD)
    ) {
      const pending = readPendingRequestUserInputEvent(gatewayEvent);
      if (pending) {
        pendingUserInputRef.current = pending;
        setPendingUserInput(pending);
        setStatus("running");
      }
      return;
    }
    if (gatewayEvent.type !== "notification") return;
    const method = typeof gatewayEvent.method === "string" ? gatewayEvent.method : "";
    const params = isRecord(gatewayEvent.params) ? gatewayEvent.params : {};

    if (method === "serverRequest/resolved" || method === COMMERCE_APPROVAL_RESOLVED_METHOD) {
      const requestId = typeof params.requestId === "string" || typeof params.requestId === "number"
        ? String(params.requestId)
        : "";
      if (requestId) {
        if (pendingUserInputRef.current?.requestId === requestId) {
          pendingUserInputRef.current = null;
        }
        setPendingUserInput((current) => current?.requestId === requestId ? null : current);
      }
      return;
    }

    if (method === "thread/queue/changed") {
      if (queueRefreshSuppressionRef.current > 0) {
        return;
      }
      const changedThreadId = typeof params.threadId === "string" ? params.threadId : threadId;
      if (changedThreadId) {
        void refreshQueue(changedThreadId);
      }
      return;
    }

    if (method === "commerce/authorization/revoked") {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setError("企业成员资格、角色、合同或用量门禁已变更，正在等待 Harness 确认任务终态。");
      return;
    }

    if (method === "commerce/contextCompaction/started") {
      const compactionStartedAt = Date.now();
      compactingRef.current = true;
      setCompacting(true);
      startedAtRef.current = compactionStartedAt;
      setStartedAt(compactionStartedAt);
      setDurationMs(null);
      setError(null);
      setStatus("running");
      return;
    }

    if (method === "commerce/contextCompaction/failed") {
      compactingRef.current = false;
      setCompacting(false);
      activeTurnIdRef.current = null;
      setActiveTurnId(null);
      setDurationMs(startedAtRef.current ? Date.now() - startedAtRef.current : null);
      setError(typeof params.message === "string" ? params.message : "上下文整理失败，请继续对话或稍后重试。");
      setStatus("failed");
      return;
    }

    if (method === "thread/reverted") {
      const revertedThreadId = typeof params.threadId === "string" ? params.threadId : null;
      if (!revertedThreadId || revertedThreadId !== threadIdRef.current) return;
      activeTurnIdRef.current = null;
      startedAtRef.current = null;
      pendingUserInputRef.current = null;
      setActiveTurnId(null);
      setPendingUserInput(null);
      setAnsweringUserInput(false);
      setDurationMs(null);
      setError(null);
      setStatus("connecting");
      void (async () => {
        try {
          const response = await fetch(`/api/agent/threads/${encodeURIComponent(revertedThreadId)}`, {
            cache: "no-store",
          });
          const payload = (await response.json().catch(() => null)) as StoredThreadResponse | null;
          if (!response.ok || !payload || threadIdRef.current !== revertedThreadId) return;
          if (
            activeTurnIdRef.current &&
            payload.thread.lastTurnId !== activeTurnIdRef.current
          ) {
            return;
          }
          sequenceRef.current = Math.max(
            0,
            ...payload.messages.map((message) => message.sequence),
            ...payload.activities.map((activity) => activity.sequence),
            ...payload.images.map((image) => image.sequence),
          );
          setMessages(payload.messages);
          setActivities(payload.activities);
          setImages(payload.images);
          setHistoryCursor(payload.nextCursor);
          setLastTurnId(payload.thread.lastTurnId);
          setStatus(payload.thread.status);
        } catch {
          setError("Harness 已回退历史，正在等待替代 Turn 状态同步。");
        }
      })();
      return;
    }

    if (method === "turn/started") {
      const turn = isRecord(params.turn) ? params.turn : {};
      if (typeof turn.id === "string") {
        activateTurn(turn.id);
        if (!compactingRef.current) {
          setMessages((current) => bindLatestUserMessageToTurn(current, turn.id as string));
        }
      }
      setDurationMs(null);
      setError(null);
      setStatus("running");
      return;
    }

    if (method === "item/started" || method === "item/completed") {
      const item = isRecord(params.item) ? params.item : null;
      if (!item || typeof item.id !== "string" || typeof item.type !== "string") {
        return;
      }
      const completed = method === "item/completed";
      const turnId = typeof params.turnId === "string" ? params.turnId : activeTurnIdRef.current;
      if (item.type === "contextCompaction" && !completed) {
        compactingRef.current = true;
        setCompacting(true);
      }
      if (item.type === "userMessage") {
        const nativeSkillName = readUserMessageSkillName(item);
        const explicitSkillMessage = readNativeSkillMessage(readUserMessageText(item), nativeSkillName);
        const content = readVisibleAttachmentMessage(explicitSkillMessage.content);
        const skillName = nativeSkillName ?? explicitSkillMessage.skillName;
        const clientId = typeof item.clientId === "string" ? item.clientId : null;
        if (clientId) {
          if (pendingSubmitClientIdRef.current === clientId) {
            confirmPendingSubmit(clientId);
            pendingSubmitClientIdRef.current = null;
            pendingSubmitStartedAtRef.current = null;
          }
          if (pendingSteerClientIdRef.current === clientId) {
            confirmedSteerClientIdRef.current = clientId;
          }
        }
        if (content) {
          upsertUserMessage(
            setMessages,
            item.id,
            content,
            turnId,
            nextSequence(sequenceRef),
            clientId,
            skillName,
          );
        }
      } else if (item.type === "agentMessage") {
        upsertAssistantMessage(
          setMessages,
          item.id,
          typeof item.text === "string" ? item.text : "",
          item.phase === "commentary" || item.phase === "final_answer" ? item.phase : null,
          completed ? "completed" : "streaming",
          turnId,
          nextSequence(sequenceRef),
        );
      } else {
        const activity = activityFromItem(item, completed, turnId, nextSequence(sequenceRef));
        if (activity) {
          upsertActivity(setActivities, activity);
        }
      }
      return;
    }

    if (method === "item/agentMessage/delta") {
      const itemId = typeof params.itemId === "string" ? params.itemId : "";
      const delta = typeof params.delta === "string" ? params.delta : "";
      const turnId = typeof params.turnId === "string" ? params.turnId : activeTurnIdRef.current;
      if (itemId && delta) {
        setMessages((current) => {
          const index = current.findIndex((message) => message.id === itemId);
          if (index === -1) {
            return [
              ...current,
              {
                id: itemId,
                sequence: nextSequence(sequenceRef),
                turnId,
                role: "assistant",
                content: delta,
                phase: null,
                status: "streaming",
              },
            ];
          }
          return current.map((message, messageIndex) =>
            messageIndex === index ? { ...message, content: `${message.content}${delta}`, status: "streaming" } : message,
          );
        });
      }
      return;
    }

    if (method === "commerce/imageGeneration/completed") {
      const publicUrl = typeof params.publicUrl === "string" ? params.publicUrl : "";
      const filename = typeof params.filename === "string" ? params.filename : "";
      if (publicUrl && filename) {
        setImages((current) =>
          current.some((image) => image.id === filename)
            ? current
            : [
                ...current,
                {
                  id: filename,
                  sequence: nextSequence(sequenceRef),
                  turnId: typeof params.turnId === "string" ? params.turnId : activeTurnIdRef.current,
                  url: publicUrl,
                  filename,
                  model: typeof params.model === "string" ? params.model : "gpt-image-2",
                },
              ],
        );
      }
      return;
    }

    if (method === "turn/completed") {
      const turn = isRecord(params.turn) ? params.turn : {};
      const turnStatus = typeof turn.status === "string" ? turn.status : "completed";
      const completedTurnId = typeof turn.id === "string" ? turn.id : null;
      if (
        completedTurnId &&
        activeTurnIdRef.current &&
        activeTurnIdRef.current !== completedTurnId
      ) {
        return;
      }
      if (typeof turn.id === "string") {
        setLastTurnId(turn.id);
      }
      if (
        pendingSubmitClientIdRef.current &&
        completedTurnId &&
        activeTurnIdRef.current === completedTurnId
      ) {
        confirmPendingSubmit(pendingSubmitClientIdRef.current);
      }
      pendingSubmitClientIdRef.current = null;
      pendingSubmitStartedAtRef.current = null;
      pendingSubmitAcceptanceRef.current = null;
      activeTurnIdRef.current = null;
      runtimeInstanceIdRef.current = null;
      compactingRef.current = false;
      setActiveTurnId(null);
      setCompacting(false);
      pendingUserInputRef.current = null;
      setPendingUserInput(null);
      setAnsweringUserInput(false);
      setInterrupting(false);
      setDurationMs(
        typeof turn.durationMs === "number"
          ? turn.durationMs
          : startedAtRef.current
            ? Date.now() - startedAtRef.current
            : null,
      );
      const terminalStatus = turnStatus === "interrupted" ? "interrupted" : turnStatus === "failed" ? "failed" : "completed";
      setStatus(terminalStatus);
      if (turnStatus === "failed" && isRecord(turn.error) && typeof turn.error.message === "string") {
        setError(turn.error.message);
      } else {
        setError(terminalTurnMessage(terminalStatus));
      }
      if (threadId) {
        void refreshQueue(threadId);
      }
      return;
    }

    if (method === "error") {
      const itemError = isRecord(params.error) ? params.error : {};
      setError(typeof itemError.message === "string" ? itemError.message : "Agent 执行出现错误，正在等待任务终态。");
    }
  }, [activateTurn, confirmPendingSubmit, refreshQueue, threadId]);

  const connectEventStream = useCallback(
    async (id: string) => {
      if (eventSourceRef.current) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const source = new EventSource(`/api/agent/events?threadId=${encodeURIComponent(id)}`);
        eventSourceRef.current = source;
        let opened = false;
        source.addEventListener("notification", handleGatewayEvent as EventListener);
        source.addEventListener("server_request", handleGatewayEvent as EventListener);
        source.onopen = () => {
          opened = true;
          resolve();
        };
        source.onerror = () => {
          if (!opened) {
            source.close();
            eventSourceRef.current = null;
            reject(new Error("无法连接 Agent 事件流。"));
          }
        };
      });
    },
    [handleGatewayEvent],
  );

  useEffect(() => {
    if (!threadId || (status !== "connecting" && status !== "running")) {
      return;
    }
    let cancelled = false;

    const reconcile = async () => {
      if (threadReconcileInFlightRef.current) {
        return;
      }
      threadReconcileInFlightRef.current = true;
      try {
        const statusResponse = await fetch(`/api/agent/threads/${encodeURIComponent(threadId)}/status`, {
          cache: "no-store",
        });
        const statusPayload = (await statusResponse.json().catch(() => null)) as StoredThreadStatusResponse | null;
        if (!statusResponse.ok || !statusPayload || cancelled) {
          return;
        }

        if (statusPayload.thread.status === "running") {
          if (statusPayload.thread.lastTurnId) {
            const authoritativeStartedAt = statusPayload.thread.startedAt
              ? new Date(statusPayload.thread.startedAt).getTime()
              : Date.now();
            activateTurn(statusPayload.thread.lastTurnId, authoritativeStartedAt);
          }
          runtimeInstanceIdRef.current = runtimeHealth?.instanceId ?? runtimeInstanceIdRef.current;
          setDurationMs(statusPayload.thread.durationMs);
          setError(null);
          setStatus("running");
          void refreshPendingUserInput(threadId);
          if (!eventSourceRef.current && runtimeHealth?.available !== false) {
            void connectEventStream(threadId).catch(() => undefined);
          }
          return;
        }

        const response = await fetch(`/api/agent/threads/${encodeURIComponent(threadId)}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as StoredThreadResponse | null;
        if (!response.ok || !payload || cancelled) return;

        const authoritativeByClientId = new Map(
          payload.messages
            .filter((message) => message.role === "user" && typeof message.clientId === "string")
            .map((message) => [message.clientId as string, message]),
        );
        const pendingSubmitClientId = pendingSubmitClientIdRef.current;
        const pendingSubmitAccepted = Boolean(
          pendingSubmitClientId && authoritativeByClientId.has(pendingSubmitClientId),
        );
        if (pendingSubmitAccepted && pendingSubmitClientId) {
          confirmPendingSubmit(pendingSubmitClientId);
          pendingSubmitClientIdRef.current = null;
          pendingSubmitStartedAtRef.current = null;
        }
        sequenceRef.current = Math.max(
          sequenceRef.current,
          ...payload.messages.map((message) => message.sequence),
        );
        setMessages((current) => mergeAuthoritativeMessages(current, payload.messages));

        if (
          status === "connecting" &&
          pendingSubmitClientId &&
          !pendingSubmitAccepted &&
          Date.now() - (pendingSubmitStartedAtRef.current ?? Date.now()) < 12_000
        ) {
          return;
        }

        if (status === "connecting" && pendingSubmitClientId && !pendingSubmitAccepted) {
          if (pendingSubmitAcceptanceRef.current?.clientId === pendingSubmitClientId) {
            pendingSubmitAcceptanceRef.current = null;
          }
          pendingSubmitClientIdRef.current = null;
          pendingSubmitStartedAtRef.current = null;
          setMessages((current) => current.filter((message) => message.clientId !== pendingSubmitClientId));
          setStatus("failed");
          setError("Harness 未接收这次任务，请重新发送。");
          return;
        }

        if (
          activeTurnIdRef.current &&
          payload.thread.lastTurnId &&
          activeTurnIdRef.current !== payload.thread.lastTurnId
        ) {
          return;
        }

        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        activeTurnIdRef.current = null;
        runtimeInstanceIdRef.current = null;
        compactingRef.current = false;
        sequenceRef.current = Math.max(
          0,
          ...payload.messages.map((message) => message.sequence),
          ...payload.activities.map((activity) => activity.sequence),
          ...payload.images.map((image) => image.sequence),
        );
        setMessages(payload.messages);
        setActivities(payload.activities);
        setImages(payload.images);
        setHistoryCursor(payload.nextCursor);
        historySequenceFloorRef.current = Math.min(
          0,
          ...payload.messages.map((item) => item.sequence),
          ...payload.activities.map((item) => item.sequence),
          ...payload.images.map((item) => item.sequence),
        );
        setActiveTurnId(null);
        setLastTurnId(payload.thread.lastTurnId);
        setDurationMs(payload.thread.durationMs);
        const terminalStartedAt = payload.thread.startedAt
          ? new Date(payload.thread.startedAt).getTime()
          : startedAtRef.current;
        startedAtRef.current = terminalStartedAt;
        setStartedAt(terminalStartedAt);
        setInterrupting(false);
        setCompacting(false);
        pendingUserInputRef.current = null;
        setPendingUserInput(null);
        setAnsweringUserInput(false);
        setError(terminalTurnMessage(payload.thread.status));
        setStatus(payload.thread.status);
        void refreshQueue(threadId);
      } catch {
        // SSE remains the primary stream; the next watchdog tick retries reconciliation.
      } finally {
        threadReconcileInFlightRef.current = false;
      }
    };

    void reconcile();
    const interval = window.setInterval(() => void reconcile(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activateTurn, confirmPendingSubmit, connectEventStream, refreshPendingUserInput, refreshQueue, runtimeHealth?.available, runtimeHealth?.instanceId, status, threadId]);

  const setMessageFeedback = useCallback(
    async (
      messageId: string,
      rating: AgentMessageFeedbackRating | null,
    ): Promise<boolean> => {
      const currentThreadId = threadId;
      const message = messages.find((candidate) => candidate.id === messageId);
      if (
        !currentThreadId ||
        !message ||
        message.role !== "assistant" ||
        message.phase === "commentary" ||
        message.status !== "completed" ||
        feedbackSubmittingIdsRef.current.has(messageId)
      ) {
        return false;
      }

      const previousRating = message.feedback ?? null;
      feedbackSubmittingIdsRef.current.add(messageId);
      setFeedbackSubmittingIds(new Set(feedbackSubmittingIdsRef.current));
      setFeedbackError(null);
      setMessages((current) => current.map((candidate) =>
        candidate.id === messageId ? { ...candidate, feedback: rating } : candidate
      ));

      try {
        const response = await fetch(
          `/api/agent/threads/${encodeURIComponent(currentThreadId)}/messages/${encodeURIComponent(messageId)}/feedback`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rating }),
          },
        );
        const payload = (await response.json().catch(() => null)) as {
          rating?: unknown;
          error?: unknown;
        } | null;
        const savedRating = payload?.rating;
        if (
          !response.ok ||
          !payload ||
          (savedRating !== null && !isAgentMessageFeedbackRating(savedRating))
        ) {
          throw new Error(
            payload && typeof payload.error === "string"
              ? payload.error
              : "反馈暂时无法保存，请稍后重试。",
          );
        }
        setMessages((current) => current.map((candidate) =>
          candidate.id === messageId ? { ...candidate, feedback: savedRating } : candidate
        ));
        return true;
      } catch (feedbackFailure) {
        setMessages((current) => current.map((candidate) =>
          candidate.id === messageId ? { ...candidate, feedback: previousRating } : candidate
        ));
        setFeedbackError(
          feedbackFailure instanceof Error
            ? feedbackFailure.message
            : "反馈暂时无法保存，请稍后重试。",
        );
        return false;
      } finally {
        feedbackSubmittingIdsRef.current.delete(messageId);
        setFeedbackSubmittingIds(new Set(feedbackSubmittingIdsRef.current));
      }
    },
    [messages, threadId],
  );

  const resetThread = useCallback(() => {
    historyLoadRequestRef.current += 1;
    historyLoadControllerRef.current?.abort();
    historyLoadControllerRef.current = null;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    sequenceRef.current = 0;
    activeTurnIdRef.current = null;
    startedAtRef.current = null;
    runtimeInstanceIdRef.current = null;
    compactingRef.current = false;
    feedbackSubmittingIdsRef.current.clear();
    retryingMessageIdRef.current = null;
    setThreadId(null);
    setThreadTitle(null);
    setMessages([]);
    setActivities([]);
    setImages([]);
    setStatus("idle");
    setActiveTurnId(null);
    setLastTurnId(null);
    setDurationMs(null);
    setStartedAt(null);
    setError(null);
    setInterrupting(false);
    setLoadingHistory(false);
    setLoadingOlderHistory(false);
    setHistoryCursor(null);
    setCompacting(false);
    setQueuedMessages([]);
    setQueueSubmitting(false);
    setQueueOperationId(null);
    pendingUserInputRef.current = null;
    setPendingUserInput(null);
    setAnsweringUserInput(false);
    setFeedbackSubmittingIds(new Set());
    setFeedbackError(null);
    setRetryingMessageId(null);
    pendingSubmitClientIdRef.current = null;
    pendingSubmitStartedAtRef.current = null;
    pendingSubmitAcceptanceRef.current = null;
    pendingSteerClientIdRef.current = null;
    confirmedSteerClientIdRef.current = null;
    unconfirmedSteerRef.current = null;
    historySequenceFloorRef.current = 0;
  }, []);

  const loadThread = useCallback(
    async (summary: AgentThreadSummary): Promise<boolean> => {
      const requestId = ++historyLoadRequestRef.current;
      historyLoadControllerRef.current?.abort();
      const controller = new AbortController();
      historyLoadControllerRef.current = controller;
      setLoadingHistory(true);
      setError(null);
      sequenceRef.current = 0;
      activeTurnIdRef.current = null;
      startedAtRef.current = null;
      runtimeInstanceIdRef.current = null;
      compactingRef.current = false;
      setThreadId(summary.threadId);
      setThreadTitle(summary.title);
      setMessages([]);
      setActivities([]);
      setImages([]);
      setStatus("connecting");
      setActiveTurnId(null);
      setLastTurnId(null);
      setDurationMs(null);
      setStartedAt(null);
      setInterrupting(false);
      setLoadingOlderHistory(false);
      setHistoryCursor(null);
      setCompacting(false);
      setQueuedMessages([]);
      setQueueSubmitting(false);
      setQueueOperationId(null);
      pendingUserInputRef.current = null;
      setPendingUserInput(null);
      setAnsweringUserInput(false);
      setFeedbackError(null);
      feedbackSubmittingIdsRef.current.clear();
      setFeedbackSubmittingIds(new Set());
      retryingMessageIdRef.current = null;
      setRetryingMessageId(null);
      queueRefreshSuppressionRef.current = 0;
      threadReconcileInFlightRef.current = false;
      pendingSteerClientIdRef.current = null;
      confirmedSteerClientIdRef.current = null;
      unconfirmedSteerRef.current = null;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      try {
        const response = await fetch(`/api/agent/threads/${encodeURIComponent(summary.threadId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as StoredThreadResponse | { error?: string } | null;
        if (controller.signal.aborted || requestId !== historyLoadRequestRef.current) return false;
        if (!response.ok || !payload || !("thread" in payload)) {
          if (response.status === 404) {
            resetThread();
          } else {
            setStatus("failed");
          }
          setError(payload && "error" in payload && typeof payload.error === "string" ? payload.error : "无法读取对话记录。");
          return false;
        }
        const maxSequence = [...payload.messages, ...payload.activities, ...payload.images].reduce(
          (maximum, item) => Math.max(maximum, item.sequence),
          0,
        );
        sequenceRef.current = maxSequence;
        historySequenceFloorRef.current = Math.min(
          0,
          ...payload.messages.map((item) => item.sequence),
          ...payload.activities.map((item) => item.sequence),
          ...payload.images.map((item) => item.sequence),
        );
        const restoredStartedAt = payload.thread.startedAt ? new Date(payload.thread.startedAt).getTime() : null;
        const restoredActiveTurnId = payload.thread.status === "running" ? payload.thread.lastTurnId : null;
        const restoredCompacting =
          payload.thread.status === "running" &&
          payload.activities.some(
            (activity) => activity.turnId === restoredActiveTurnId && activity.kind === "compact" && activity.status === "running",
          );
        activeTurnIdRef.current = restoredActiveTurnId;
        startedAtRef.current = restoredStartedAt;
        runtimeInstanceIdRef.current = payload.thread.status === "running" ? runtimeHealth?.instanceId ?? null : null;
        compactingRef.current = restoredCompacting;
        setThreadId(payload.thread.id);
        setThreadTitle(payload.thread.title || summary.title);
        setMessages(payload.messages);
        setHistoryCursor(payload.nextCursor);
        setActivities(payload.activities);
        setImages(payload.images);
        setStatus(payload.thread.status);
        setActiveTurnId(restoredActiveTurnId);
        setLastTurnId(payload.thread.lastTurnId);
        setDurationMs(payload.thread.durationMs);
        setStartedAt(restoredStartedAt);
        setInterrupting(false);
        setCompacting(restoredCompacting);
        setQueuedMessages([]);
        void refreshQueue(payload.thread.id);
        if (payload.thread.status === "running") {
          void refreshPendingUserInput(payload.thread.id);
          void connectEventStream(payload.thread.id).catch(() => undefined);
        } else {
          pendingUserInputRef.current = null;
          setPendingUserInput(null);
          setAnsweringUserInput(false);
        }
        return true;
      } catch (loadError) {
        if (
          controller.signal.aborted ||
          requestId !== historyLoadRequestRef.current ||
          (loadError instanceof DOMException && loadError.name === "AbortError")
        ) {
          return false;
        }
        setStatus("failed");
        setError("无法读取对话记录。");
        return false;
      } finally {
        if (requestId === historyLoadRequestRef.current) {
          if (historyLoadControllerRef.current === controller) historyLoadControllerRef.current = null;
          setLoadingHistory(false);
        }
      }
    },
    [connectEventStream, refreshPendingUserInput, refreshQueue, resetThread, runtimeHealth?.instanceId],
  );

  const loadOlderHistory = useCallback(async (): Promise<boolean> => {
    if (!threadId || !historyCursor || loadingOlderHistory) return false;
    setLoadingOlderHistory(true);
    try {
      const response = await fetch(
        `/api/agent/threads/${encodeURIComponent(threadId)}?cursor=${encodeURIComponent(historyCursor)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json().catch(() => null)) as StoredThreadResponse | null;
      if (!response.ok || !payload) return false;
      const older = resequenceHistoricalPage(payload, historySequenceFloorRef.current);
      historySequenceFloorRef.current = older.floor;
      setMessages((current) => prependUniqueById(current, older.messages));
      setActivities((current) => prependUniqueById(current, older.activities));
      setImages((current) => prependUniqueById(current, older.images));
      setHistoryCursor(payload.nextCursor);
      return true;
    } catch {
      setError("无法读取更早的对话记录。");
      return false;
    } finally {
      setLoadingOlderHistory(false);
    }
  }, [historyCursor, loadingOlderHistory, threadId]);

  const submit = useCallback(
    async (text: string, options?: AgentSubmitOptions): Promise<boolean> => {
      const message = text.trim();
      const pendingAttachments = options?.attachments ?? [];
      if ((!message && !pendingAttachments.length) || status === "running" || status === "connecting") {
        return false;
      }
      unconfirmedSteerRef.current = null;
      setStatus("connecting");
      setError(null);
      setInterrupting(false);
      setDurationMs(null);
      setQueuedMessages([]);
      startedAtRef.current = null;
      setStartedAt(null);
      activeTurnIdRef.current = null;
      runtimeInstanceIdRef.current = runtimeHealth?.instanceId ?? null;
      setActiveTurnId(null);
      setLastTurnId(null);
      const optimisticMessageId = `user-${crypto.randomUUID()}`;
      const clientRequestId = crypto.randomUUID();
      pendingSubmitClientIdRef.current = clientRequestId;
      pendingSubmitStartedAtRef.current = Date.now();
      pendingSubmitAcceptanceRef.current = {
        clientId: clientRequestId,
        onAccepted: options?.onTurnAccepted ?? null,
      };
      const requestedTitle = "新任务";
      setMessages((current) => [
        ...current,
        {
          id: optimisticMessageId,
          sequence: nextSequence(sequenceRef),
          turnId: null,
          role: "user",
          content: message,
          clientId: clientRequestId,
          skillName: options?.displaySkillName ?? options?.skillName ?? null,
          attachments: pendingAttachments.map(({ file: _file, local: _local, ...attachment }) => attachment),
          products: options?.displayProducts?.map((product) => ({ ...product })),
          delivery: "pending",
          status: "completed",
        },
      ]);
      setThreadTitle((current) => current ?? requestedTitle);
      let currentThreadId = threadId;
      let turnStartAmbiguous = false;
      try {
        if (!currentThreadId) {
          const response = await fetch("/api/agent/threads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              workflow: options?.workflow,
              insightMethod: options?.insightMethod,
            }),
          });
          const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
          currentThreadId = readThreadId(payload);
          if (!response.ok || !currentThreadId) {
            throw new Error(readError(payload) || "无法创建 Agent 会话。");
          }
          setThreadId(currentThreadId);
        }

        await connectEventStream(currentThreadId);
        let uploadedAttachments = await uploadThreadAttachments(currentThreadId, clientRequestId, pendingAttachments);
        if (uploadedAttachments.length) {
          setMessages((current) => current.map((item) =>
            item.id === optimisticMessageId ? { ...item, attachments: uploadedAttachments } : item,
          ));
        }
        turnStartAmbiguous = true;
        const response = await fetch(`/api/agent/threads/${encodeURIComponent(currentThreadId)}/turns`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildAgentTurnRequestBody({
            message,
            model,
            effort,
            options,
            attachmentIds: uploadedAttachments.map((attachment) => attachment.id),
            clientRequestId,
          })),
        });
        const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        turnStartAmbiguous = response.status >= 500;
        if (!response.ok) {
          const responseError = readError(payload) || "无法启动 Agent 任务。";
          if (
            /thread not found|不可恢复|工具契约已更新/i.test(responseError) ||
            payload?.code === "THREAD_TOOL_CONTRACT_STALE"
          ) {
            eventSourceRef.current?.close();
            eventSourceRef.current = null;
            const createResponse = await fetch("/api/agent/threads", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model,
                workflow: options?.workflow,
                insightMethod: options?.insightMethod,
              }),
            });
            const createPayload = (await createResponse.json().catch(() => null)) as Record<string, unknown> | null;
            const replacementThreadId = readThreadId(createPayload);
            if (!createResponse.ok || !replacementThreadId) {
              throw new Error(readError(createPayload) || "无法创建替代会话。");
            }
            currentThreadId = replacementThreadId;
            setThreadId(replacementThreadId);
            setThreadTitle(requestedTitle);
            setActivities([]);
            setImages([]);
            setMessages((current) => current.filter((item) => item.role === "user").slice(-1));
            await connectEventStream(replacementThreadId);
            uploadedAttachments = await uploadThreadAttachments(
              replacementThreadId,
              clientRequestId,
              pendingAttachments,
            );
            setMessages((current) => current.map((item) =>
              item.role === "user" ? { ...item, attachments: uploadedAttachments } : item,
            ));
            turnStartAmbiguous = true;
            const retryResponse = await fetch(`/api/agent/threads/${encodeURIComponent(replacementThreadId)}/turns`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(buildAgentTurnRequestBody({
                message,
                model,
                effort,
                options,
                attachmentIds: uploadedAttachments.map((attachment) => attachment.id),
                clientRequestId,
              })),
            });
            const retryPayload = (await retryResponse.json().catch(() => null)) as Record<string, unknown> | null;
            turnStartAmbiguous = retryResponse.status >= 500;
            if (!retryResponse.ok) {
              throw new Error(readError(retryPayload) || "无法启动替代会话任务。");
            }
            const retryTurnId = readTurnId(retryPayload);
            if (retryTurnId) {
              activateTurn(retryTurnId);
              setMessages((current) => bindLatestUserMessageToTurn(current, retryTurnId));
            }
            confirmPendingSubmit(clientRequestId);
            setStatus("running");
            return true;
          }
          throw new Error(responseError);
        }
        if (isPersistedQueuedTurnResponse(response.status, payload)) {
          // The BFF has durably accepted this message into its owned queue, so
          // the composer can cross the same acknowledgement boundary as a Turn.
          confirmPendingSubmit(clientRequestId);
          pendingSubmitClientIdRef.current = null;
          pendingSubmitStartedAtRef.current = null;
          setMessages((current) => current.filter((item) => item.id !== optimisticMessageId));
          const queuedActiveTurnId =
            typeof payload?.activeTurnId === "string" ? payload.activeTurnId : null;
          if (!activeTurnIdRef.current && queuedActiveTurnId) {
            activateTurn(queuedActiveTurnId);
          }
          await refreshQueue(currentThreadId);
          setStatus("running");
          return true;
        }
        const turnId = readTurnId(payload);
        if (turnId) {
          activateTurn(turnId);
          setMessages((current) => bindLatestUserMessageToTurn(current, turnId));
        }
        confirmPendingSubmit(clientRequestId);
        setStatus("running");
        return true;
      } catch (submitError) {
        if (currentThreadId && turnStartAmbiguous) {
          setError("连接中断，正在向 Harness 核对任务是否已被接收。");
          setStatus("connecting");
          return true;
        }
        if (pendingSubmitAcceptanceRef.current?.clientId === clientRequestId) {
          pendingSubmitAcceptanceRef.current = null;
        }
        pendingSubmitClientIdRef.current = null;
        pendingSubmitStartedAtRef.current = null;
        setMessages((current) => current.filter((item) => item.id !== optimisticMessageId));
        setError(submitError instanceof Error ? submitError.message : "Agent 请求失败。");
        setStatus("failed");
        return false;
      }
    },
    [activateTurn, confirmPendingSubmit, connectEventStream, effort, model, refreshQueue, runtimeHealth?.instanceId, status, threadId],
  );

  const retryMessage = useCallback(
    async (
      assistantMessageId: string,
      sourceMessage: ConversationMessage,
      options?: AgentRetryOptions,
    ): Promise<boolean> => {
      if (
        !threadId ||
        sourceMessage.role !== "user" ||
        (!sourceMessage.content.trim() && !sourceMessage.attachments?.length) ||
        status === "running" ||
        status === "connecting" ||
        compactingRef.current ||
        retryingMessageIdRef.current
      ) {
        return false;
      }

      const retryThreadId = threadId;
      const retryTurnId = sourceMessage.turnId;
      if (!retryTurnId) return false;
      const previousStatus = status;
      const clientRequestId = crypto.randomUUID();
      const boundarySequence = messagesRef.current.reduce(
        (boundary, message) => message.turnId === retryTurnId
          ? Math.min(boundary, message.sequence)
          : boundary,
        sourceMessage.sequence,
      );
      retryingMessageIdRef.current = assistantMessageId;
      setRetryingMessageId(assistantMessageId);
      setError(null);
      setStatus("connecting");
      pendingSubmitClientIdRef.current = clientRequestId;
      pendingSubmitStartedAtRef.current = Date.now();
      try {
        const response = await fetch(
          `/api/agent/threads/${encodeURIComponent(retryThreadId)}/messages/${encodeURIComponent(assistantMessageId)}/retry`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              effort,
              externalDataApprovalMode: options?.externalDataApprovalMode ?? "always_ask",
              clientRequestId,
            }),
          },
        );
        const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        if (!response.ok) {
          if (response.status >= 500) {
            setError("连接中断，正在向 Harness 核对重新尝试是否已被接收。");
            return true;
          }
          pendingSubmitClientIdRef.current = null;
          pendingSubmitStartedAtRef.current = null;
          setStatus(previousStatus);
          throw new Error(readError(payload) || "无法重新尝试这条回复。");
        }
        if (threadIdRef.current !== retryThreadId) {
          throw new Error("会话已切换，未执行重新尝试。");
        }
        const result = payload && isRecord(payload.result) ? payload.result : null;
        const turn = result && isRecord(result.turn) ? result.turn : null;
        const newTurnId = turn && typeof turn.id === "string" ? turn.id : null;
        const revertedTurnId = payload && typeof payload.retriedFromTurnId === "string"
          ? payload.retriedFromTurnId
          : null;
        if (!newTurnId || revertedTurnId !== retryTurnId) {
          throw new Error("Harness 未返回有效的重试 Turn。");
        }

        setMessages((current) => {
          const retained = current.filter((message) =>
            message.sequence < boundarySequence ||
            message.turnId === newTurnId ||
            message.clientId === clientRequestId,
          );
          if (retained.some((message) => message.clientId === clientRequestId)) return retained;
          return [
            ...retained,
            {
              ...sourceMessage,
              id: `user-${clientRequestId}`,
              sequence: nextSequence(sequenceRef),
              turnId: newTurnId,
              clientId: clientRequestId,
              delivery: "committed",
            },
          ];
        });
        setActivities((current) => current.filter((activity) =>
          activity.sequence < boundarySequence || activity.turnId === newTurnId
        ));
        setImages((current) => current.filter((image) =>
          image.sequence < boundarySequence || image.turnId === newTurnId
        ));
        pendingUserInputRef.current = null;
        setPendingUserInput(null);
        setAnsweringUserInput(false);
        activateTurn(newTurnId);
        setDurationMs(null);
        setStatus("running");
        return true;
      } catch (retryError) {
        pendingSubmitClientIdRef.current = null;
        pendingSubmitStartedAtRef.current = null;
        setError(retryError instanceof Error ? retryError.message : "无法重新发送这条消息。");
        return false;
      } finally {
        if (retryingMessageIdRef.current === assistantMessageId) {
          retryingMessageIdRef.current = null;
          setRetryingMessageId(null);
        }
      }
    },
    [activateTurn, effort, model, status, threadId],
  );

  const steerMessage = useCallback(
    async (
      text: string,
      options: Pick<AgentSubmitOptions, "workflow" | "insightMethod">,
    ): Promise<boolean> => {
      const message = text.trim();
      const currentThreadId = threadId;
      const currentTurnId = activeTurnIdRef.current;
      if (
        !message ||
        !currentThreadId ||
        !options.workflow ||
        status !== "running" ||
        !currentTurnId ||
        compactingRef.current ||
        interrupting ||
        queueSubmitting
      ) {
        return false;
      }
      setError(null);
      setQueueSubmitting(true);
      const previousUnconfirmed = unconfirmedSteerRef.current;
      const clientRequestId =
        previousUnconfirmed?.threadId === currentThreadId &&
        previousUnconfirmed.turnId === currentTurnId &&
        previousUnconfirmed.workflow === options.workflow &&
        previousUnconfirmed.insightMethod === options.insightMethod &&
        previousUnconfirmed.message === message
          ? previousUnconfirmed.clientRequestId
          : crypto.randomUUID();
      unconfirmedSteerRef.current = {
        threadId: currentThreadId,
        turnId: currentTurnId,
        workflow: options.workflow,
        insightMethod: options.insightMethod,
        message,
        clientRequestId,
      };
      if (
        messagesRef.current.some(
          (item) => item.role === "user" && item.clientId === clientRequestId && item.delivery === "committed",
        )
      ) {
        unconfirmedSteerRef.current = null;
        setQueueSubmitting(false);
        return true;
      }
      const optimisticMessageId = `user-${clientRequestId}`;
      pendingSteerClientIdRef.current = clientRequestId;
      confirmedSteerClientIdRef.current = null;
      setMessages((current) =>
        current.some((item) => item.clientId === clientRequestId)
          ? current
          : [
              ...current,
              {
                id: optimisticMessageId,
                sequence: nextSequence(sequenceRef),
                turnId: currentTurnId,
                role: "user",
                content: message,
                variant: "steer",
                clientId: clientRequestId,
                delivery: "pending",
                status: "completed",
              },
            ],
      );
      let definitiveFailure = false;
      try {
        let definitiveError: Error | null = null;
        try {
          const response = await fetch(`/api/agent/threads/${encodeURIComponent(currentThreadId)}/steer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message,
              clientRequestId,
              workflow: options.workflow,
              insightMethod: options.insightMethod,
              expectedTurnId: currentTurnId,
            }),
          });
          const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
          if (!response.ok && response.status < 500) {
            definitiveFailure = true;
            definitiveError = new Error(readError(payload) || "无法调整当前任务方向。");
          }
        } catch {
          // The Harness may have accepted the steer before the response connection failed.
        }
        if (definitiveError) throw definitiveError;
        const confirmed = await waitForCommittedUserMessage(
          currentThreadId,
          clientRequestId,
          () => confirmedSteerClientIdRef.current === clientRequestId,
          (payload) => {
            if (threadIdRef.current !== currentThreadId) return;
            sequenceRef.current = Math.max(
              sequenceRef.current,
              ...payload.messages.map((item) => item.sequence),
            );
            setMessages((current) => mergeAuthoritativeMessages(current, payload.messages));
          },
        );
        if (!confirmed) {
          throw new Error("Harness 未确认这次方向调整，请重新发送。");
        }
        pendingSteerClientIdRef.current = null;
        confirmedSteerClientIdRef.current = null;
        unconfirmedSteerRef.current = null;
        return true;
      } catch (steerError) {
        pendingSteerClientIdRef.current = null;
        confirmedSteerClientIdRef.current = null;
        if (definitiveFailure) unconfirmedSteerRef.current = null;
        setMessages((current) => current.filter((item) => item.clientId !== clientRequestId));
        setError(steerError instanceof Error ? steerError.message : "无法调整当前任务方向。");
        return false;
      } finally {
        setQueueSubmitting(false);
      }
    },
    [interrupting, queueSubmitting, status, threadId],
  );

  const enqueueMessage = useCallback(
    async (text: string): Promise<boolean> => {
      const message = text.trim();
      const currentThreadId = threadId;
      if (
        !message ||
        !currentThreadId ||
        status !== "running" ||
        compactingRef.current ||
        interrupting ||
        queueSubmitting
      ) {
        return false;
      }
      setError(null);
      setQueueSubmitting(true);
      try {
        const response = await fetch(`/api/agent/threads/${encodeURIComponent(currentThreadId)}/queue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            clientRequestId: crypto.randomUUID(),
          }),
        });
        const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        if (!response.ok) {
          throw new Error(readError(payload) || "无法将消息加入任务队列。");
        }
        await refreshQueue(currentThreadId);
        return true;
      } catch (queueError) {
        setError(queueError instanceof Error ? queueError.message : "无法将消息加入任务队列。");
        return false;
      } finally {
        setQueueSubmitting(false);
      }
    },
    [interrupting, queueSubmitting, refreshQueue, status, threadId],
  );

  const updateQueuedMessage = useCallback(
    async (queuedSubmissionId: string, text: string): Promise<boolean> => {
      const message = text.trim();
      if (!threadId || !queuedSubmissionId || !message || queueOperationId) {
        return false;
      }
      setQueueOperationId(queuedSubmissionId);
      setError(null);
      try {
        const response = await fetch(
          `/api/agent/threads/${encodeURIComponent(threadId)}/queue/${encodeURIComponent(queuedSubmissionId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message }),
          },
        );
        const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        if (!response.ok) {
          throw new Error(readError(payload) || "无法编辑排队消息。");
        }
        await refreshQueue(threadId);
        return true;
      } catch (queueError) {
        setError(queueError instanceof Error ? queueError.message : "无法编辑排队消息。");
        return false;
      } finally {
        setQueueOperationId(null);
      }
    },
    [queueOperationId, refreshQueue, threadId],
  );

  const deleteQueuedMessage = useCallback(
    async (queuedSubmissionId: string): Promise<boolean> => {
      if (!threadId || !queuedSubmissionId || queueOperationId) {
        return false;
      }
      const queuedMessage = queuedMessages.find((item) => item.id === queuedSubmissionId);
      if (!queuedMessage) {
        return false;
      }
      setError(null);
      setQueuedMessages((current) => current.filter((item) => item.id !== queuedSubmissionId));
      queueRefreshSuppressionRef.current += 1;
      try {
        const response = await fetch(
          `/api/agent/threads/${encodeURIComponent(threadId)}/queue/${encodeURIComponent(queuedSubmissionId)}`,
          { method: "DELETE" },
        );
        const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        if (!response.ok) {
          throw new Error(readError(payload) || "无法删除排队消息。");
        }
        return true;
      } catch (queueError) {
        await refreshQueue(threadId);
        setError(queueError instanceof Error ? queueError.message : "无法删除排队消息。");
        return false;
      } finally {
        queueRefreshSuppressionRef.current = Math.max(0, queueRefreshSuppressionRef.current - 1);
      }
    },
    [queueOperationId, queuedMessages, refreshQueue, threadId],
  );

  const steerQueuedMessage = useCallback(
    async (queuedSubmissionId: string): Promise<boolean> => {
      if (!threadId || !activeTurnIdRef.current || !queuedSubmissionId || queueOperationId) {
        return false;
      }
      const queuedMessage = queuedMessages.find((item) => item.id === queuedSubmissionId);
      if (!queuedMessage) {
        return false;
      }
      const expectedTurnId = activeTurnIdRef.current;
      setError(null);
      setQueueOperationId(queuedSubmissionId);
      try {
        const response = await fetch(
          `/api/agent/threads/${encodeURIComponent(threadId)}/queue/${encodeURIComponent(queuedSubmissionId)}/steer`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedTurnId,
              clientUserMessageId: queuedMessage.clientUserMessageId,
            }),
          },
        );
        const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        if (!response.ok) {
          throw new Error(readError(payload) || "无法调整当前任务方向。");
        }
        const transition = payload && isRecord(payload.result) ? payload.result : null;
        const startedTurnId = transition && typeof transition.turnId === "string" ? transition.turnId : null;
        if (
          (transition?.mode === "startedAfterTurnEnded" ||
            transition?.mode === "interruptedAndStarted") &&
          startedTurnId
        ) {
          activateTurn(startedTurnId);
          setStatus("running");
        }
        await refreshQueue(threadId);
        return true;
      } catch (queueError) {
        await refreshQueue(threadId);
        setError(queueError instanceof Error ? queueError.message : "无法调整当前任务方向。");
        return false;
      } finally {
        setQueueOperationId(null);
      }
    },
    [activateTurn, queueOperationId, queuedMessages, refreshQueue, threadId],
  );

  const clearQueuedMessages = useCallback(async (): Promise<void> => {
    if (!threadId || queueOperationId || queuedMessages.length === 0) {
      return;
    }
    const deletableMessages = queuedMessages;
    if (deletableMessages.length === 0) {
      return;
    }
    const deletableIds = new Set(deletableMessages.map((item) => item.id));
    setError(null);
    setQueuedMessages((current) => current.filter((item) => !deletableIds.has(item.id)));
    queueRefreshSuppressionRef.current += 1;
    try {
      const responses = await Promise.all(
        deletableMessages.map((item) =>
          fetch(`/api/agent/threads/${encodeURIComponent(threadId)}/queue/${encodeURIComponent(item.id)}`, {
            method: "DELETE",
          }),
        ),
      );
      const failedResponse = responses.find((response) => !response.ok);
      if (failedResponse) {
        const payload = (await failedResponse.json().catch(() => null)) as Record<string, unknown> | null;
        throw new Error(readError(payload) || "无法关闭任务队列。");
      }
    } catch (queueError) {
      await refreshQueue(threadId);
      setError(queueError instanceof Error ? queueError.message : "无法关闭任务队列。");
    } finally {
      queueRefreshSuppressionRef.current = Math.max(0, queueRefreshSuppressionRef.current - 1);
    }
  }, [queueOperationId, queuedMessages, refreshQueue, threadId]);

  const interrupt = useCallback(async () => {
    if (!threadId || !activeTurnId || interrupting) {
      return;
    }
    setInterrupting(true);
    try {
      const response = await fetch(
        `/api/agent/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(activeTurnId)}/interrupt`,
        { method: "POST" },
      );
      if (!response.ok) {
        if (response.status === 404 || response.status === 409) {
          setInterrupting(false);
          setError("停止请求与 Harness 当前状态不一致，正在重新核对任务状态。");
        } else {
          setInterrupting(false);
          setError("无法停止当前任务。");
        }
      }
    } catch {
      setInterrupting(false);
      setError("无法停止当前任务。");
    }
  }, [activeTurnId, interrupting, threadId]);

  const respondToUserInput = useCallback(
    async (answers: Record<string, { answers: string[] }>): Promise<boolean> => {
      if (!threadId || !pendingUserInput || answeringUserInput) return false;
      setAnsweringUserInput(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/agent/threads/${encodeURIComponent(threadId)}/user-input/${encodeURIComponent(
            pendingUserInput.requestId,
          )}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ answers }),
          },
        );
        const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        if (!response.ok) {
          if (isEndedRequestUserInputResponse(response.status, payload)) {
            pendingUserInputRef.current = null;
            setPendingUserInput(null);
            setError(readError(payload) || "待回答请求已经结束，正在重新核对任务状态。");
            return false;
          }
          throw new Error(readError(payload) || "无法提交答案。");
        }
        const answerMessage = payload && typeof payload.answerMessage === "string"
          ? payload.answerMessage.trim()
          : "";
        const displayAnswer = shouldDisplayRequestUserInputAnswer(pendingUserInput.origin);
        if (displayAnswer && answerMessage) {
          upsertUserMessage(
            setMessages,
            `user-input-answer-${pendingUserInput.requestId}`,
            answerMessage,
            pendingUserInput.turnId,
            nextSequence(sequenceRef),
          );
        }
        if (displayAnswer && payload?.answerIndexed === false) {
          setError("选择已提交，但暂时无法保存到对话记录。刷新后可能需要重新确认。");
        }
        pendingUserInputRef.current = null;
        setPendingUserInput(null);
        return true;
      } catch (responseError) {
        setError(responseError instanceof Error ? responseError.message : "无法提交答案。");
        return false;
      } finally {
        setAnsweringUserInput(false);
      }
    },
    [answeringUserInput, pendingUserInput, threadId],
  );

  useEffect(() => {
    if (
      status === "running" &&
      startedAt &&
      runtimeHealth &&
      runtimeHealth.observedAt >= startedAt &&
      (!runtimeHealth.available ||
        (runtimeInstanceIdRef.current !== null && runtimeInstanceIdRef.current !== runtimeHealth.instanceId))
    ) {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setError("Agent 运行时连接已变化，正在从 Harness 恢复任务状态。");
      if (runtimeHealth.available && threadId) {
        runtimeInstanceIdRef.current = runtimeHealth.instanceId;
        void connectEventStream(threadId).catch(() => undefined);
      }
    }
  }, [connectEventStream, runtimeHealth, startedAt, status, threadId]);

  useEffect(() => {
    if (status !== "completed" || !threadId || !lastTurnId || titleGenerationAttemptRef.current.has(threadId)) {
      return;
    }
    titleGenerationAttemptRef.current.add(threadId);
    void (async () => {
      try {
        const response = await fetch(`/api/agent/threads/${encodeURIComponent(threadId)}/title`, {
          method: "POST",
        });
        const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        if (!response.ok || !payload || typeof payload.title !== "string") {
          titleGenerationAttemptRef.current.delete(threadId);
          return;
        }
        setThreadTitle(payload.title);
      } catch {
        titleGenerationAttemptRef.current.delete(threadId);
      }
    })();
  }, [lastTurnId, status, threadId]);

  useEffect(() => {
    return () => {
      historyLoadControllerRef.current?.abort();
      eventSourceRef.current?.close();
    };
  }, []);

  return {
    threadId,
    threadTitle,
    messages,
    activities,
    images,
    status,
    activeTurnId,
    interrupting,
    loadingHistory,
    loadingOlderHistory,
    hasOlderHistory: Boolean(historyCursor),
    compacting,
    queuedMessages,
    queueSubmitting,
    queueOperationId,
    pendingUserInput,
    answeringUserInput,
    currentTurnId: activeTurnId ?? lastTurnId,
    durationMs,
    startedAt,
    error,
    feedbackError,
    feedbackSubmittingIds,
    retryingMessageId,
    submit,
    retryMessage,
    steerMessage,
    enqueueMessage,
    updateQueuedMessage,
    deleteQueuedMessage,
    steerQueuedMessage,
    clearQueuedMessages,
    interrupt,
    respondToUserInput,
    setMessageFeedback,
    resetThread,
    loadThread,
    loadOlderHistory,
  };
}

export function findRetrySourceMessage(
  messages: ConversationMessage[],
  assistantMessage: ConversationMessage,
): ConversationMessage | null {
  if (
    assistantMessage.role !== "assistant" ||
    assistantMessage.phase === "commentary" ||
    assistantMessage.status !== "completed"
  ) {
    return null;
  }
  const candidates = messages.filter((message) =>
    message.role === "user" &&
    message.status === "completed" &&
    message.sequence < assistantMessage.sequence &&
    (Boolean(message.content.trim()) || Boolean(message.attachments?.length)),
  );
  const sameTurn = assistantMessage.turnId
    ? candidates.filter((message) => message.turnId === assistantMessage.turnId)
    : [];
  if (sameTurn.length) {
    return sameTurn.reduce<ConversationMessage | null>(
      (first, message) => !first || message.sequence < first.sequence ? message : first,
      null,
    );
  }
  return candidates.reduce<ConversationMessage | null>(
    (latest, message) => !latest || message.sequence > latest.sequence ? message : latest,
    null,
  );
}

export async function waitForCommittedUserMessage(
  threadId: string,
  clientRequestId: string,
  isAlreadyConfirmed: () => boolean,
  onRead: (payload: StoredThreadResponse) => void,
  timeoutMs = 12_000,
  pollIntervalMs = 500,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isAlreadyConfirmed()) return true;
    try {
      const response = await fetch(`/api/agent/threads/${encodeURIComponent(threadId)}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as StoredThreadResponse | null;
      if (response.ok && payload) {
        onRead(payload);
        if (
          payload.messages.some(
            (item) => item.role === "user" && item.clientId === clientRequestId,
          )
        ) {
          return true;
        }
      }
    } catch {
      // A later read or the SSE stream may still confirm the same client id.
    }
    await new Promise((resolve) => window.setTimeout(resolve, pollIntervalMs));
  }
  return isAlreadyConfirmed();
}

function resequenceHistoricalPage(
  payload: StoredThreadResponse,
  currentFloor: number,
): {
  messages: ConversationMessage[];
  activities: AgentActivity[];
  images: GeneratedImageItem[];
  floor: number;
} {
  const timeline = [
    ...payload.messages.map((item) => ({ kind: "message" as const, item })),
    ...payload.activities.map((item) => ({ kind: "activity" as const, item })),
    ...payload.images.map((item) => ({ kind: "image" as const, item })),
  ].sort((left, right) => left.item.sequence - right.item.sequence);
  let sequence = currentFloor - timeline.length;
  const messages: ConversationMessage[] = [];
  const activities: AgentActivity[] = [];
  const images: GeneratedImageItem[] = [];
  for (const entry of timeline) {
    const item = { ...entry.item, sequence: sequence++ };
    if (entry.kind === "message") messages.push(item as ConversationMessage);
    if (entry.kind === "activity") activities.push(item as AgentActivity);
    if (entry.kind === "image") images.push(item as GeneratedImageItem);
  }
  return { messages, activities, images, floor: currentFloor - timeline.length };
}

function prependUniqueById<T extends { id: string }>(current: T[], older: T[]): T[] {
  const currentIds = new Set(current.map((item) => item.id));
  return [...older.filter((item) => !currentIds.has(item.id)), ...current];
}

function upsertAssistantMessage(
  setter: React.Dispatch<React.SetStateAction<ConversationMessage[]>>,
  id: string,
  content: string,
  phase: ConversationMessage["phase"],
  status: ConversationMessage["status"],
  turnId: string | null,
  sequence: number,
) {
  setter((current) => {
    const incoming: ConversationMessage = {
      id,
      sequence,
      turnId,
      role: "assistant",
      content,
      phase,
      status,
    };
    const existing = findMatchingConversationMessage(current, incoming);
    if (!existing) {
      return [...current, incoming];
    }
    return current.map((message) =>
      message.id === existing.id
        ? { ...message, id, turnId, content, phase, status }
        : message,
    );
  });
}

function upsertUserMessage(
  setter: React.Dispatch<React.SetStateAction<ConversationMessage[]>>,
  id: string,
  content: string,
  turnId: string | null,
  sequence: number,
  clientId: string | null = null,
  skillName: string | null = null,
) {
  setter((current) => {
    const existing = current.find(
      (message) => message.id === id || Boolean(clientId && message.clientId === clientId),
    );
    if (existing) {
      return current.map((message) =>
        message.id === existing.id
          ? {
              ...message,
              id,
              content,
              turnId,
              clientId: clientId ?? message.clientId,
              skillName: skillName ?? message.skillName,
              delivery: "committed",
              status: "completed",
            }
          : message,
      );
    }
    const optimistic = clientId
      ? undefined
      : current.find(
          (message) =>
            message.role === "user" &&
            !message.clientId &&
            message.turnId === turnId &&
            message.content === content,
        );
    if (optimistic) {
      return current.map((message) =>
        message.id === optimistic.id
          ? {
              ...message,
              id,
              clientId: clientId ?? message.clientId,
              variant: message.variant ?? "default",
              delivery: "committed",
              status: "completed",
            }
          : message,
      );
    }
    const variant = current.some(
      (message) => message.role === "user" && Boolean(turnId) && message.turnId === turnId,
    )
      ? "steer"
      : "default";
    return [
      ...current,
      {
        id,
        sequence,
        turnId,
        role: "user",
        content,
        variant,
        clientId,
        skillName,
        delivery: "committed",
        status: "completed",
      },
    ];
  });
}

function upsertActivity(
  setter: React.Dispatch<React.SetStateAction<AgentActivity[]>>,
  activity: AgentActivity,
) {
  setter((current) => {
    if (!current.some((item) => item.id === activity.id)) {
      return [...current, activity];
    }
    return current.map((item) =>
      item.id === activity.id
        ? {
            ...activity,
            sequence: item.sequence,
            turnId: item.turnId ?? activity.turnId,
          }
        : item,
    );
  });
}

function activityFromItem(
  item: Record<string, unknown>,
  completed: boolean,
  turnId: string | null,
  sequence: number,
): AgentActivity | null {
  const status = completed
    ? item.status === "failed"
      ? "failed"
      : "completed"
    : "running";
  if (item.type === "imageGeneration") {
    return {
      id: item.id as string,
      sequence,
      turnId,
      kind: "image",
      label: completed
        ? status === "failed"
          ? "图片生成未完成"
          : "图片生成完成"
        : "正在生成图片",
      durationMs: typeof item.durationMs === "number" ? item.durationMs : null,
      status,
    };
  }
  if (item.type === "commandExecution") {
    const command = typeof item.command === "string" ? item.command : "命令";
    return {
      id: item.id as string,
      sequence,
      turnId,
      kind: "command",
      label: completed ? "已运行命令" : "正在运行命令",
      detail: compactText(command),
      durationMs: typeof item.durationMs === "number" ? item.durationMs : null,
      status,
    };
  }
  if (item.type === "dynamicToolCall") {
    const metadata = readDynamicToolActivity(item);
    return {
      id: item.id as string,
      sequence,
      turnId,
      kind: metadata.kind,
      label:
        metadata.kind === "image"
          ? completed
            ? "图片生成完成"
            : "正在生成图片"
          : metadata.isWebSearch
            ? completed
              ? "搜索完成"
              : "正在搜索网页"
            : completed
              ? "工具调用完成"
              : "正在调用工具",
      ...(metadata.detail ? { detail: metadata.detail } : {}),
      durationMs: typeof item.durationMs === "number" ? item.durationMs : null,
      ...(metadata.research ? { research: metadata.research } : {}),
      ...(metadata.sources.length > 0 ? { sources: metadata.sources } : {}),
      status,
    };
  }
  if (item.type === "mcpToolCall") {
    const metadata = readMcpToolActivity(item);
    return {
      id: item.id as string,
      sequence,
      turnId,
      kind: metadata.kind,
      label: metadata.isWebSearch
        ? completed
          ? "搜索完成"
          : "正在搜索网页"
        : completed
          ? "连接器调用完成"
          : "正在调用连接器",
      ...(metadata.detail ? { detail: metadata.detail } : {}),
      durationMs: typeof item.durationMs === "number" ? item.durationMs : null,
      ...(metadata.sources.length > 0 ? { sources: metadata.sources } : {}),
      status,
    };
  }
  if (item.type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes.filter(isRecord) : [];
    const paths = changes.map((change) => (typeof change.path === "string" ? change.path : "")).filter(Boolean);
    return {
      id: item.id as string,
      sequence,
      turnId,
      kind: "file",
      label: completed ? "已编辑文件" : "正在编辑文件",
      detail: paths.length ? paths.slice(0, 3).join("、") : undefined,
      durationMs: typeof item.durationMs === "number" ? item.durationMs : null,
      status,
    };
  }
  if (item.type === "reasoning") {
    return null;
  }
  if (item.type === "contextCompaction") {
    return {
      id: item.id as string,
      sequence,
      turnId,
      kind: "compact",
      label: completed ? "上下文整理完成" : "正在整理上下文",
      durationMs: typeof item.durationMs === "number" ? item.durationMs : null,
      status,
    };
  }
  if (item.type === "webSearch") {
    const sources = readWebSourcesFromToolItem(item);
    return {
      id: item.id as string,
      sequence,
      turnId,
      kind: "search",
      label: completed ? "搜索完成" : "正在搜索",
      detail: String(item.query ?? ""),
      durationMs: typeof item.durationMs === "number" ? item.durationMs : null,
      ...(sources.length > 0 ? { sources } : {}),
      status,
    };
  }
  return null;
}

function readThreadId(payload: Record<string, unknown> | null): string | null {
  const result = payload && isRecord(payload.result) ? payload.result : null;
  const thread = result && isRecord(result.thread) ? result.thread : null;
  return thread && typeof thread.id === "string" ? thread.id : null;
}

function readTurnId(payload: Record<string, unknown> | null): string | null {
  const result = payload && isRecord(payload.result) ? payload.result : null;
  const turn = result && isRecord(result.turn) ? result.turn : null;
  return turn && typeof turn.id === "string" ? turn.id : null;
}

function readError(payload: Record<string, unknown> | null): string | null {
  return payload && typeof payload.error === "string" ? payload.error : null;
}

async function uploadThreadAttachments(
  threadId: string,
  clientRequestId: string,
  attachments: PendingAttachmentUpload[],
): Promise<ConversationAttachment[]> {
  if (!attachments.length) return [];
  const formData = new FormData();
  formData.set("clientRequestId", clientRequestId);
  for (const attachment of attachments) formData.append("files", attachment.file, attachment.name);
  const response = await fetch(`/api/agent/threads/${encodeURIComponent(threadId)}/attachments`, {
    method: "POST",
    body: formData,
  });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !payload || !Array.isArray(payload.attachments)) {
    throw new Error(readError(payload) || "无法上传附件。");
  }
  const uploaded = payload.attachments.map(readConversationAttachment).filter(
    (attachment): attachment is ConversationAttachment => Boolean(attachment),
  );
  if (uploaded.length !== attachments.length) throw new Error("附件服务返回了不完整的上传结果。");
  return uploaded;
}

function readConversationAttachment(value: unknown): ConversationAttachment | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  const name = typeof value.name === "string" ? value.name : "";
  const mimeType = typeof value.mimeType === "string" ? value.mimeType : "";
  const size = typeof value.size === "number" ? value.size : -1;
  const kind = value.kind === "image" || value.kind === "document" ? value.kind : null;
  const url = typeof value.url === "string" ? value.url : "";
  return id && name && mimeType && size >= 0 && kind && url
    ? { id, name, mimeType, size, kind, url }
    : null;
}

export function readPendingRequestUserInputEvent(event: Record<string, unknown>): PendingRequestUserInput | null {
  if (!isRecord(event.params)) return null;
  if (event.type === "server_request" && event.method === CODEX_REQUEST_USER_INPUT_METHOD) {
    if (typeof event.id !== "string" && typeof event.id !== "number") return null;
    return readPendingRequestUserInputPayload({
      ...event.params,
      requestId: String(event.id),
      origin: "codex_app_server",
    });
  }
  if (event.type === "notification" && event.method === COMMERCE_APPROVAL_REQUESTED_METHOD) {
    return readPendingRequestUserInputPayload({
      ...event.params,
      origin: "commerce_approval",
    });
  }
  return null;
}

export function readPendingRequestUserInputPayload(value: unknown): PendingRequestUserInput | null {
  if (!isRecord(value)) return null;
  const requestId = typeof value.requestId === "string" ? value.requestId : "";
  const threadId = typeof value.threadId === "string" ? value.threadId : "";
  const turnId = typeof value.turnId === "string" ? value.turnId : "";
  const itemId = typeof value.itemId === "string" ? value.itemId : "";
  if (!requestId || !threadId || !turnId || !itemId || !Array.isArray(value.questions)) return null;
  const questions = value.questions
    .map((question): RequestUserInputQuestion | null => {
      if (
        !isRecord(question) ||
        typeof question.id !== "string" ||
        typeof question.header !== "string" ||
        typeof question.question !== "string" ||
        (question.options !== null && question.options !== undefined && !Array.isArray(question.options))
      ) {
        return null;
      }
      const options = (Array.isArray(question.options) ? question.options : [])
        .map((option): RequestUserInputQuestionOption | null =>
          isRecord(option) && typeof option.label === "string" && typeof option.description === "string"
            ? { label: option.label, description: option.description }
            : null,
        )
        .filter((option): option is RequestUserInputQuestionOption => Boolean(option));
      return {
        id: question.id,
        header: question.header,
        question: question.question,
        isOther: question.isOther !== false,
        isSecret: question.isSecret === true,
        options,
      };
    })
    .filter((question): question is RequestUserInputQuestion => Boolean(question));
  if (!questions.length || questions.length > 3) return null;
  const action = value.action === "skill.publish" || value.action === "external_data.call" ||
    value.action === "product_catalog.activate_import"
    ? value.action
    : undefined;
  const origin = value.origin === "commerce_approval" || action
    ? "commerce_approval"
    : "codex_app_server";
  if (origin === "commerce_approval" && !action) return null;
  return {
    requestId,
    threadId,
    turnId,
    itemId,
    questions,
    isBlocking: value.isBlocking !== false,
    receivedAt: typeof value.receivedAt === "string" ? value.receivedAt : new Date().toISOString(),
    origin,
    action,
  };
}

function parseObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function compactText(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 110 ? `${compact.slice(0, 110)}…` : compact;
}

function nextSequence(reference: React.MutableRefObject<number>): number {
  reference.current += 1;
  return reference.current;
}

function bindLatestUserMessageToTurn(messages: ConversationMessage[], turnId: string): ConversationMessage[] {
  const index = messages.findLastIndex((message) => message.role === "user" && !message.turnId);
  if (index === -1) {
    return messages;
  }
  return messages.map((message, messageIndex) =>
    messageIndex === index ? { ...message, turnId } : message,
  );
}

function readUserMessageText(item: Record<string, unknown>): string {
  const content = Array.isArray(item.content) ? item.content.filter(isRecord) : [];
  return content
    .filter((entry) => entry.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text as string)
    .join("\n")
    .trim();
}

export function readUserMessageSkillName(item: Record<string, unknown>): string | null {
  const content = Array.isArray(item.content) ? item.content.filter(isRecord) : [];
  const skill = content
    .filter((entry) => entry.type === "skill" && typeof entry.name === "string")
    .at(-1);
  return skill && typeof skill.name === "string" ? skill.name : null;
}
