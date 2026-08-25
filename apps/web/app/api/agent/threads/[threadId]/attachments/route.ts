import { NextResponse } from "next/server";

import { AGENT_ID_PATTERN, gatewayHeaders, gatewayUrl, requireAgentThreadContext } from "@/lib/agent/http";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";

const MAX_FILES = 8;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const CLIENT_REQUEST_ID_PATTERN = /^[0-9a-f-]{36}$/i;

type UploadedAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "document";
  url: string;
};

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await context.params;
  if (!AGENT_ID_PATTERN.test(threadId)) {
    return NextResponse.json({ error: "会话标识无效。" }, { status: 400 });
  }
  const access = await requireAgentThreadContext(request, threadId, "agent.run");
  if (!access.ok) return access.response;
  const rateLimited = await enforceEnterpriseRateLimit(access.context, "attachment.upload", 30, 60);
  if (rateLimited) return rateLimited;

  const formData = await request.formData().catch(() => null);
  const clientRequestId = formData?.get("clientRequestId");
  const files = formData?.getAll("files").filter((value): value is File => value instanceof File) ?? [];
  if (typeof clientRequestId !== "string" || !CLIENT_REQUEST_ID_PATTERN.test(clientRequestId)) {
    return NextResponse.json({ error: "附件请求标识无效。" }, { status: 400 });
  }
  if (!files.length || files.length > MAX_FILES) {
    return NextResponse.json({ error: `每次请选择 1 至 ${MAX_FILES} 个附件。` }, { status: 400 });
  }
  if (files.some((file) => !file.size || file.size > MAX_FILE_BYTES)) {
    return NextResponse.json({ error: "单个附件必须小于 5 MB。" }, { status: 413 });
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES) {
    return NextResponse.json({ error: "一次提交的附件总大小不能超过 5 MB。" }, { status: 413 });
  }

  const uploaded: UploadedAttachment[] = [];
  try {
    for (const file of files) {
      const response = await fetch(gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}/attachments`), {
        method: "POST",
        headers: gatewayHeaders(
          {
            "Content-Type": file.type || "application/octet-stream",
            "X-Commerce-Filename": encodeURIComponent(file.name),
            "X-Commerce-Client-Request-Id": clientRequestId,
          },
          access.context,
        ),
        body: await file.arrayBuffer(),
        cache: "no-store",
        signal: AbortSignal.timeout(45_000),
      });
      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      const artifact = payload && isRecord(payload.artifact) ? payload.artifact : null;
      if (!response.ok || !artifact) {
        throw new UploadError(
          payload && typeof payload.error === "string" ? payload.error : "附件服务返回了无效响应。",
          response.status,
        );
      }
      const attachment = readUploadedAttachment(threadId, artifact);
      if (!attachment) throw new UploadError("附件服务返回了无效元数据。", 502);
      uploaded.push(attachment);
    }
    return NextResponse.json({ attachments: uploaded }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await Promise.allSettled(
      uploaded.map((attachment) =>
        fetch(gatewayUrl(`/api/threads/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(attachment.id)}`), {
          method: "DELETE",
          headers: gatewayHeaders({ "X-Commerce-Client-Request-Id": clientRequestId }, access.context),
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        }),
      ),
    );
    const status = error instanceof UploadError && error.status >= 400 && error.status < 600 ? error.status : 503;
    return NextResponse.json(
      { error: error instanceof Error ? translateAttachmentError(error.message) : "附件上传失败。" },
      { status },
    );
  }
}

function readUploadedAttachment(threadId: string, value: Record<string, unknown>): UploadedAttachment | null {
  const id = typeof value.id === "string" ? value.id : "";
  const name = typeof value.originalName === "string" ? value.originalName : "";
  const mimeType = typeof value.mimeType === "string" ? value.mimeType : "";
  const size = typeof value.size === "number" ? value.size : -1;
  const kind = value.kind === "image" || value.kind === "document" ? value.kind : null;
  if (!CLIENT_REQUEST_ID_PATTERN.test(id) || !name || !mimeType || size < 0 || !kind) return null;
  return {
    id,
    name,
    mimeType,
    size,
    kind,
    url: `/api/agent/threads/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(id)}`,
  };
}

function translateAttachmentError(message: string): string {
  if (/unsupported|mismatched/i.test(message)) return "附件格式不受支持，或文件扩展名与实际内容不一致。";
  if (/no readable text/i.test(message)) return "附件中没有可读取的文字内容。";
  if (/page count|cell count|limit|too large/i.test(message)) return "附件超过允许的大小、页数或表格单元格限制。";
  return message.length <= 180 ? message : "附件上传失败。";
}

class UploadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
