"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  reconcilePendingInputState,
  type QueuedMessage,
} from "./pending-input-state";
import {
  findMatchingConversationMessage,
  mergeAuthoritativeMessages,
} from "./message-reconciliation";
import {
  activateTurnClock,
  shouldExpireActiveTurn,
  shouldIgnoreTerminalSnapshotWhileConnecting,
} from "./turn-lifecycle";
import {
  readWebSourcesFromToolItem,
  type WebSource,
} from "./web-sources";

export type { QueuedMessage } from "./pending-input-state";

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
  status: "streaming" | "completed";
};

export type AgentActivity = {
  id: string;
  sequence: number;
  turnId?: string | null;
  kind: "command" | "file" | "tool" | "search" | "image" | "compact";
  label: string;
  detail?: string;
  durationMs?: number | null;
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

export type AgentSubmitOptions = {
  title?: string;
  workflow?: "commerce-copywriting";
};

export type AgentThreadSummary = {
  threadId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: "idle" | "running" | "completed" | "interrupted" | "failed";
  activeTurnId: string | null;
  turnStartedAt: string | null;
  durationMs: number | null;
};

type StoredThreadResponse = {
  thread: {
    id: string;
    title: string;
    lastTurnId: string | null;
    status: "running" | "completed" | "interrupted" | "failed";
    durationMs: number | null;
    startedAt: string | null;
  };
  messages: ConversationMessage[];
  activities: AgentActivity[];
  images: GeneratedImageItem[];
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
  const [compacting, setCompacting] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const [pendingSteers, setPendingSteers] = useState<QueuedMessage[]>([]);
  const [queueSubmitting, setQueueSubmitting] = useState(false);
  const [queueOperationId, setQueueOperationId] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const sequenceRef = useRef(0);
  const activeTurnIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const runtimeInstanceIdRef = useRef<string | null>(null);
  const compactingRef = useRef(false);
  const queueRefreshSuppressionRef = useRef(0);
  const pendingSteerRequestsRef = useRef(new Map<string, QueuedMessage>());
  const committedUserMessageClientIdsRef = useRef(new Set<string>());
  const threadReconcileInFlightRef = useRef(false);

  const refreshQueue = useCallback(async (id: string): Promise<void> => {
    try {
      const response = await fetch(`/api/agent/threads/${encodeURIComponent(id)}/queue`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as {
        queue?: unknown;
        pendingSteers?: unknown;
      } | null;
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
            pendingSteer: item.pendingSteer === true,
          }))
          .filter((item) => item.id && item.clientUserMessageId && item.content);

      const serverPendingSteers = normalizeQueue(
        Array.isArray(payload.pendingSteers) ? payload.pendingSteers : [],
      ).map((item) => ({ ...item, pendingSteer: true }));
      const nextState = reconcilePendingInputState(
        normalizeQueue(payload.queue),
        serverPendingSteers,
        pendingSteerRequestsRef.current.values(),
        committedUserMessageClientIdsRef.current,
      );
      setPendingSteers(nextState.pendingSteers);
      setQueuedMessages(nextState.queue);
    } catch {
      // Queue notifications are advisory; the active turn remains usable if a refresh fails.
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

  const failActiveTurn = useCallback((message: string) => {
    const failedTurnId = activeTurnIdRef.current;
    activeTurnIdRef.current = null;
    runtimeInstanceIdRef.current = null;
    compactingRef.current = false;
    pendingSteerRequestsRef.current.clear();
    queueRefreshSuppressionRef.current = 0;
    threadReconcileInFlightRef.current = false;
    setPendingSteers([]);
    setActiveTurnId(null);
    setCompacting(false);
    setInterrupting(false);
    setDurationMs(startedAtRef.current ? Date.now() - startedAtRef.current : null);
    setStatus("failed");
    setError(message);
    if (failedTurnId) {
      setActivities((current) =>
        current.map((activity) =>
          activity.turnId === failedTurnId && activity.status === "running"
            ? { ...activity, label: failedActivityLabel(activity.kind), status: "failed" }
            : activity,
        ),
      );
    }
  }, []);

  const handleGatewayEvent = useCallback((event: MessageEvent<string>) => {
    const gatewayEvent = parseObject(event.data);
    if (!gatewayEvent || gatewayEvent.type !== "notification") {
      return;
    }
    const method = typeof gatewayEvent.method === "string" ? gatewayEvent.method : "";
    const params = isRecord(gatewayEvent.params) ? gatewayEvent.params : {};

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
      failActiveTurn("企业成员资格、角色、合同或用量门禁已变更，当前任务已被安全终止。");
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
        const content = readUserMessageText(item);
        const clientId = typeof item.clientId === "string" ? item.clientId : null;
        if (clientId) {
          pendingSteerRequestsRef.current.delete(clientId);
          committedUserMessageClientIdsRef.current.add(clientId);
          setPendingSteers((current) =>
            current.filter((pending) => pending.clientUserMessageId !== clientId),
          );
        }
        if (content) {
          upsertUserMessage(
            setMessages,
            item.id,
            content,
            turnId,
            nextSequence(sequenceRef),
            clientId,
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
      pendingSteerRequestsRef.current.clear();
      activeTurnIdRef.current = null;
      runtimeInstanceIdRef.current = null;
      compactingRef.current = false;
      setActiveTurnId(null);
      setCompacting(false);
      setPendingSteers([]);
      setInterrupting(false);
      setDurationMs(
        typeof turn.durationMs === "number"
          ? turn.durationMs
          : startedAtRef.current
            ? Date.now() - startedAtRef.current
            : null,
      );
      setStatus(turnStatus === "interrupted" ? "interrupted" : turnStatus === "failed" ? "failed" : "completed");
      if (turnStatus === "failed" && isRecord(turn.error) && typeof turn.error.message === "string") {
        setError(turn.error.message);
      } else {
        setError(null);
      }
      if (threadId) {
        void refreshQueue(threadId);
      }
      return;
    }

    if (method === "error") {
      const itemError = isRecord(params.error) ? params.error : {};
      setInterrupting(false);
      setError(typeof itemError.message === "string" ? itemError.message : "Agent 执行失败。");
      setStatus("failed");
    }
  }, [activateTurn, failActiveTurn, refreshQueue, threadId]);

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
        const response = await fetch(`/api/agent/threads/${encodeURIComponent(threadId)}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as StoredThreadResponse | null;
        if (!response.ok || !payload || cancelled) {
          return;
        }

        const authoritativeByClientId = new Map(
          payload.messages
            .filter((message) => message.role === "user" && typeof message.clientId === "string")
            .map((message) => [message.clientId as string, message]),
        );
        if (authoritativeByClientId.size > 0) {
          for (const clientId of authoritativeByClientId.keys()) {
            pendingSteerRequestsRef.current.delete(clientId);
            committedUserMessageClientIdsRef.current.add(clientId);
          }
          setPendingSteers((current) =>
            current.filter((pending) => !authoritativeByClientId.has(pending.clientUserMessageId)),
          );
        }
        sequenceRef.current = Math.max(
          sequenceRef.current,
          ...payload.messages.map((message) => message.sequence),
        );
        setMessages((current) => mergeAuthoritativeMessages(current, payload.messages));

        if (shouldIgnoreTerminalSnapshotWhileConnecting(status, payload.thread.status)) {
          return;
        }

        if (payload.thread.status === "running") {
          if (payload.thread.lastTurnId) {
            const authoritativeStartedAt = payload.thread.startedAt
              ? new Date(payload.thread.startedAt).getTime()
              : Date.now();
            activateTurn(payload.thread.lastTurnId, authoritativeStartedAt);
          }
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
        pendingSteerRequestsRef.current.clear();
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
        setPendingSteers([]);
        setError(null);
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
  }, [activateTurn, refreshQueue, status, threadId]);

  const resetThread = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    sequenceRef.current = 0;
    activeTurnIdRef.current = null;
    startedAtRef.current = null;
    runtimeInstanceIdRef.current = null;
    compactingRef.current = false;
    pendingSteerRequestsRef.current.clear();
    committedUserMessageClientIdsRef.current.clear();
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
    setCompacting(false);
    setQueuedMessages([]);
    setPendingSteers([]);
    setQueueSubmitting(false);
    setQueueOperationId(null);
  }, []);

  const loadThread = useCallback(
    async (summary: AgentThreadSummary): Promise<boolean> => {
      setLoadingHistory(true);
      setError(null);
      pendingSteerRequestsRef.current.clear();
      committedUserMessageClientIdsRef.current.clear();
      queueRefreshSuppressionRef.current = 0;
      threadReconcileInFlightRef.current = false;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      try {
        const response = await fetch(`/api/agent/threads/${encodeURIComponent(summary.threadId)}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as StoredThreadResponse | { error?: string } | null;
        if (!response.ok || !payload || !("thread" in payload)) {
          if (response.status === 404) {
            resetThread();
          }
          setError(payload && "error" in payload && typeof payload.error === "string" ? payload.error : "无法读取对话记录。");
          return false;
        }
        const maxSequence = [...payload.messages, ...payload.activities, ...payload.images].reduce(
          (maximum, item) => Math.max(maximum, item.sequence),
          0,
        );
        sequenceRef.current = maxSequence;
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
        for (const message of payload.messages) {
          if (message.role === "user" && message.clientId) {
            committedUserMessageClientIdsRef.current.add(message.clientId);
          }
        }
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
        setPendingSteers([]);
        await refreshQueue(payload.thread.id);
        if (payload.thread.status === "running") {
          await connectEventStream(payload.thread.id);
        }
        return true;
      } catch {
        setError("无法读取对话记录。");
        return false;
      } finally {
        setLoadingHistory(false);
      }
    },
    [connectEventStream, refreshQueue, resetThread, runtimeHealth?.instanceId],
  );

  const submit = useCallback(
    async (text: string, options?: AgentSubmitOptions) => {
      const message = text.trim();
      if (!message || status === "running" || status === "connecting") {
        return;
      }
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
      const requestedTitle = options?.title?.trim().slice(0, 80) || createThreadTitle(message);
      setMessages((current) => [
        ...current,
        {
          id: optimisticMessageId,
          sequence: nextSequence(sequenceRef),
          turnId: null,
          role: "user",
          content: message,
          clientId: clientRequestId,
          delivery: "pending",
          status: "completed",
        },
      ]);
      setThreadTitle((current) => current ?? requestedTitle);

      try {
        let currentThreadId = threadId;
        if (!currentThreadId) {
          const response = await fetch("/api/agent/threads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, title: requestedTitle }),
          });
          const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
          currentThreadId = readThreadId(payload);
          if (!response.ok || !currentThreadId) {
            throw new Error(readError(payload) || "无法创建 Agent 会话。");
          }
          setThreadId(currentThreadId);
        }

        await connectEventStream(currentThreadId);
        const response = await fetch(`/api/agent/threads/${encodeURIComponent(currentThreadId)}/turns`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, model, effort, workflow: options?.workflow, clientRequestId }),
        });
        const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        if (!response.ok) {
          const responseError = readError(payload) || "无法启动 Agent 任务。";
          if (/thread not found|不可恢复/i.test(responseError)) {
            eventSourceRef.current?.close();
            eventSourceRef.current = null;
            const createResponse = await fetch("/api/agent/threads", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ model, title: requestedTitle }),
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
            const retryResponse = await fetch(`/api/agent/threads/${encodeURIComponent(replacementThreadId)}/turns`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message, model, effort, workflow: options?.workflow, clientRequestId }),
            });
            const retryPayload = (await retryResponse.json().catch(() => null)) as Record<string, unknown> | null;
            if (!retryResponse.ok) {
              throw new Error(readError(retryPayload) || "无法启动替代会话任务。");
            }
            const retryTurnId = readTurnId(retryPayload);
            if (retryTurnId) {
              activateTurn(retryTurnId);
              setMessages((current) => bindLatestUserMessageToTurn(current, retryTurnId));
            }
            setStatus("running");
            return;
          }
          throw new Error(responseError);
        }
        if (response.status === 202 && payload?.queued === true) {
          setMessages((current) => current.filter((item) => item.id !== optimisticMessageId));
          const queuedActiveTurnId =
            typeof payload.activeTurnId === "string" ? payload.activeTurnId : null;
          if (!activeTurnIdRef.current && queuedActiveTurnId) {
            activateTurn(queuedActiveTurnId);
          }
          await refreshQueue(currentThreadId);
          setStatus("running");
          return;
        }
        const turnId = readTurnId(payload);
        if (turnId) {
          activateTurn(turnId);
          setMessages((current) => bindLatestUserMessageToTurn(current, turnId));
        }
        setStatus("running");
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "Agent 请求失败。");
        setStatus("failed");
      }
    },
    [activateTurn, connectEventStream, effort, model, refreshQueue, runtimeHealth?.instanceId, status, threadId],
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
          body: JSON.stringify({ message, clientRequestId: crypto.randomUUID() }),
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
      if (!queuedMessage || queuedMessage.pendingSteer) {
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
      if (pendingSteerRequestsRef.current.has(queuedMessage.clientUserMessageId)) {
        return false;
      }
      const expectedTurnId = activeTurnIdRef.current;
      const pendingSteer = { ...queuedMessage, pendingSteer: true };
      pendingSteerRequestsRef.current.set(queuedMessage.clientUserMessageId, pendingSteer);
      setError(null);
      setQueuedMessages((current) => current.filter((item) => item.id !== queuedSubmissionId));
      setPendingSteers((current) =>
        current.some((item) => item.clientUserMessageId === pendingSteer.clientUserMessageId)
          ? current
          : [...current, pendingSteer],
      );
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
            transition?.mode === "interruptedAndResubmitted") &&
          startedTurnId
        ) {
          activateTurn(startedTurnId);
          setStatus("running");
        }
        await refreshQueue(threadId);
        return true;
      } catch (queueError) {
        pendingSteerRequestsRef.current.delete(queuedMessage.clientUserMessageId);
        setPendingSteers((current) =>
          current.filter((item) => item.clientUserMessageId !== queuedMessage.clientUserMessageId),
        );
        await refreshQueue(threadId);
        setError(queueError instanceof Error ? queueError.message : "无法调整当前任务方向。");
        return false;
      }
    },
    [activateTurn, queueOperationId, queuedMessages, refreshQueue, threadId],
  );

  const clearQueuedMessages = useCallback(async (): Promise<void> => {
    if (!threadId || queueOperationId || queuedMessages.length === 0) {
      return;
    }
    const deletableMessages = queuedMessages.filter((item) => !item.pendingSteer);
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
          failActiveTurn("当前任务已失效，可能因 Agent 运行时重启而终止。请重新发送任务。");
        } else {
          setInterrupting(false);
          setError("无法停止当前任务。");
        }
      }
    } catch {
      setInterrupting(false);
      setError("无法停止当前任务。");
    }
  }, [activeTurnId, failActiveTurn, interrupting, threadId]);

  useEffect(() => {
    if (
      status === "running" &&
      startedAt &&
      runtimeHealth &&
      runtimeHealth.observedAt >= startedAt &&
      (!runtimeHealth.available ||
        (runtimeInstanceIdRef.current !== null && runtimeInstanceIdRef.current !== runtimeHealth.instanceId))
    ) {
      failActiveTurn("Agent 运行时已重启或退出，当前任务已经终止。请重新发送任务。");
    }
  }, [failActiveTurn, runtimeHealth, startedAt, status]);

  useEffect(() => {
    if (status !== "running" || !startedAt || !activeTurnId || !threadId) {
      return;
    }
    const maxDurationMs = runtimeHealth?.maxTurnDurationMs ?? 600_000;
    const remainingMs = maxDurationMs - (Date.now() - startedAt);
    const expire = () => {
      if (
        !shouldExpireActiveTurn(
          { turnId: activeTurnIdRef.current, startedAt: startedAtRef.current },
          activeTurnId,
          startedAt,
          Date.now(),
          maxDurationMs,
        )
      ) {
        return;
      }
      void fetch(
        `/api/agent/threads/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(activeTurnId)}/interrupt`,
        { method: "POST" },
      ).catch(() => undefined);
      failActiveTurn(`任务运行已超过 ${Math.round(maxDurationMs / 60_000)} 分钟，系统已自动终止。请重新拆分任务。`);
    };
    if (remainingMs <= 0) {
      expire();
      return;
    }
    const timeout = window.setTimeout(expire, remainingMs);
    return () => window.clearTimeout(timeout);
  }, [activeTurnId, failActiveTurn, runtimeHealth?.maxTurnDurationMs, startedAt, status, threadId]);

  useEffect(() => {
    return () => {
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
    compacting,
    queuedMessages,
    pendingSteers,
    queueSubmitting,
    queueOperationId,
    currentTurnId: activeTurnId ?? lastTurnId,
    durationMs,
    startedAt,
    error,
    submit,
    enqueueMessage,
    updateQueuedMessage,
    deleteQueuedMessage,
    steerQueuedMessage,
    clearQueuedMessages,
    interrupt,
    resetThread,
    loadThread,
  };
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
    const namespace = typeof item.namespace === "string" ? item.namespace : "";
    const tool = typeof item.tool === "string" ? item.tool : "工具";
    const sources = namespace === "commerce_web" ? readWebSourcesFromToolItem(item) : [];
    return {
      id: item.id as string,
      sequence,
      turnId,
      kind: namespace === "commerce_image" ? "image" : namespace === "commerce_web" ? "search" : "tool",
      label:
        namespace === "commerce_image"
          ? completed
            ? "图片生成完成"
            : "正在生成图片"
          : namespace === "commerce_web"
            ? completed
              ? "搜索完成"
              : "正在搜索网页"
            : completed
              ? "工具调用完成"
              : "正在调用工具",
      detail: namespace ? `${namespace}.${tool}` : tool,
      durationMs: typeof item.durationMs === "number" ? item.durationMs : null,
      ...(sources.length > 0 ? { sources } : {}),
      status,
    };
  }
  if (item.type === "mcpToolCall") {
    const server = typeof item.server === "string" ? item.server : "";
    const tool = typeof item.tool === "string" ? item.tool : "";
    const isWebSearch = server === "commerce_web" && tool === "search";
    const sources = isWebSearch ? readWebSourcesFromToolItem(item) : [];
    return {
      id: item.id as string,
      sequence,
      turnId,
      kind: isWebSearch ? "search" : "tool",
      label: isWebSearch
        ? completed
          ? "搜索完成"
          : "正在搜索网页"
        : completed
          ? "连接器调用完成"
          : "正在调用连接器",
      detail: isWebSearch ? "commerce_web.search" : tool,
      durationMs: typeof item.durationMs === "number" ? item.durationMs : null,
      ...(sources.length > 0 ? { sources } : {}),
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

function createThreadTitle(message: string): string {
  return message.length > 18 ? `${message.slice(0, 18)}…` : message;
}

function compactText(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 110 ? `${compact.slice(0, 110)}…` : compact;
}

function failedActivityLabel(kind: AgentActivity["kind"]): string {
  if (kind === "command") {
    return "命令未完成";
  }
  if (kind === "file") {
    return "文件操作未完成";
  }
  if (kind === "image") {
    return "图片生成未完成";
  }
  if (kind === "search") {
    return "搜索未完成";
  }
  if (kind === "compact") {
    return "上下文整理未完成";
  }
  return "工具调用未完成";
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
