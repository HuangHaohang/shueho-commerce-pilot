import { NextResponse } from "next/server";
import sharp from "sharp";

import { gatewayHeaders, requireAgentContext } from "@/lib/agent/http";
import { isAgentThreadOwner } from "@/lib/agent/thread-ownership";

export async function GET(
  request: Request,
  context: { params: Promise<{ filename: string }> },
) {
  const access = await requireAgentContext(request, "artifact.read");
  if (!access.ok) return access.response;

  const { filename } = await context.params;
  if (!/^[0-9]+-[0-9a-f-]+\.(png|jpg|webp)$/i.test(filename)) {
    return NextResponse.json({ error: "图片地址无效。" }, { status: 400 });
  }

  const gatewayUrl = process.env.COMMERCE_GATEWAY_URL ?? "http://127.0.0.1:8787";
  try {
    const metadataResponse = await fetch(
      new URL(`/api/generated-images/${encodeURIComponent(filename)}/metadata`, gatewayUrl),
      { headers: gatewayHeaders(undefined, access.context), cache: "no-store", signal: AbortSignal.timeout(10_000) },
    );
    const metadataPayload = (await metadataResponse.json().catch(() => null)) as Record<string, unknown> | null;
    const artifact = metadataPayload && isRecord(metadataPayload.artifact) ? metadataPayload.artifact : null;
    const threadId = artifact && typeof artifact.threadId === "string" ? artifact.threadId : "";
    if (!metadataResponse.ok || !threadId || !(await isAgentThreadOwner(threadId, access.context))) {
      return NextResponse.json({ error: "图片不存在。" }, { status: 404 });
    }
    const url = new URL(request.url);
    const preview = url.searchParams.get("preview") === "1" && url.searchParams.get("download") !== "1";
    // Revalidate ownership before every 304, including after logout/revocation/deletion.
    const etag = `"${filename}-${preview ? "preview-webp-640-v1" : "original"}"`;
    const cacheHeaders = { "Cache-Control": "private, no-cache, must-revalidate", ETag: etag, Vary: "Cookie" };
    if (request.headers.get("if-none-match") === etag && url.searchParams.get("download") !== "1") {
      return new NextResponse(null, { status: 304, headers: cacheHeaders });
    }
    const response = await fetch(
      new URL(`/api/generated-images/${encodeURIComponent(filename)}`, gatewayUrl),
      { headers: gatewayHeaders(undefined, access.context), cache: "no-store", signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) {
      return NextResponse.json({ error: "图片不存在。" }, { status: response.status });
    }
    if (preview) {
      const image = await sharp(Buffer.from(await response.arrayBuffer()), { limitInputPixels: 40_000_000 })
        .rotate().resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 }).toBuffer();
      return new NextResponse(new Uint8Array(image), {
        headers: { ...cacheHeaders, "Content-Type": "image/webp", "Content-Length": String(image.byteLength), "X-Content-Type-Options": "nosniff" },
      });
    }
    return new NextResponse(response.body, {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("content-type") || "image/png",
        ...cacheHeaders,
        ...(response.headers.get("content-length") ? { "Content-Length": response.headers.get("content-length")! } : {}),
        ...(new URL(request.url).searchParams.get("download") === "1"
          ? { "Content-Disposition": `attachment; filename="${filename}"` } : {}),
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
