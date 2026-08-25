import { NextResponse } from "next/server";

import { requireAgentContext } from "@/lib/agent/http";
import { getThreadDeletionJob } from "@/lib/agent/thread-deletion-jobs";

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const access = await requireAgentContext(request, "thread.delete");
  if (!access.ok) return access.response;
  const { jobId } = await context.params;
  const job = await getThreadDeletionJob(access.context, jobId).catch(() => null);
  if (!job) return NextResponse.json({ error: "删除任务不存在。" }, { status: 404 });
  return NextResponse.json({ job }, { headers: { "Cache-Control": "no-store" } });
}
