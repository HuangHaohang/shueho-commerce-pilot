"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ConversationMessage = {
  id: string;
  sequence: number;
  turnId?: string | null;
  role: "user" | "assistant";
  content: string;
  phase?: "commentary" | "final_answer" | null;
  status: "streaming" | "completed";
};

export type AgentActivity = {
  id: string;
  sequence: number;
  turnId?: string | null;
  kind: "command" | "file" | "tool" | "search" | "image";
  label: string;
  detail?: string;
  durationMs?: number | null;
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
  const eventSourceRef = useRef<EventSource | null>(null);
  const sequenceRef = useRef(0);
  const activeTurnIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const runtimeInstanceIdRef = useRef<string | null>(null);

  const failActiveTurn = useCallback((message: string) => {
    const failedTurnId = activeTurnIdRef.current;
    activeTurnIdRef.current = null;
    runtimeInstanceIdRef.current = null;
    setActiveTurnId(null);
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

    if (method === "turn/started") {
      const turn = isRecord(params.turn) ? params.turn : {};
      if (typeof turn.id === "string") {
        activeTurnIdRef.current = turn.id;
        setActiveTurnId(turn.id);
        setLastTurnId(turn.id);
        setMessages((current) => bindLatestUserMessageToTurn(current, turn.id as string));
      }
      startedAtRef.current = Date.now();
      setStartedAt(startedAtRef.current);
      setDurationMs(null);
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
      if (item.type === "agentMessage") {
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
      if (typeof turn.id === "string") {
        setLastTurnId(turn.id);
      }
      activeTurnIdRef.current = null;
      runtimeInstanceIdRef.current = null;
      setActiveTurnId(null);
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
      }
      return;
    }

    if (method === "error") {
      const itemError = isRecord(params.error) ? params.error : {};
      setInterrupting(false);
      setError(typeof itemError.message === "string" ? itemError.message : "Agent 执行失败。");
      setStatus("failed");
    }
  }, []);

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

  const resetThread = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    sequenceRef.current = 0;
    activeTurnIdRef.current = null;
    startedAtRef.current = null;
    runtimeInstanceIdRef.current = null;
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
  }, []);

  const loadThread = useCallback(
    async (summary: AgentThreadSummary): Promise<boolean> => {
      setLoadingHistory(true);
      setError(null);
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
        activeTurnIdRef.current = restoredActiveTurnId;
        startedAtRef.current = restoredStartedAt;
        runtimeInstanceIdRef.current = payload.thread.status === "running" ? runtimeHealth?.instanceId ?? null : null;
        setThreadId(payload.thread.id);
        setThreadTitle(payload.thread.title || summary.title);
        setMessages(payload.messages);
        setActivities(payload.activities);
        setImages(payload.images);
        setStatus(payload.thread.status);
        setActiveTurnId(restoredActiveTurnId);
        setLastTurnId(payload.thread.lastTurnId);
        setDurationMs(payload.thread.durationMs);
        setStartedAt(restoredStartedAt);
        setInterrupting(false);
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
    [connectEventStream, resetThread, runtimeHealth?.instanceId],
  );

  const submit = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || status === "running" || status === "connecting") {
        return;
      }
      setStatus("connecting");
      setError(null);
      setInterrupting(false);
      setDurationMs(null);
      startedAtRef.current = Date.now();
      setStartedAt(startedAtRef.current);
      activeTurnIdRef.current = null;
      runtimeInstanceIdRef.current = runtimeHealth?.instanceId ?? null;
      setActiveTurnId(null);
      setLastTurnId(null);
      setMessages((current) => [
        ...current,
        {
          id: `user-${crypto.randomUUID()}`,
          sequence: nextSequence(sequenceRef),
          turnId: null,
          role: "user",
          content: message,
          status: "completed",
        },
      ]);
      setThreadTitle((current) => current ?? createThreadTitle(message));

      try {
        let currentThreadId = threadId;
        if (!currentThreadId) {
          const response = await fetch("/api/agent/threads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, title: createThreadTitle(message) }),
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
          body: JSON.stringify({ message, model, effort }),
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
              body: JSON.stringify({ model, title: createThreadTitle(message) }),
            });
            const createPayload = (await createResponse.json().catch(() => null)) as Record<string, unknown> | null;
            const replacementThreadId = readThreadId(createPayload);
            if (!createResponse.ok || !replacementThreadId) {
              throw new Error(readError(createPayload) || "无法创建替代会话。");
            }
            currentThreadId = replacementThreadId;
            setThreadId(replacementThreadId);
            setThreadTitle(createThreadTitle(message));
            setActivities([]);
            setImages([]);
            setMessages((current) => current.filter((item) => item.role === "user").slice(-1));
            await connectEventStream(replacementThreadId);
            const retryResponse = await fetch(`/api/agent/threads/${encodeURIComponent(replacementThreadId)}/turns`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message, model, effort }),
            });
            const retryPayload = (await retryResponse.json().catch(() => null)) as Record<string, unknown> | null;
            if (!retryResponse.ok) {
              throw new Error(readError(retryPayload) || "无法启动替代会话任务。");
            }
            const retryTurnId = readTurnId(retryPayload);
            if (retryTurnId) {
              activeTurnIdRef.current = retryTurnId;
              setActiveTurnId(retryTurnId);
              setLastTurnId(retryTurnId);
              setMessages((current) => bindLatestUserMessageToTurn(current, retryTurnId));
            }
            startedAtRef.current = Date.now();
            setStartedAt(startedAtRef.current);
            setStatus("running");
            return;
          }
          throw new Error(responseError);
        }
        const turnId = readTurnId(payload);
        if (turnId) {
          activeTurnIdRef.current = turnId;
          setActiveTurnId(turnId);
          setLastTurnId(turnId);
          setMessages((current) => bindLatestUserMessageToTurn(current, turnId));
        }
        startedAtRef.current = Date.now();
        setStartedAt(startedAtRef.current);
        setStatus("running");
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "Agent 请求失败。");
        setStatus("failed");
      }
    },
    [connectEventStream, effort, model, runtimeHealth?.instanceId, status, threadId],
  );

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
    currentTurnId: activeTurnId ?? lastTurnId,
    durationMs,
    startedAt,
    error,
    submit,
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
    const existing = current.find((message) => message.id === id);
    if (!existing) {
      return [...current, { id, sequence, turnId, role: "assistant", content, phase, status }];
    }
    return current.map((message) => (message.id === id ? { ...message, content, phase, status } : message));
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
      status,
    };
  }
  if (item.type === "mcpToolCall") {
    return { id: item.id as string, sequence, turnId, kind: "tool", label: completed ? "连接器调用完成" : "正在调用连接器", detail: String(item.tool ?? ""), durationMs: typeof item.durationMs === "number" ? item.durationMs : null, status };
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
  if (item.type === "webSearch") {
    return { id: item.id as string, sequence, turnId, kind: "search", label: completed ? "搜索完成" : "正在搜索", detail: String(item.query ?? ""), durationMs: typeof item.durationMs === "number" ? item.durationMs : null, status };
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
