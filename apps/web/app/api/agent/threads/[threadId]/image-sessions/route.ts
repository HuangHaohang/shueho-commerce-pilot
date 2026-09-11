import { NextResponse } from "next/server";
import { requireAgentThreadContext, requireAgentContext, gatewayUrl, gatewayHeaders } from "@/lib/agent/http";
import { getAgentThreadForUser, registerAgentThreadOwner } from "@/lib/agent/thread-ownership";
import { withEnterpriseDatabaseContext } from "@/lib/enterprise/database-context";
import { listImageSessions, resolveImageSources, createImageAssetResolver } from "@/lib/creative/image-session-repository";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";

type RouteContext = { params: Promise<{ threadId: string }> };
export async function GET(request: Request, route: RouteContext) {
  const { threadId } = await route.params;
  const access = await requireAgentThreadContext(request, threadId);
  if (!access.ok) return access.response;
  try {
    const sessions = await listImageSessions(access.context, threadId);
    const resolveRoot = await createImageAssetResolver(access.context, threadId, sessions);
    const records = await Promise.all(sessions.map(async (session) => ({ ...session, assetFilename: await resolveRoot(session.sourceFilename), thread: await getAgentThreadForUser(session.threadId, access.context) })));
    return NextResponse.json({ sessions: records.filter((item) => item.thread) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "无法读取图片编辑会话。" }, { status: 503 }); }
}
export async function POST(request: Request, route: RouteContext) {
  const { threadId } = await route.params;
  const access = await requireAgentThreadContext(request, threadId, "agent.run");
  if (!access.ok) return access.response;
  const body = await request.json().catch(() => null);
  if (typeof body?.filename !== "string" || typeof body?.model !== "string" || body.model.length > 128) return NextResponse.json({ error: "请选择图片与模型。" }, { status: 400 });
  const scope = access.context;
  const project = await getAgentThreadForUser(threadId, scope);
  if (!project || !["creative_project", "copywriting"].includes(project.recipeId ?? "")) return NextResponse.json({ error: "创作项目不存在。" }, { status: 404 });
  try {
    await resolveImageSources(scope, threadId, [body.filename]);
    const existingSessions = await listImageSessions(scope, threadId);
    const resolveRoot = await createImageAssetResolver(scope, threadId, existingSessions);
    const assetFilename = await resolveRoot(body.filename);
    const roots = new Map(await Promise.all(existingSessions.map(async (item) => [item.threadId, await resolveRoot(item.sourceFilename)] as const)));
    const reusable = existingSessions.find((item) => roots.get(item.threadId) === assetFilename);
    let expiredEmptyThread: string | null = null;
    if (reusable) {
      const thread = await getAgentThreadForUser(reusable.threadId, scope);
      if (thread && !thread.turnStartedAt) {
        const probe = await fetch(gatewayUrl(`/api/threads/${encodeURIComponent(thread.threadId)}`), {
          headers: gatewayHeaders(undefined, scope), cache: "no-store", signal: AbortSignal.timeout(10_000),
        });
        const result = await probe.json();
        if (probe.status === 404 || (result.code === -32600 && result.error === `thread not loaded: ${thread.threadId}`)) expiredEmptyThread = thread.threadId;
        else if (!probe.ok) throw new Error("无法确认编辑会话状态，请稍后重试。");
      }
      if (thread && !expiredEmptyThread) return NextResponse.json({ session: { ...reusable, assetFilename, thread } }, { headers: { "Cache-Control": "no-store" } });
    }
    const createAccess = await requireAgentContext(request, "thread.create");
    if (!createAccess.ok) return createAccess.response;
    const limited = await enforceEnterpriseRateLimit(scope, "thread.create", 20, 60);
    if (limited) return limited;
    const session = await withEnterpriseDatabaseContext(scope, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`image-project:${threadId}`]);
      const deleting = await client.query(`SELECT 1 FROM commerce_thread_deletion_item i JOIN commerce_thread_deletion_job j ON j.id = i.job_id
        WHERE i.thread_id = $1 AND j.status IN ('queued', 'running') LIMIT 1`, [threadId]);
      if (deleting.rowCount) throw new Error("创作项目正在删除。");
      if (expiredEmptyThread) {
        const empty = await client.query("SELECT thread_id FROM commerce_agent_thread WHERE thread_id = $1 AND turn_started_at IS NULL FOR UPDATE", [expiredEmptyThread]);
        const attempts = await client.query("SELECT 1 FROM commerce_agent_turn_lease WHERE thread_id = $1 LIMIT 1", [expiredEmptyThread]);
        if (empty.rowCount && !attempts.rowCount) {
          // Harness never persisted a user Turn; only replace the empty application binding.
          await client.query("DELETE FROM commerce_creative_image_session WHERE thread_id = $1", [expiredEmptyThread]);
          await client.query("DELETE FROM commerce_agent_thread WHERE thread_id = $1", [expiredEmptyThread]);
        } else throw new Error("编辑会话已有执行记录，请恢复原会话。");
      }
      // Reusing a generated revision continues its existing native editor thread.
      const existing = await client.query(`SELECT thread_id AS "threadId", project_thread_id AS "projectThreadId", source_filename AS "sourceFilename"
        FROM commerce_creative_image_session WHERE project_thread_id = $1 ORDER BY created_at`, [threadId]);
      for (const candidate of existing.rows) {
        if (candidate.sourceFilename === assetFilename || roots.get(candidate.threadId) === assetFilename) return { ...candidate, assetFilename };
      }
      // Hold the project row against concurrent deletion while registering the relation.
      const parent = await client.query("SELECT thread_id FROM commerce_agent_thread WHERE thread_id = $1 FOR KEY SHARE", [threadId]);
      if (!parent.rowCount) throw new Error("创作项目已删除。");
      const response = await fetch(gatewayUrl("/api/threads"), { method: "POST", headers: gatewayHeaders({ "Content-Type": "application/json" }, scope),
        body: JSON.stringify({ model: body.model }), signal: AbortSignal.timeout(30_000), cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload?.result?.thread?.id) throw new Error(payload?.error ?? "无法创建编辑会话。");
      const editThreadId = payload.result.thread.id;
      await registerAgentThreadOwner(editThreadId, scope, "图片编辑", "creative_project", "creative", client);
      await client.query(`INSERT INTO commerce_creative_image_session (tenant_id, workspace_id, user_id, project_thread_id, source_filename, thread_id)
        VALUES ($1,$2,$3,$4,$5,$6)`, [scope.tenantId, scope.workspaceId, scope.userId, threadId, assetFilename, editThreadId]);
      return { threadId: editThreadId, projectThreadId: threadId, sourceFilename: assetFilename, assetFilename, replacedEmptyThreadId: expiredEmptyThread };
    });
    return NextResponse.json({ session: { ...session, thread: await getAgentThreadForUser(session.threadId, scope) } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "图片编辑会话暂时不可用。" }, { status: 409 }); }
}
