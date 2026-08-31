import { NextResponse } from "next/server";

import { AGENT_ID_PATTERN, gatewayHeaders, gatewayUrl, requireAgentThreadContext } from "@/lib/agent/http";
import { getAgentThreadForUser } from "@/lib/agent/thread-ownership";
import type { ConversationMessage, GeneratedImageItem } from "@/lib/agent/use-agent-thread";
import { listCreativeCanvasSourceNodes } from "@/lib/creative/creative-canvas";
import {
  CreativeCanvasRepositoryError,
  reconcileCreativeCanvasState,
} from "@/lib/creative/creative-canvas-repository";

export async function GET(
  request: Request,
  routeContext: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await routeContext.params;
  if (!AGENT_ID_PATTERN.test(threadId)) {
    return NextResponse.json(
      { error: "会话标识无效。", code: "CANVAS_THREAD_INVALID" },
      { status: 400, headers: noStoreHeaders() },
    );
  }
  const access = await requireAgentThreadContext(request, threadId);
  if (!access.ok) return access.response;
  const record = await getAgentThreadForUser(threadId, access.context);
  if (!record) {
    return NextResponse.json(
      { error: "会话不存在。", code: "CANVAS_THREAD_NOT_FOUND" },
      { status: 404, headers: noStoreHeaders() },
    );
  }
  if (record.recipeId !== "creative_project" && record.recipeId !== "copywriting") {
    return NextResponse.json(
      { error: "该任务不属于创作空间。", code: "CANVAS_RECIPE_REQUIRED" },
      { status: 409, headers: noStoreHeaders() },
    );
  }

  try {
    const pages: Array<{ messages: ConversationMessage[]; images: GeneratedImageItem[] }> = [];
    let cursor: string | null = null;
    for (let pageIndex = 0; pageIndex < 5; pageIndex += 1) {
      const path = `/api/threads/${encodeURIComponent(threadId)}?limit=100${
        cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
      }`;
      const response = await fetch(gatewayUrl(path), {
        headers: gatewayHeaders(undefined, access.context),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok || !payload) {
        return NextResponse.json(
          { error: "无法读取画布来源。", code: "CANVAS_HARNESS_UNAVAILABLE" },
          { status: response.status, headers: noStoreHeaders() },
        );
      }
      pages.unshift(readCanvasHistory(payload, threadId));
      cursor = typeof payload.nextCursor === "string" && payload.nextCursor ? payload.nextCursor : null;
      if (!cursor) break;
    }
    const history = combineCanvasHistoryPages(pages);
    const sources = listCreativeCanvasSourceNodes(
      history.messages as ConversationMessage[],
      history.images as GeneratedImageItem[],
    );
    const state = await reconcileCreativeCanvasState(access.context, threadId, sources);
    return NextResponse.json(state, { headers: noStoreHeaders() });
  } catch (error) {
    if (error instanceof CreativeCanvasRepositoryError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: noStoreHeaders() },
      );
    }
    return NextResponse.json(
      { error: "创作画布暂时不可用。", code: "CANVAS_UNAVAILABLE" },
      { status: 503, headers: noStoreHeaders() },
    );
  }
}

function combineCanvasHistoryPages(
  pages: Array<{ messages: ConversationMessage[]; images: GeneratedImageItem[] }>,
): { messages: ConversationMessage[]; images: GeneratedImageItem[] } {
  const messages: ConversationMessage[] = [];
  const images: GeneratedImageItem[] = [];
  let sequence = 0;
  for (const page of pages) {
    const entries = [
      ...page.messages.map((message) => ({ kind: "message" as const, sequence: message.sequence, value: message })),
      ...page.images.map((image) => ({ kind: "image" as const, sequence: image.sequence, value: image })),
    ].sort((left, right) => left.sequence - right.sequence);
    for (const entry of entries) {
      sequence += 1;
      if (entry.kind === "message") messages.push({ ...entry.value, sequence });
      else images.push({ ...entry.value, sequence });
    }
  }
  return { messages, images };
}

function readCanvasHistory(
  payload: Record<string, unknown>,
  threadId: string,
): { messages: ConversationMessage[]; images: GeneratedImageItem[] } {
  const result = isRecord(payload.result) ? payload.result : null;
  const thread = result && isRecord(result.thread) ? result.thread : null;
  const turns = thread && Array.isArray(thread.turns) ? thread.turns.filter(isRecord) : [];
  const generatedImages = Array.isArray(payload.generatedImages)
    ? payload.generatedImages.filter(isRecord).sort((left, right) =>
        String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")))
    : [];
  const messages: ConversationMessage[] = [];
  const images: GeneratedImageItem[] = [];
  let sequence = 0;
  for (const turn of turns) {
    const turnId = typeof turn.id === "string" ? turn.id : null;
    const items = Array.isArray(turn.items) ? turn.items.filter(isRecord) : [];
    const seenAgentMessages = new Set<string>();
    for (const item of items) {
      if (item.type !== "agentMessage" || typeof item.text !== "string" || !item.text.trim()) continue;
      const phase = item.phase === "commentary" || item.phase === "final_answer" ? item.phase : null;
      const fingerprint = `${phase ?? ""}\u0000${item.text}`;
      if (seenAgentMessages.has(fingerprint)) continue;
      seenAgentMessages.add(fingerprint);
      messages.push({
        id: typeof item.id === "string" ? item.id : `canvas-message-${++sequence}`,
        sequence: ++sequence,
        turnId,
        role: "assistant",
        content: item.text,
        phase,
        status: "completed",
      });
    }
    for (const artifact of generatedImages) {
      const filename = typeof artifact.filename === "string" ? artifact.filename : "";
      if (
        artifact.threadId !== threadId || artifact.turnId !== turnId ||
        !/^[0-9]+-[0-9a-f-]+\.(png|jpg|webp)$/i.test(filename)
      ) continue;
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
  return { messages, images };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function noStoreHeaders(): HeadersInit {
  return { "Cache-Control": "no-store" };
}
