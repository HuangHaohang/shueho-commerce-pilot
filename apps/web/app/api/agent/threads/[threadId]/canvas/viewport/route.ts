import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AGENT_ID_PATTERN, requireAgentThreadContext } from "@/lib/agent/http";
import {
  CreativeCanvasRepositoryError,
  saveCreativeCanvasViewport,
} from "@/lib/creative/creative-canvas-repository";
import { parseCreativeCanvasViewport } from "@/lib/creative/creative-canvas-validation";

export async function PATCH(
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
  const access = await requireAgentThreadContext(request, threadId, "agent.run");
  if (!access.ok) return access.response;
  try {
    const viewport = parseCreativeCanvasViewport(await request.json());
    const saved = await saveCreativeCanvasViewport(access.context, threadId, viewport);
    return NextResponse.json({ viewport: saved }, { headers: noStoreHeaders() });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "画布视口无效。", code: "CANVAS_VIEWPORT_INVALID" },
        { status: 400, headers: noStoreHeaders() },
      );
    }
    if (error instanceof CreativeCanvasRepositoryError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: noStoreHeaders() },
      );
    }
    return NextResponse.json(
      { error: "无法保存画布视口。", code: "CANVAS_VIEWPORT_SAVE_FAILED" },
      { status: 503, headers: noStoreHeaders() },
    );
  }
}

function noStoreHeaders(): HeadersInit {
  return { "Cache-Control": "no-store" };
}
