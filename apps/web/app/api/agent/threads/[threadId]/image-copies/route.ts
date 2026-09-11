import { NextResponse } from "next/server";
import { requireAgentThreadContext, gatewayHeaders, gatewayUrl } from "@/lib/agent/http";
import { resolveImageSources } from "@/lib/creative/image-session-repository";
export async function POST(request: Request, route: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await route.params;
  const access = await requireAgentThreadContext(request, threadId, "agent.run");
  if (!access.ok) return access.response;
  const body = await request.json().catch(() => null);
  if (typeof body?.filename !== "string" || typeof body?.requestId !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(body.requestId)) return NextResponse.json({ error: "请选择图片版本。" }, { status: 400 });
  try {
    const [source] = await resolveImageSources(access.context, threadId, [body.filename]);
    const response = await fetch(gatewayUrl(`/api/generated-images/${encodeURIComponent(body.filename)}/copy`), {
      method: "POST", headers: gatewayHeaders({ "Content-Type": "application/json" }, access.context),
      body: JSON.stringify({ sourceThreadId: source.threadId, requestId: body.requestId }), signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json();
    if (!response.ok || !payload.artifact) throw new Error("无法另存图片。");
    const a = payload.artifact;
    return NextResponse.json({ image: { id: a.filename, filename: a.filename, url: `/api/provider/generated-images/${encodeURIComponent(a.filename)}`, sourceFilenames: [], model: a.model, turnId: a.turnId, sequence: Date.now() } });
  } catch { return NextResponse.json({ error: "未能确认图片另存结果，请刷新版本列表后再操作。" }, { status: 503 }); }
}
