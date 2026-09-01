import { NextResponse } from "next/server";

import { AGENT_ID_PATTERN, gatewayHeaders, gatewayUrl, requireAgentThreadContext } from "@/lib/agent/http";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";

const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const supportedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  if (!AGENT_ID_PATTERN.test(threadId)) {
    return NextResponse.json({ error: "会话标识无效。" }, { status: 400 });
  }
  const access = await requireAgentThreadContext(request, threadId, "agent.run");
  if (!access.ok) return access.response;
  const rateLimited = await enforceEnterpriseRateLimit(access.context, "canvas.asset.upload", 30, 60);
  if (rateLimited) return rateLimited;
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File) || !file.size || file.size > MAX_ASSET_BYTES) {
    return NextResponse.json({ error: "请选择一个不超过 5 MB 的图片素材。" }, { status: 400 });
  }
  if (!supportedImageTypes.has(file.type)) {
    return NextResponse.json({ error: "设计素材仅支持 PNG、JPEG 和 WebP。" }, { status: 415 });
  }
  const clientRequestId = crypto.randomUUID();
  try {
    const response = await fetch(gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}/attachments`), {
      method: "POST",
      headers: gatewayHeaders({
        "Content-Type": file.type,
        "X-Commerce-Filename": encodeURIComponent(file.name),
        "X-Commerce-Client-Request-Id": clientRequestId,
        "X-Commerce-Artifact-Purpose": "canvas_asset",
      }, access.context),
      body: await file.arrayBuffer(),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const artifact = payload && isRecord(payload.artifact) ? payload.artifact : null;
    if (!response.ok || !artifact || artifact.kind !== "image" || artifact.purpose !== "canvas_asset") {
      return NextResponse.json(
        { error: payload && typeof payload.error === "string" ? payload.error : "素材服务返回了无效响应。" },
        { status: response.ok ? 502 : response.status },
      );
    }
    const id = typeof artifact.id === "string" ? artifact.id : "";
    const name = typeof artifact.originalName === "string" ? artifact.originalName : "";
    const mimeType = typeof artifact.mimeType === "string" ? artifact.mimeType : "";
    const size = typeof artifact.size === "number" ? artifact.size : -1;
    if (!/^[0-9a-f-]{36}$/i.test(id) || !name || !supportedImageTypes.has(mimeType) || size < 0) {
      return NextResponse.json({ error: "素材服务返回了无效元数据。" }, { status: 502 });
    }
    return NextResponse.json({
      asset: {
        id,
        name,
        mimeType,
        size,
        url: `/api/agent/threads/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(id)}`,
      },
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "无法上传设计素材。" }, { status: 503 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
