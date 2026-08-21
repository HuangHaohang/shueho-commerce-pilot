import { NextResponse } from "next/server";

import { hasAuthenticatedSession } from "@/lib/auth/require-session";
import { gatewayHeaders } from "@/lib/agent/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ filename: string }> },
) {
  if (!(await hasAuthenticatedSession(request))) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const { filename } = await context.params;
  if (!/^[0-9]+-[0-9a-f-]+\.(png|jpg|webp)$/i.test(filename)) {
    return NextResponse.json({ error: "图片地址无效。" }, { status: 400 });
  }

  const gatewayUrl = process.env.COMMERCE_GATEWAY_URL ?? "http://127.0.0.1:8787";
  try {
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
