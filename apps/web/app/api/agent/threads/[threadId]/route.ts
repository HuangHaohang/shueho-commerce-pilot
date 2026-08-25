import { NextResponse } from "next/server";

import { readExplicitSkillMessage, readVisibleAttachmentMessage } from "@/lib/agent/skill-invocation";

import { AGENT_ID_PATTERN, gatewayHeaders, gatewayUrl, requireAgentThreadContext } from "@/lib/agent/http";
import {
  deleteAgentThreadRecord,
  getAgentThreadForUser,
  updateAgentThreadStatus,
} from "@/lib/agent/thread-ownership";
import {
  listAgentUserInputAnswers,
  type AgentUserInputAnswer,
} from "@/lib/agent/user-input-answers";
import { readWebSourcesFromToolItem } from "@/lib/agent/web-sources";
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
    const userInputAnswers = await listAgentUserInputAnswers(enterpriseContext, threadId);
    const normalized = normalizeThreadHistory(payload, record, userInputAnswers);
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

function normalizeThreadHistory(
  payload: Record<string, unknown>,
  record: Awaited<ReturnType<typeof getAgentThreadForUser>>,
  userInputAnswers: AgentUserInputAnswer[],
) {
  const result = isRecord(payload.result) ? payload.result : null;
  const thread = result && isRecord(result.thread) ? result.thread : null;
  const turns = thread && Array.isArray(thread.turns) ? thread.turns.filter(isRecord) : [];
  const generatedImages = Array.isArray(payload.generatedImages)
    ? payload.generatedImages
        .filter(isRecord)
        .sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")))
    : [];
  const threadAttachments = Array.isArray(payload.attachments)
    ? payload.attachments.map((value) => readThreadAttachment(record?.threadId ?? "", value)).filter(
        (attachment): attachment is NonNullable<ReturnType<typeof readThreadAttachment>> => Boolean(attachment),
      )
    : [];
  const messages: Array<Record<string, unknown>> = [];
  const activities: Array<Record<string, unknown>> = [];
  const images: Array<Record<string, unknown>> = [];
  let sequence = 0;

  for (const turn of turns) {
    const turnId = typeof turn.id === "string" ? turn.id : null;
    const turnAttachments = threadAttachments.filter((attachment) => attachment.turnId === turnId);
    const turnRunning = turn.status === "inProgress" || turn.status === "running";
    const items = Array.isArray(turn.items) ? turn.items.filter(isRecord) : [];
    const turnAnswers = userInputAnswers.filter((answer) => answer.turnId === turnId);
    const persistedUserTexts = new Set(
      items
        .filter((item) => item.type === "userMessage" && Array.isArray(item.content))
        .flatMap((item) => (item.content as unknown[]).filter(isRecord))
        .filter((entry) => entry.type === "text" && typeof entry.text === "string")
        .map((entry) => (entry.text as string).trim()),
    );
    let answersInserted = false;
    const appendAnswers = () => {
      if (answersInserted) return;
      answersInserted = true;
      for (const answer of turnAnswers) {
        if (persistedUserTexts.has(answer.answerMessage.trim())) continue;
        messages.push({
          id: `user-input-answer-${answer.requestId}`,
          sequence: ++sequence,
          turnId,
          role: "user",
          content: answer.answerMessage,
          delivery: "committed",
          variant: "default",
          status: "completed",
        });
      }
    };
    let userMessageIndex = 0;
    for (const item of items) {
      const id = typeof item.id === "string" ? item.id : `history-${++sequence}`;
      if (item.type === "userMessage") {
        const content = Array.isArray(item.content) ? item.content.filter(isRecord) : [];
        const rawText = content
          .filter((entry) => entry.type === "text" && typeof entry.text === "string")
          .map((entry) => entry.text as string)
          .join("\n")
          .trim();
        const explicitSkillMessage = readExplicitSkillMessage(rawText);
        const text = readVisibleAttachmentMessage(explicitSkillMessage.content);
        if (text || turnAttachments.length) {
          const clientId = typeof item.clientId === "string" ? item.clientId : null;
          const variant = userMessageIndex++ === 0 ? "default" : "steer";
          messages.push({
            id,
            sequence: ++sequence,
            turnId,
            role: "user",
            content: text,
            skillName: explicitSkillMessage.skillName,
            attachments: variant === "default" ? turnAttachments.map(({ turnId: _turnId, ...attachment }) => attachment) : [],
            clientId,
            delivery: "committed",
            variant,
            status: "completed",
          });
        }
      } else if (item.type === "agentMessage" && typeof item.text === "string" && item.text) {
        if (item.phase !== "commentary") appendAnswers();
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
    appendAnswers();
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
      recipeId: record?.recipeId ?? null,
      category: record?.category ?? "general",
    },
    messages,
    activities,
    images,
  };
}

function readThreadAttachment(threadId: string, value: unknown) {
  if (!threadId || !isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  const name = typeof value.originalName === "string" ? value.originalName : "";
  const mimeType = typeof value.mimeType === "string" ? value.mimeType : "";
  const size = typeof value.size === "number" ? value.size : -1;
  const kind = value.kind === "image" || value.kind === "document" ? value.kind : null;
  const turnId = typeof value.turnId === "string" ? value.turnId : null;
  if (!id || !name || !mimeType || size < 0 || !kind || !turnId) return null;
  return {
    id,
    name,
    mimeType,
    size,
    kind,
    turnId,
    url: `/api/agent/threads/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(id)}`,
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
    const sources = namespace === "commerce_web" ? readWebSourcesFromToolItem(item) : [];
    return {
      id,
      sequence,
      turnId,
      kind: namespace === "commerce_image" ? "image" : namespace === "commerce_web" ? "search" : "tool",
      label: namespace === "commerce_web" ? "完成了搜索" : "调用了工具",
      detail: namespace ? `${namespace}.${tool}` : tool,
      durationMs,
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
      id,
      sequence,
      turnId,
      kind: isWebSearch ? "search" : "tool",
      label: isWebSearch ? "完成了搜索" : "调用了连接器",
      detail: isWebSearch ? "commerce_web.search" : tool,
      durationMs,
      ...(sources.length > 0 ? { sources } : {}),
      status,
    };
  }
  if (item.type === "webSearch") {
    const sources = readWebSourcesFromToolItem(item);
    return {
      id,
      sequence,
      turnId,
      kind: "search",
      label: "完成了搜索",
      durationMs,
      ...(sources.length > 0 ? { sources } : {}),
      status,
    };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
