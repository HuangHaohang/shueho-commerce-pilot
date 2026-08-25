import { NextResponse } from "next/server";

import { AGENT_ID_PATTERN, gatewayHeaders, gatewayUrl, requireAgentThreadContext } from "@/lib/agent/http";

const ATTACHMENT_ID_PATTERN = /^[0-9a-f-]{36}$/i;

export async function GET(
  request: Request,
  context: { params: Promise<{ threadId: string; attachmentId: string }> },
) {
  const { threadId, attachmentId } = await context.params;
  if (!AGENT_ID_PATTERN.test(threadId) || !ATTACHMENT_ID_PATTERN.test(attachmentId)) {
    return NextResponse.json({ error: "附件地址无效。" }, { status: 400 });
  }
  const access = await requireAgentThreadContext(request, threadId, "artifact.read");
  if (!access.ok) return access.response;
  try {
    const response = await fetch(
      gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(attachmentId)}/content`),
      {
        headers: gatewayHeaders(undefined, access.context),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) {
      return NextResponse.json({ error: "附件不存在。" }, { status: response.status });
    }
    return new NextResponse(await response.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/octet-stream",
        "Content-Disposition": response.headers.get("content-disposition") || "attachment",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "附件服务暂时不可用。" }, { status: 503 });
  }
}
