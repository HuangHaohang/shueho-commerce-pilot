import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import {
  isAgentMessageFeedbackRating,
  type AgentMessageFeedbackRating,
} from "@/lib/agent/message-feedback-contract";
import { setAgentMessageFeedback } from "@/lib/agent/message-feedback";
import { readRateableAgentMessageTarget } from "@/lib/agent/message-feedback-target";
import {
  AGENT_ID_PATTERN,
  gatewayHeaders,
  gatewayUrl,
  requireAgentThreadContext,
} from "@/lib/agent/http";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";

const MESSAGE_ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export async function PUT(
  request: Request,
  routeContext: { params: Promise<{ threadId: string; messageId: string }> },
) {
  const { threadId, messageId } = await routeContext.params;
  if (!AGENT_ID_PATTERN.test(threadId) || !MESSAGE_ITEM_ID_PATTERN.test(messageId)) {
    return NextResponse.json({ error: "回复标识无效。" }, { status: 400 });
  }
  const access = await requireAgentThreadContext(request, threadId, "thread.read.own");
  if (!access.ok) return access.response;

  const body = (await request.json().catch(() => null)) as { rating?: unknown } | null;
  const rating = readRating(body?.rating);
  if (rating === undefined) {
    return NextResponse.json({ error: "反馈值无效。" }, { status: 400 });
  }
  const rateLimited = await enforceEnterpriseRateLimit(
    access.context,
    "agent.message.feedback",
    120,
    60,
  );
  if (rateLimited) return rateLimited;

  try {
    const response = await fetch(gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}`), {
      headers: gatewayHeaders(undefined, access.context),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok || !payload) {
      return NextResponse.json({ error: "暂时无法核验这条回复。" }, { status: 503 });
    }
    const target = readRateableAgentMessageTarget(payload, messageId);
    if (!target) {
      return NextResponse.json({ error: "该回复不存在或尚未完成。" }, { status: 404 });
    }
    const savedRating = await setAgentMessageFeedback(access.context, {
      threadId,
      turnId: target.turnId,
      messageItemId: messageId,
      rating,
      messageContentHash: createHash("sha256").update(target.text, "utf8").digest("hex"),
    });
    return NextResponse.json(
      { rating: savedRating },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "反馈暂时无法保存，请稍后重试。" }, { status: 503 });
  }
}

function readRating(value: unknown): AgentMessageFeedbackRating | null | undefined {
  if (value === null) return null;
  return isAgentMessageFeedbackRating(value) ? value : undefined;
}
