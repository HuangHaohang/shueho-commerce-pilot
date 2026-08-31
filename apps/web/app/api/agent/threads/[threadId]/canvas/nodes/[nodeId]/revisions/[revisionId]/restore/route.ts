import { NextResponse } from "next/server";

import { AGENT_ID_PATTERN, requireAgentThreadContext } from "@/lib/agent/http";
import {
  CreativeCanvasRepositoryError,
  restoreCreativeCanvasNodeRevision,
} from "@/lib/creative/creative-canvas-repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  routeContext: { params: Promise<{ threadId: string; nodeId: string; revisionId: string }> },
) {
  const { threadId, nodeId, revisionId } = await routeContext.params;
  if (!AGENT_ID_PATTERN.test(threadId) || !UUID_PATTERN.test(nodeId) || !UUID_PATTERN.test(revisionId)) {
    return NextResponse.json(
      { error: "画布版本标识无效。", code: "CANVAS_REVISION_ID_INVALID" },
      { status: 400, headers: noStoreHeaders() },
    );
  }
  const access = await requireAgentThreadContext(request, threadId, "agent.run");
  if (!access.ok) return access.response;
  try {
    const node = await restoreCreativeCanvasNodeRevision(
      access.context,
      threadId,
      nodeId,
      revisionId,
    );
    return NextResponse.json({ node }, { headers: noStoreHeaders() });
  } catch (error) {
    if (error instanceof CreativeCanvasRepositoryError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: noStoreHeaders() },
      );
    }
    return NextResponse.json(
      { error: "无法恢复画布版本。", code: "CANVAS_REVISION_RESTORE_FAILED" },
      { status: 503, headers: noStoreHeaders() },
    );
  }
}

function noStoreHeaders(): HeadersInit {
  return { "Cache-Control": "no-store" };
}
