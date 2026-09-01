import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  AGENT_ID_PATTERN,
  gatewayHeaders,
  gatewayUrl,
  requireAgentThreadContext,
} from "@/lib/agent/http";
import {
  CreativeCanvasRepositoryError,
  readCreativeCanvasState,
  saveCreativeCanvasNodeLayout,
  saveCreativeCanvasNodeRevision,
} from "@/lib/creative/creative-canvas-repository";
import { creativeCanvasNodePatchSchema, parseCreativeCanvasContentUpdate } from "@/lib/creative/creative-canvas-validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  routeContext: { params: Promise<{ threadId: string; nodeId: string }> },
) {
  const { threadId, nodeId } = await routeContext.params;
  if (!AGENT_ID_PATTERN.test(threadId) || !UUID_PATTERN.test(nodeId)) {
    return NextResponse.json(
      { error: "画布节点标识无效。", code: "CANVAS_NODE_ID_INVALID" },
      { status: 400, headers: noStoreHeaders() },
    );
  }
  const access = await requireAgentThreadContext(request, threadId, "agent.run");
  if (!access.ok) return access.response;

  try {
    const length = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(length) && length > 280_000) {
      return NextResponse.json(
        { error: "画布修改内容过大。", code: "CANVAS_NODE_PATCH_TOO_LARGE" },
        { status: 413, headers: noStoreHeaders() },
      );
    }
    const patch = creativeCanvasNodePatchSchema.parse(await request.json());
    const state = await readCreativeCanvasState(access.context, threadId);
    let node = state.nodes.find((entry) => entry.id === nodeId);
    if (!node) {
      return NextResponse.json(
        { error: "画布节点不存在。", code: "CANVAS_NODE_NOT_FOUND" },
        { status: 404, headers: noStoreHeaders() },
      );
    }
    if (patch.layout) {
      const layout = await saveCreativeCanvasNodeLayout(access.context, threadId, nodeId, patch.layout);
      node = { ...node, layout };
    }
    if (patch.content !== undefined) {
      const content = parseCreativeCanvasContentUpdate(node.revision.content, patch.content);
      await assertOwnedCanvasAssets(content, threadId, access.context);
      node = await saveCreativeCanvasNodeRevision(access.context, threadId, nodeId, content);
    }
    return NextResponse.json({ node }, { headers: noStoreHeaders() });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "画布修改内容无效。", code: "CANVAS_NODE_PATCH_INVALID" },
        { status: 400, headers: noStoreHeaders() },
      );
    }
    if (error instanceof CanvasAssetError) {
      return NextResponse.json(
        { error: "设计素材不存在或不属于当前项目。", code: "CANVAS_ASSET_NOT_OWNED" },
        { status: 404, headers: noStoreHeaders() },
      );
    }
    if (error instanceof CreativeCanvasRepositoryError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: noStoreHeaders() },
      );
    }
    return NextResponse.json(
      { error: "无法保存画布节点。", code: "CANVAS_NODE_SAVE_FAILED" },
      { status: 503, headers: noStoreHeaders() },
    );
  }
}

async function assertOwnedCanvasAssets(
  content: ReturnType<typeof parseCreativeCanvasContentUpdate>,
  threadId: string,
  context: Parameters<typeof gatewayHeaders>[1],
) {
  if (content.kind !== "image") return;
  const assetIds = [...new Set(
    (content.editorLayers ?? [])
      .filter((layer) => layer.kind === "image" && layer.source === "canvas_asset")
      .map((layer) => layer.kind === "image" ? layer.assetId : undefined)
      .filter((id): id is string => Boolean(id)),
  )];
  await Promise.all(assetIds.map(async (assetId) => {
    const response = await fetch(
      gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(assetId)}`),
      {
        headers: gatewayHeaders({}, context),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const artifact = payload && isRecord(payload.artifact) ? payload.artifact : null;
    if (
      !response.ok || !artifact || artifact.id !== assetId || artifact.threadId !== threadId ||
      artifact.kind !== "image" || artifact.purpose !== "canvas_asset"
    ) {
      throw new CanvasAssetError();
    }
  }));
}

class CanvasAssetError extends Error {}

function noStoreHeaders(): HeadersInit {
  return { "Cache-Control": "no-store" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
