import { NextResponse } from "next/server";
import { AGENT_ID_PATTERN, gatewayHeaders, gatewayUrl, requireAgentThreadContext } from "@/lib/agent/http";

export async function GET(request: Request, route: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await route.params;
  if (!AGENT_ID_PATTERN.test(threadId)) return NextResponse.json({ error: "会话标识无效。" }, { status: 400 });
  const access = await requireAgentThreadContext(request, threadId);
  if (!access.ok) return access.response;
  try {
    const response = await fetch(gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}/images`), {
      headers: gatewayHeaders(undefined, access.context), cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.generatedImages)) throw new Error("Unavailable");
    const images = payload.generatedImages.filter((item: Record<string, unknown>) => item.threadId === threadId && typeof item.filename === "string" && /^[0-9]+-[0-9a-f-]+\.(png|jpg|webp)$/i.test(item.filename)).map((item: Record<string, unknown>, sequence: number) => ({
      id: item.filename, filename: item.filename, sequence, turnId: item.turnId,
      url: `/api/provider/generated-images/${encodeURIComponent(String(item.filename))}`,
      model: item.model, sourceFilenames: item.sourceFilenames ?? [],
    }));
    return NextResponse.json({ images }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "图片暂时不可用。" }, { status: 503 }); }
}
