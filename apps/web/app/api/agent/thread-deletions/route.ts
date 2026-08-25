import { NextResponse } from "next/server";

import { requireAgentContext } from "@/lib/agent/http";
import {
  createThreadDeletionJob,
  listActiveThreadDeletionJobs,
  ThreadDeletionJobError,
} from "@/lib/agent/thread-deletion-jobs";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";

export async function GET(request: Request) {
  const access = await requireAgentContext(request, "thread.delete");
  if (!access.ok) return access.response;
  const jobs = await listActiveThreadDeletionJobs(access.context).catch(() => null);
  if (!jobs) return NextResponse.json({ error: "无法读取后台删除任务。" }, { status: 503 });
  return NextResponse.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const access = await requireAgentContext(request, "thread.delete");
  if (!access.ok) return access.response;
  const rateLimited = await enforceEnterpriseRateLimit(access.context, "thread.delete.job", 10, 60);
  if (rateLimited) return rateLimited;
  const body = (await request.json().catch(() => null)) as { threadIds?: unknown } | null;
  if (!body || !Array.isArray(body.threadIds) || body.threadIds.some((value) => typeof value !== "string")) {
    return NextResponse.json({ error: "请选择需要删除的任务。" }, { status: 400 });
  }
  try {
    const job = await createThreadDeletionJob(access.context, body.threadIds as string[]);
    return NextResponse.json({ job }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ThreadDeletionJobError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: "无法创建后台删除任务。" }, { status: 503 });
  }
}
