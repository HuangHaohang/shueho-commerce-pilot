import { NextResponse } from "next/server";

import { AGENT_ID_PATTERN, gatewayHeaders, gatewayUrl, requireAgentThreadContext } from "@/lib/agent/http";
import {
  deleteAgentThreadRecord,
  getAgentThreadForUser,
  updateAgentThreadTitle,
  updateAgentThreadStatus,
} from "@/lib/agent/thread-ownership";
import { releaseAgentTurnLeaseForTurn } from "@/lib/enterprise/quota";

export async function GET(request: Request, routeContext: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await routeContext.params;
  if (!AGENT_ID_PATTERN.test(threadId)) {
    return NextResponse.json({ error: "会话标识无效。" }, { status: 400 });
  }
  const access = await requireAgentThreadContext(request, threadId);
  if (!access.ok) return access.response;
  const enterpriseContext = access.context;
  const record = await getAgentThreadForUser(threadId, enterpriseContext);
  if (!record) {
    return NextResponse.json({ error: "会话不存在。" }, { status: 404 });
  }

  try {
    const response = await fetch(gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}`), {
      headers: gatewayHeaders(undefined, enterpriseContext),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !payload) {
      const upstreamMessage = payload && typeof payload.error === "string" ? payload.error : "";
      const status = /thread not found/i.test(upstreamMessage) ? 404 : response.status;
      if (status === 404) {
        await deleteAgentThreadRecord(threadId, enterpriseContext);
      }
      return NextResponse.json(
        { error: status === 404 ? "该对话记录已不可恢复。" : "无法读取对话记录。" },
        { status },
      );
    }
    const preview = readThreadPreview(payload);
    if (record.title === "新任务" && preview) {
      record.title = normalizeTitle(preview);
      await updateAgentThreadTitle(threadId, enterpriseContext, record.title);
    }
    const normalized = normalizeThreadHistory(payload, record);
    await updateAgentThreadStatus(
      threadId,
      enterpriseContext,
      normalized.thread.status,
      normalized.thread.durationMs,
    );
    if (normalized.thread.status !== "running" && normalized.thread.lastTurnId) {
      await releaseAgentTurnLeaseForTurn(
        enterpriseContext,
        threadId,
        normalized.thread.lastTurnId,
      );
    }
    return NextResponse.json(normalized, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Agent Gateway 暂时不可用。" }, { status: 503 });
  }
}

function normalizeThreadHistory(payload: Record<string, unknown>, record: Awaited<ReturnType<typeof getAgentThreadForUser>>) {
  const result = isRecord(payload.result) ? payload.result : null;
  const thread = result && isRecord(result.thread) ? result.thread : null;
  const turns = thread && Array.isArray(thread.turns) ? thread.turns.filter(isRecord) : [];
  const generatedImages = Array.isArray(payload.generatedImages)
    ? payload.generatedImages
        .filter(isRecord)
        .sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")))
    : [];
  const messages: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];
  const images: Array<Record<string, unknown>> = [];
  let sequence = 0;

  for (const turn of turns) {
    const turnId = typeof turn.id === "string" ? turn.id : null;
    const turnRunning = turn.status === "inProgress" || turn.status === "running";
    const items = Array.isArray(turn.items) ? turn.items.filter(isRecord) : [];
    let userMessageIndex = 0;
    for (const item of items) {
      const id = typeof item.id === "string" ? item.id : `history-${++sequence}`;
      if (item.type === "userMessage") {
        const content = Array.isArray(item.content) ? item.content.filter(isRecord) : [];
        const text = content
          .filter((entry) => entry.type === "text" && typeof entry.text === "string")
          .map((entry) => entry.text as string)
          .join("\n")
          .trim();
        if (text) {
          const clientId = typeof item.clientId === "string" ? item.clientId : null;
          messages.push({
            id,
            sequence: ++sequence,
            turnId,
            role: "user",
            content: text,
            clientId,
            delivery: "committed",
            variant: userMessageIndex++ === 0 ? "default" : "steer",
            status: "completed",
          });
        }
      } else if (item.type === "agentMessage" && typeof item.text === "string" && item.text) {
        messages.push({
          id,
          sequence: ++sequence,
          turnId,
          role: "assistant",
          content: item.text,
          phase: item.phase === "commentary" || item.phase === "final_answer" ? item.phase : null,
          status: "completed",
        });
      } else {
        const activity = normalizeActivity(item, id, turnId, ++sequence, turnRunning);
        if (activity) {
          activities.push(activity);
        }
      }
    }
    for (const artifact of generatedImages) {
      const filename = typeof artifact.filename === "string" ? artifact.filename : "";
      if (
        artifact.threadId !== record?.threadId ||
        artifact.turnId !== turnId ||
        !/^[0-9]+-[0-9a-f-]+\.(png|jpg|webp)$/i.test(filename)
      ) {
        continue;
      }
      images.push({
        id: filename,
        sequence: ++sequence,
        turnId,
        url: `/api/provider/generated-images/${encodeURIComponent(filename)}`,
        model: typeof artifact.model === "string" ? artifact.model : "gpt-image-2",
        filename,
      });
    }
  }

  const lastTurn = turns.at(-1) ?? null;
  return {
    thread: {
      id: record?.threadId,
      title: record?.title || (thread && typeof thread.preview === "string" ? thread.preview : "新任务"),
      createdAt: record?.createdAt,
      updatedAt: record?.updatedAt,
      lastTurnId: lastTurn && typeof lastTurn.id === "string" ? lastTurn.id : null,
      status: normalizeStatus(lastTurn && typeof lastTurn.status === "string" ? lastTurn.status : "completed"),
      durationMs: lastTurn && typeof lastTurn.durationMs === "number" ? lastTurn.durationMs : null,
      startedAt:
        lastTurn && typeof lastTurn.startedAt === "number"
          ? new Date(lastTurn.startedAt * 1000).toISOString()
          : null,
    },
    messages,
    activities,
    images,
  };
}

function normalizeActivity(
  item: Record<string, unknown>,
  id: string,
  turnId: string | null,
  sequence: number,
  turnRunning: boolean,
) {
  const status =
    item.status === "failed"
      ? "failed"
      : item.status === "inProgress" || (item.type === "contextCompaction" && turnRunning)
        ? "running"
        : "completed";
  const durationMs = typeof item.durationMs === "number" ? item.durationMs : null;
  if (item.type === "commandExecution") {
    return { id, sequence, turnId, kind: "command", label: status === "failed" ? "命令未完成" : "运行了命令", durationMs, status };
  }
  if (item.type === "fileChange") {
    return { id, sequence, turnId, kind: "file", label: status === "failed" ? "文件操作未完成" : "编辑了文件", durationMs, status };
  }
  if (item.type === "dynamicToolCall") {
    const namespace = typeof item.namespace === "string" ? item.namespace : "";
    const tool = typeof item.tool === "string" ? item.tool : "工具";
    return { id, sequence, turnId, kind: namespace === "commerce_image" ? "image" : namespace === "commerce_web" ? "search" : "tool", label: namespace === "commerce_web" ? "完成了搜索" : "调用了工具", detail: namespace ? `${namespace}.${tool}` : tool, durationMs, status };
  }
  if (item.type === "mcpToolCall") {
    const server = typeof item.server === "string" ? item.server : "";
    const tool = typeof item.tool === "string" ? item.tool : "";
    const isWebSearch = server === "commerce_web" && tool === "search";
    return {
      id,
      sequence,
      turnId,
      kind: isWebSearch ? "search" : "tool",
      label: isWebSearch ? "完成了搜索" : "调用了连接器",
      detail: isWebSearch ? "commerce_web.search" : tool,
      durationMs,
      status,
    };
  }
  if (item.type === "webSearch") {
    return { id, sequence, turnId, kind: "search", label: "完成了搜索", durationMs, status };
  }
  if (item.type === "contextCompaction") {
    return { id, sequence, turnId, kind: "compact", label: "已整理上下文", durationMs, status };
  }
  return null;
}

function normalizeStatus(value: string): "running" | "completed" | "interrupted" | "failed" {
  return value === "inProgress" || value === "running"
    ? "running"
    : value === "failed"
      ? "failed"
      : value === "interrupted"
        ? "interrupted"
        : "completed";
}

function readThreadPreview(payload: Record<string, unknown>): string | null {
  const result = isRecord(payload.result) ? payload.result : null;
  const thread = result && isRecord(result.thread) ? result.thread : null;
  return thread && typeof thread.preview === "string" && thread.preview.trim() ? thread.preview.trim() : null;
}

function normalizeTitle(value: string): string {
  const title = value.replace(/\s+/g, " ").trim();
  return title.length > 40 ? `${title.slice(0, 40)}…` : title;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
