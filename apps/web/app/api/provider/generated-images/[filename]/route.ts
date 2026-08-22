import { NextResponse } from "next/server";

import { gatewayHeaders } from "@/lib/agent/http";
import { isAgentThreadOwner } from "@/lib/agent/thread-ownership";
import { getAuthenticatedUserId } from "@/lib/auth/require-session";

export async function GET(
  request: Request,
  context: { params: Promise<{ filename: string }> },
) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const { filename } = await context.params;
  if (!/^[0-9]+-[0-9a-f-]+\.(png|jpg|webp)$/i.test(filename)) {
    return NextResponse.json({ error: "图片地址无效。" }, { status: 400 });
  }

  const gatewayUrl = process.env.COMMERCE_GATEWAY_URL ?? "http://127.0.0.1:8787";
  try {
    const metadataResponse = await fetch(
      new URL(`/api/generated-images/${encodeURIComponent(filename)}/metadata`, gatewayUrl),
      { headers: gatewayHeaders(), cache: "no-store", signal: AbortSignal.timeout(10_000) },
    );
    const metadataPayload = (await metadataResponse.json().catch(() => null)) as Record<string, unknown> | null;
    const artifact = metadataPayload && isRecord(metadataPayload.artifact) ? metadataPayload.artifact : null;
    const threadId = artifact && typeof artifact.threadId === "string" ? artifact.threadId : "";
    if (!metadataResponse.ok || !threadId || !(await isAgentThreadOwner(threadId, userId))) {
      return NextResponse.json({ error: "图片不存在。" }, { status: 404 });
    }
    const response = await fetch(
      new URL(`/api/generated-images/${encodeURIComponent(filename)}`, gatewayUrl),
      { headers: gatewayHeaders(), cache: "no-store", signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) {
      return NextResponse.json({ error: "图片不存在。" }, { status: response.status });
    }
    return new NextResponse(await response.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("content-type") || "image/png",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "图片服务暂时不可用。" }, { status: 503 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
