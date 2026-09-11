import { withEnterpriseDatabaseContext } from "@/lib/enterprise/database-context";
import type { EnterpriseScope } from "@/lib/enterprise/types";
import { gatewayHeaders, gatewayUrl } from "@/lib/agent/http";
import { getAgentThreadForUser } from "@/lib/agent/thread-ownership";

export type ImageSession = { threadId: string; projectThreadId: string; sourceFilename: string };
export async function listImageSessions(scope: EnterpriseScope, projectThreadId: string): Promise<ImageSession[]> {
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query(`SELECT thread_id AS "threadId", project_thread_id AS "projectThreadId", source_filename AS "sourceFilename"
      FROM commerce_creative_image_session WHERE project_thread_id = $1 ORDER BY created_at`, [projectThreadId]);
    return result.rows;
  });
}
export async function getImageSession(scope: EnterpriseScope, threadId: string): Promise<ImageSession | null> {
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query(`SELECT thread_id AS "threadId", project_thread_id AS "projectThreadId", source_filename AS "sourceFilename"
      FROM commerce_creative_image_session WHERE thread_id = $1`, [threadId]);
    return result.rows[0] ?? null;
  });
}
async function readOwnedImage(scope: EnterpriseScope, filename: string) {
  if (!/^[0-9]+-[0-9a-f-]+\.(png|jpg|webp)$/i.test(filename)) throw new Error("图片标识无效。");
  const response = await fetch(gatewayUrl(`/api/generated-images/${encodeURIComponent(filename)}/metadata`), {
    headers: gatewayHeaders(undefined, scope), cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json();
  const artifact = payload?.artifact;
  if (!response.ok || typeof artifact?.threadId !== "string" || !await getAgentThreadForUser(artifact.threadId, scope)) throw new Error("图片不存在或不可访问。");
  return artifact as { threadId: string; sourceFilenames?: string[] };
}
export async function imageSourceThread(scope: EnterpriseScope, filename: string): Promise<string> {
  return (await readOwnedImage(scope, filename)).threadId;
}
export async function resolveImageSources(scope: EnterpriseScope, threadId: string, filenames: string[]) {
  const session = await getImageSession(scope, threadId);
  const project = session?.projectThreadId ?? threadId;
  if (!await getAgentThreadForUser(project, scope)) throw new Error("创作项目不可访问。");
  const sessions = await listImageSessions(scope, project);
  const allowed = new Set([project, ...sessions.map((item) => item.threadId)]);
  return Promise.all(filenames.map(async (filename) => {
    const sourceThreadId = await imageSourceThread(scope, filename);
    if (!allowed.has(sourceThreadId)) throw new Error("原图不属于当前创作项目。");
    return { filename, threadId: sourceThreadId };
  }));
}

// Request-scoped memoization only: every new HTTP request re-checks ownership.
export async function createImageAssetResolver(scope: EnterpriseScope, projectThreadId: string, sessions?: ImageSession[]) {
  const allowed = new Set([projectThreadId, ...(sessions ?? await listImageSessions(scope, projectThreadId)).map((session) => session.threadId)]);
  const artifacts = new Map<string, ReturnType<typeof readOwnedImage>>();
  return async (filename: string): Promise<string> => {
    const seen = new Set<string>();
    let current = filename;
    while (!seen.has(current)) {
      seen.add(current);
      let pending = artifacts.get(current);
      if (!pending) { pending = readOwnedImage(scope, current); artifacts.set(current, pending); }
      const artifact = await pending;
      if (!allowed.has(artifact.threadId)) throw new Error("图片不属于当前项目。");
      const parent = artifact.sourceFilenames?.[0];
      if (!parent) return current;
      current = parent;
    }
    throw new Error("图片版本关系无效。");
  };
}
export async function resolveImageAssetRoot(scope: EnterpriseScope, projectThreadId: string, filename: string): Promise<string> {
  return (await createImageAssetResolver(scope, projectThreadId))(filename);
}
